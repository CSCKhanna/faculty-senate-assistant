// Extractive retrieval only. Every returned character comes from an indexed source.
const STOP = new Set('difference between compare versus vs a an the of to for and or in on at is are be was were it this that i my me we our you your how do does did can could would should what when where who which with have has want need please about from as by into all get getting like know find tell more help question teach teaching taught wondering trying someone anyone something use using information explain regarding'.split(' '));
export const normalize = text => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/4\s*\+\s*1/g,' fourplusone ').replace(/cross[ -]?list(?:ed|ing)?/g,' crosslist ').replace(/simultaneous/g,' simultaneous ').replace(/\b(?:approve|approved|approving|approvals)\b/g,' approval ').replace(/\b(?:modify|modifying|modifications|modification)\b/g,' modification ').replace(/\b(?:track|tracking)\b/g,' track ').replace(/\b(?:chairs)\b/g,' chair ').replace(/\b(?:courses|classes|class)\b/g,' course ').replace(/\b(?:propose|proposing|proposed)\b/g,' proposal ').replace(/\b(?:proposals)\b/g,' proposal ').replace(/\b(?:programs)\b/g,' program ').replace(/\b(?:committees)\b/g,' committee ');
export const tokens = text => normalize(text).match(/[a-z0-9]+/g)?.filter(x=>x.length>1&&!STOP.has(x)) || [];
const SYNONYMS={deadline:['deadline','calendar','date','submission'],dates:['date','calendar','deadline'],calendar:['calendar','date','deadline'],access:['access','login','logging'],login:['login','logging','access'],status:['status','track','workflow'],track:['track','status'],permanent:['permanent'],temporary:['temporary'],change:['change','modification'],changing:['change','modification'],submit:['submit','submission','submitted'],submitting:['submit','submission','submitted'],denied:['denied','rejected'],rejected:['rejected','denied'],credits:['credit','credits'],crosslist:['crosslist'],syllabus:['syllabus','syllabi']};
export function buildSearch(data){
  if(data.postings&&data.terms)return buildCompiledSearch(data);
  const sourceMap=new Map(data.sources.map(s=>[s.url,s]));
  const frequency=new Map();
  const docs=data.passages.map(p=>{
    const words=tokens(p.text),title=tokens(p.heading+' '+sourceMap.get(p.source)?.title);
    const counts=new Map();for(const w of words)counts.set(w,(counts.get(w)||0)+1);
    for(const w of new Set([...words,...title]))frequency.set(w,(frequency.get(w)||0)+1);
    return {p,counts,title:new Set(title),length:words.length,source:sourceMap.get(p.source)};
  });
  const avg=docs.reduce((s,d)=>s+d.length,0)/Math.max(docs.length,1);
  return (question,limit=4,relaxed=false)=>{
    if(relaxed&&!/course|program|specialization|kuali|curricul|proposal|syllab|prerequis|credit|department|faculty|senate|approval|crosslist|deadline|calendar|workflow|modality|graduat|undergraduat|catalog|online|teach|access|login|track|chair|dean|committee/.test(normalize(question)))return [];
    const original=[...new Set(tokens(question))];
    if(!original.length)return [];
    const groups=original.map(w=>SYNONYMS[w]||[w]);
    const meaningful=groups.filter(g=>g.some(w=>frequency.has(w)));
    // Missing distinctive terms means we cannot claim the returned guidance answers the question.
    if(!meaningful.length||(!relaxed&&meaningful.length/original.length<.5))return [];
    const ranked=docs.map(d=>{
      let score=0,matched=0,bodyMatched=0;
      for(const g of groups){
        let best=0,hit=false;
        for(const w of g){
          const tf=d.counts.get(w)||0,head=d.title.has(w),df=frequency.get(w)||0;
          if(!tf&&!head)continue;
          const idf=Math.log(1+(docs.length-df+.5)/(df+.5));
          best=Math.max(best,idf*((tf*2.2)/(tf+1.2*(.25+.75*d.length/avg))+(head?1.3:0)));
          if(tf)hit=true;
        }
        if(best)matched++;
        if(hit)bodyMatched++;
        score+=best;
      }
      const coverage=matched/meaningful.length;
      score*=coverage*coverage;
      if(d.source.kind==='Curriculum Toolkit')score*=1.15;
      if(/\btrack\b/.test(normalize(question))&&d.source.title==='Track Your Proposal')score*=1.5;
      if(/archive|previous years|2017-2018|2023-2024/i.test(d.source.title)&&!/(?:19|20)\d{2}/.test(question))score*=.6;
      return {...d,score,coverage,bodyMatched};
    }).filter(d=>d.score>1&&(relaxed||d.coverage>=.5)&&d.bodyMatched>=Math.min(relaxed?1:2,groups.length)).sort((a,b)=>b.score-a.score);
    const results=[],perSource=new Map(),texts=new Set();
    for(const r of ranked){
      if(r.score<(ranked[0]?.score||0)*(relaxed?.2:.4))continue;
      if(results.length===limit)break;
      const key=r.p.text.toLowerCase();
      if(texts.has(key)||(perSource.get(r.p.source)||0)>=3)continue;
      texts.add(key);perSource.set(r.p.source,(perSource.get(r.p.source)||0)+1);results.push(r);
    }
    return results;
  };
}
export function emailLink(originalQuestion){
  return 'mailto:genvieve.spitale@uri.edu?subject='+encodeURIComponent('Faculty Senate curriculum question')+'&body='+encodeURIComponent(originalQuestion);
}

