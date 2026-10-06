// Extractive retrieval only. Every returned character comes from an indexed source.
const STOP = new Set('a an the of to for and or in on at is are be was were it this that i my me we our you your how do does did can could would should what when where who which with have has want need please about from as by into all get getting like know find tell more help question'.split(' '));
export const normalize = text => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/cross[ -]?list(?:ed|ing)?/g,' crosslist ').replace(/simultaneous/g,' simultaneous ').replace(/\b(?:approve|approved|approving|approvals)\b/g,' approval ').replace(/\b(?:modify|modifying|modifications|modification)\b/g,' modification ').replace(/\b(?:track|tracking)\b/g,' track ').replace(/\b(?:chairs)\b/g,' chair ').replace(/\b(?:courses)\b/g,' course ').replace(/\b(?:proposals)\b/g,' proposal ').replace(/\b(?:programs)\b/g,' program ').replace(/\b(?:committees)\b/g,' committee ');
export const tokens = text => normalize(text).match(/[a-z0-9]+/g)?.filter(x=>x.length>1&&!STOP.has(x)) || [];
const SYNONYMS={deadline:['deadline','calendar','date','submission'],dates:['date','calendar','deadline'],calendar:['calendar','date','deadline'],access:['access','login','logging'],login:['login','logging','access'],status:['status','track','workflow'],track:['track','status'],permanent:['permanent'],temporary:['temporary'],change:['change','modification'],changing:['change','modification'],submit:['submit','submission','submitted'],submitting:['submit','submission','submitted'],denied:['denied','rejected'],rejected:['rejected','denied'],credits:['credit','credits'],crosslist:['crosslist'],syllabus:['syllabus','syllabi']};
export function buildSearch(data){
  const sourceMap=new Map(data.sources.map(s=>[s.url,s]));
  const frequency=new Map();
  const docs=data.passages.map(p=>{
    const words=tokens(p.text),title=tokens(p.heading+' '+sourceMap.get(p.source)?.title);
    const counts=new Map();for(const w of words)counts.set(w,(counts.get(w)||0)+1);
    for(const w of new Set([...words,...title]))frequency.set(w,(frequency.get(w)||0)+1);
    return {p,counts,title:new Set(title),length:words.length,source:sourceMap.get(p.source)};
  });
  const avg=docs.reduce((s,d)=>s+d.length,0)/Math.max(docs.length,1);
  return question=>{
    const original=[...new Set(tokens(question))];
    if(!original.length)return [];
    const groups=original.map(w=>SYNONYMS[w]||[w]);
    const meaningful=groups.filter(g=>g.some(w=>frequency.has(w)));
    // Missing distinctive terms means we cannot claim the returned guidance answers the question.
    if(meaningful.length/original.length<.5)return [];
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
      const coverage=matched/groups.length;
      score*=coverage*coverage;
      if(d.source.kind==='Curriculum Toolkit')score*=1.15;
      if(/archive|previous years|2017-2018|2023-2024/i.test(d.source.title)&&!/(?:19|20)\d{2}/.test(question))score*=.6;
      return {...d,score,coverage,bodyMatched};
    }).filter(d=>d.score>1&&d.coverage>=.6&&d.bodyMatched>=Math.min(2,groups.length)).sort((a,b)=>b.score-a.score);
    const results=[],perSource=new Map(),texts=new Set();
    for(const r of ranked){
      if(r.score<(ranked[0]?.score||0)*.4)continue;
      if(results.length===4)break;
      const key=r.p.text.toLowerCase();
      if(texts.has(key)||(perSource.get(r.p.source)||0)>=2)continue;
      texts.add(key);perSource.set(r.p.source,(perSource.get(r.p.source)||0)+1);results.push(r);
    }
    return results;
  };
}
export function emailLink(originalQuestion){
  return 'mailto:genvieve.spitale@uri.edu?subject='+encodeURIComponent('Faculty Senate curriculum question')+'&body='+encodeURIComponent(originalQuestion);
}
