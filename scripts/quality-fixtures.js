// Used only by the generated QA preview. No requests reach the AI gateway.
const nativeFetch=globalThis.fetch.bind(globalThis),state=new URL(location.href).searchParams.get('scenario')||'normal';let count=0;
const sources=[{id:1,title:'Course Modification Proposal Walkthrough',section:'Start the Proposal',url:'https://gilded-toucan-d8a.notion.site/3c57535bf92c80d88020dcb7b863e664'}];
const answer={kind:'answer',answer:'Use a **Course Modification Proposal** to make a temporary course permanent. Open the existing course in Kuali, select **Propose Changes**, and choose **Create a new version** [1].\n\n1. Complete the relevant changes.\n2. Leave Edit Mode, then submit for approval [1].',sources,followUp:''};
export async function qualityFetch(url,options){
 if(String(url).endsWith('/health')){if(state==='slow-start')await new Promise(r=>setTimeout(r,6000));return Response.json({ready:state!=='offline',sourceCount:1321,snapshot:'2026-10-06T20:35:35.933901+00:00'});}
 if(String(url).endsWith('/chat')){
  count++;const messages=JSON.parse(options.body).messages;
  if(state==='slow')await new Promise(r=>setTimeout(r,12000));
  if(state==='error-once'&&count===1)return Response.json({error:'The assistant is temporarily unavailable.'},{status:503});
  if(state==='daily-limit')return Response.json({error:'The pilot has reached its daily request limit. Please try again tomorrow or email Genviéve.'},{status:429});
  if(state==='invalid')return Response.json({answer:null,sources:[null]});
  if(state==='unsafe')return Response.json({...answer,answer:'<img src=x onerror=alert(1)>\n\nLiteral text **remains readable** [1].',sources:[...sources,{id:2,title:'Untrusted URL',url:'javascript:alert(1)'}]});
  if(state==='long')return Response.json({...answer,answer:Array.from({length:18},(_,i)=>'Paragraph '+(i+1)+'. '+answer.answer.split('\n')[0]).join('\n\n')});
  return Response.json(messages.length>1?{...answer,answer:'After submission, the course modification is routed to the appropriate review committees. You can check its workflow status from your Kuali dashboard [1].'}:answer);
 }
 if(state==='inventory-error'&&String(url).endsWith('/routing.json'))return new Response('',{status:503});
 return nativeFetch(url,options);
}