// Keep the visible transcript and original email question, but bound API context.
export function conversationContext(messages){
  let recent=messages.slice(-15).map(m=>({role:m.role,content:m.content.slice(0,4000)}));
  if(recent[0]?.role==='assistant')recent.shift();
  while(recent.length>1&&recent.reduce((n,m)=>n+m.content.length,0)>20000)recent=recent.slice(2);
  return recent;
}

function buildCompiledSearch(data){
 const sourceFlags=new Map(data.sources.map(s=>{const years=[...s.title.matchAll(/(?:19|20)\d{2}/g)].map(x=>Number(x[0]));return [s.url,/archive|previous years|2017-2018|2023-2024/i.test(s.title)||years.length&&Math.max(...years)<2026];}));
 const docs=data.passages.map((p,i)=>({p,source:data.sources[data.docs[i][0]],length:data.docs[i][2]})),n=docs.length,avg=docs.reduce((a,d)=>a+d.length,0)/n;
 return (question,limit=4,relaxed=false)=>{
  const original=[...new Set(tokens(question))],groups=original.map(w=>SYNONYMS[w]||[w]),meaningful=groups.filter(g=>g.some(w=>data.terms[w]));
  if(!meaningful.length||(!relaxed&&meaningful.length/original.length<.5))return [];
  const hasYear=/(?:19|20)\d{2}/.test(question),tracking=/status|track|happened|proposal/i.test(question),procedure=/how|steps|prerequis|procedure|process|change|modif/i.test(question);
  const score=new Float64Array(n),matched=new Uint16Array(n),body=new Uint16Array(n);
  for(const group of groups){const best=new Float64Array(n),hit=new Uint8Array(n),touched=new Set();
   for(const w of group){const range=data.terms[w];if(!range)continue;const [start,count]=range,idf=Math.log(1+(n-count+.5)/(count+.5));
    for(let j=start;j<start+count;j++){const packed=data.postings[j],id=packed>>>16,tf=packed&32767,head=(packed&32768)!==0;const value=idf*((tf*2.2)/(tf+1.2*(.25+.75*docs[id].length/avg))+(head?1.3:0));best[id]=Math.max(best[id],value);if(tf)hit[id]=1;touched.add(id);}
   }
   for(const id of touched){score[id]+=best[id];matched[id]++;body[id]+=hit[id];}
  }
  const ranked=[];
  for(let i=0;i<n;i++){const coverage=matched[i]/meaningful.length;if(!score[i]||!relaxed&&coverage<.5||body[i]<Math.min(relaxed?1:2,groups.length))continue;const d=docs[i];let value=score[i]*coverage*coverage;
   if(d.source.kind==='Curriculum Toolkit')value*=1.15;
   if(/\btrack\b/.test(normalize(question))&&d.source.title==='Track Your Proposal')value*=1.5;
   if(!hasYear&&sourceFlags.get(d.source.url))value*=.6;
   if(tracking&&d.source.kind==='Faculty Senate proposal tracker')value*=2;
   if(!hasYear&&d.source.kind==='Faculty Senate website')value*=1.3;
   if(!hasYear&&procedure&&d.source.kind==='Faculty Senate PDF')value*=.35;
   if(value>1)ranked.push({...d,score:value,coverage,bodyMatched:body[i]});
  }
  ranked.sort((a,b)=>b.score-a.score);const results=[],counts=new Map(),texts=new Set();
  for(const r of ranked){if(r.score<(ranked[0]?.score||0)*(relaxed?.2:.4))continue;if(results.length===limit)break;const key=r.p.text?r.p.text.toLowerCase():String(r.p.id);if(texts.has(key)||(counts.get(r.p.source)||0)>=3)continue;texts.add(key);counts.set(r.p.source,(counts.get(r.p.source)||0)+1);results.push(r);}
  return results;
 };
}
