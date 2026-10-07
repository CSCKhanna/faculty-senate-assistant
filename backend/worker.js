import fallbackRelease from '../data/source-release.json' with {type:'json'};
import {hydrateEvidence} from '../corpus.js';
import {createSourceStore} from './source-store.js';
import {isLiveMeetingQuestion,getLiveMeetingEvidence,liveMeetingFallback} from './live-meetings.js';
import {isBillQuestion,billEvidence,missingBillAnswer} from '../bills.js';
const sourceStore=createSourceStore({fallback:fallbackRelease});
import {validateMessages,converse,answerEvidence} from './chat.js';

export async function reserveBudget(db,key,cap=100,now=Date.now()){
  if(!Number.isInteger(cap)||cap<1||cap>100)return {allowed:false,reason:'The pilot request limit is not configured correctly.'};
  const day=new Date(now).toISOString().slice(0,10),minute=Math.floor(now/60000);
  const queries=[
    db.prepare('DELETE FROM pilot_rate WHERE minute < ?').bind(minute-1),
    db.prepare('DELETE FROM pilot_daily WHERE day < ?').bind(day),
    db.prepare('INSERT INTO pilot_rate (network,minute,count) VALUES (?, ?, 1) ON CONFLICT(network,minute) DO UPDATE SET count=count+1 RETURNING count').bind(key,minute),
    db.prepare('INSERT INTO pilot_daily (day,count) VALUES (?,0) ON CONFLICT(day) DO NOTHING').bind(day),
    db.prepare('UPDATE pilot_daily SET count=count+1 WHERE day=? AND count<? AND EXISTS (SELECT 1 FROM pilot_rate WHERE network=? AND minute=? AND count<=8) RETURNING count').bind(day,cap,key,minute)
  ];
  const result=await db.batch(queries);
  const tooFast=result[2].results[0].count>8;
  return {allowed:!tooFast&&result[4].results.length>0,reason:tooFast?'Please wait a minute before asking another question.':'The pilot has reached its daily request limit. Please try again tomorrow or email Genviéve.'};
}

export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin')||'',allowed=(env.ALLOWED_ORIGINS||'https://csckhanna.github.io').split(',').map(s=>s.trim());
    const permitted=allowed.includes(origin);
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(permitted?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}:{})};
    const reply=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers});
    const url=new URL(request.url);
    if(url.pathname==='/health'){
      const state=env.URI_API_KEY&&env.PILOT_DB?await sourceStore.get():{release:fallbackRelease,releaseStatus:'bundled'},release=state.release;
      return reply({ready:Boolean(env.URI_API_KEY&&env.PILOT_DB),snapshot:release.corpus.builtAt,sourceCount:release.corpus.sourceCount,sourceCheckedAt:release.checkedAt,sourceStatus:state.releaseStatus,refreshSchedule:'daily',liveMeetings:true,model:env.AI_MODEL||'its_direct/pt3-claude-sonnet-5.5-1m-us'});
    }
    if(!permitted)return reply({error:'This origin is not allowed.'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(url.pathname!=='/chat'||request.method!=='POST')return reply({error:'Not found.'},404);
    if(!env.URI_API_KEY||!env.PILOT_DB)return reply({error:'The conversational pilot is not connected yet.'},503);
    if(!request.headers.get('Content-Type')?.includes('application/json'))return reply({error:'JSON required.'},415);
    const size=Number(request.headers.get('Content-Length')||0);
    if(size>50000)return reply({error:'Conversation too long.'},413);
    let messages;
    try{const raw=await request.text();if(raw.length>50000)return reply({error:'Conversation too long.'},413);messages=validateMessages(JSON.parse(raw).messages);}
    catch{return reply({error:'Please enter a shorter question or start a new conversation.'},400);}
    try{
      const ip=request.headers.get('CF-Connecting-IP')||'unknown';
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip));
      const key=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
      const limit=await reserveBudget(env.PILOT_DB,key,Number(env.DAILY_REQUEST_LIMIT||100));
      if(!limit.allowed)return reply({error:limit.reason},429);
      if(isLiveMeetingQuestion(messages)){
        const live=await getLiveMeetingEvidence(messages),{attachments,...facts}=live,context={builtAt:live.checkedAt||fallbackRelease.corpus.builtAt,currentDate:new Date().toISOString(),live:facts,attachments};
        let answer=live.evidence?.length?await answerEvidence(context,messages,env,live.evidence):liveMeetingFallback(live);
        if(attachments?.length&&answer.kind==='sources')answer=liveMeetingFallback({...live,status:'agenda-unavailable'});
        const liveStatus=attachments?.length?(answer.sources.some(s=>attachments.some(a=>a.sourceUrl===s.url))?'agenda-read':'agenda-unavailable'):live.status;
        return reply({...answer,checkedAt:live.checkedAt||null,liveStatus,liveMeeting:true});
      }
      return reply(await sourceStore.run(async release=>{
        if(isBillQuestion(messages)){
          const index={...await sourceStore.billIndex(release),currentDate:new Date().toISOString()},selected=billEvidence(index,messages),passages=await hydrateEvidence(index,selected);
          return passages.length?await answerEvidence(index,messages,env,passages):missingBillAnswer(index,messages);
        }
        return converse({...await sourceStore.corpus(release),currentDate:new Date().toISOString()},messages,env);
      }));
    }catch{return reply({kind:'unanswered',answer:'The source service is temporarily unavailable. Please try again shortly, or open the toolkit directly.',sources:[],followUp:'',retryable:true,snapshotDate:fallbackRelease.corpus.builtAt});}
  }
};
