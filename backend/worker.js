import data from '../data/index.json' with {type:'json'};
import {validateMessages,converse} from './chat.js';

export class PilotBudget {
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.recent=new Map();}
  async fetch(request){
    const {key}=await request.json();
    const now=Date.now(),recent=(this.recent.get(key)||[]).filter(t=>now-t<60000);
    if(recent.length>=8)return Response.json({allowed:false,reason:'Please wait a minute before asking another question.'});
    if(this.recent.size>1000)for(const [k,v]of this.recent)if(!v.length||now-v.at(-1)>60000)this.recent.delete(k);
    recent.push(now);this.recent.set(key,recent);
    const day=new Date().toISOString().slice(0,10),cap=Number(this.env.DAILY_REQUEST_LIMIT||100);
    const allowed=await this.ctx.storage.transaction(async tx=>{
      const entry=await tx.get('usage')||{day,count:0};
      if(entry.day!==day){entry.day=day;entry.count=0;}
      if(entry.count>=cap)return false;
      entry.count++;await tx.put('usage',entry);return true;
    });
    return Response.json({allowed,reason:allowed?'':'The pilot has reached its daily request limit. Please try again tomorrow or email Genviéve.'});
  }
}

export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin')||'',allowed=(env.ALLOWED_ORIGINS||'https://csckhanna.github.io').split(',').map(s=>s.trim());
    const permitted=allowed.includes(origin);
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(permitted?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}:{})};
    const reply=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers});
    const url=new URL(request.url);
    if(url.pathname==='/health')return reply({ready:Boolean(env.URI_API_KEY&&env.PILOT_BUDGET),snapshot:data.builtAt,sourceCount:data.sources.length});
    if(!permitted)return reply({error:'This origin is not allowed.'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(url.pathname!=='/chat'||request.method!=='POST')return reply({error:'Not found.'},404);
    if(!env.URI_API_KEY||!env.PILOT_BUDGET)return reply({error:'The conversational pilot is not connected yet.'},503);
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
      const stub=env.PILOT_BUDGET.get(env.PILOT_BUDGET.idFromName('senate-pilot'));
      const limit=await (await stub.fetch('https://internal/reserve',{method:'POST',body:JSON.stringify({key})})).json();
      if(!limit.allowed)return reply({error:limit.reason},429);
      return reply(await converse(data,messages,env));
    }catch{return reply({error:'I couldn’t complete that answer. Please try again or email Genviéve with your question.'},502);}
  }
};
