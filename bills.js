import {activeMessages,expandQuestion} from './conversation.js';
import {tokens} from './search.js';

// Bill and report identifiers are not interchangeable. Keep the committee in
// the key when supplied, and accept the short and long academic-year forms.
export function identifiers(text){
  const clean=text.replace(/[–—−]/g,'-'),found=[];
  const pattern=/(?:(CASC|FSEC|CBUM|GEC|GC|SSCC|ACC|TAAC|SCLC|ADMIN(?:ISTRATOR)?)\s*(?:Bill|Report)?\s*#?\s*)?\b((?:19|20)?\d{2})\s*-\s*((?:19|20)?\d{2})\s*-\s*(?:(CASC|FSEC|CBUM|GEC|GC|SSCC|ACC|TAAC|SCLC|ADMIN(?:ISTRATOR)?)\s*-\s*)?(\d{1,3})\s*-?\s*([A-C])?\b/gi;
  for(const m of clean.matchAll(pattern)){
    const year=x=>x.length===4?Number(x):Number(x)>=70?1900+Number(x):2000+Number(x);
    const start=year(m[2]),end=year(m[3]);if(end!==start+1)continue;
    const committee=(m[4]||m[1]||'').toUpperCase().replace('ADMINISTRATOR','ADMIN');
    found.push({key:`${start}-${end}:${committee}:${Number(m[5])}${(m[6]||'').toUpperCase()}`,year:`${start}-${end}`,committee,number:`${Number(m[5])}${(m[6]||'').toUpperCase()}`,printed:m[0].trim()});
  }
  return found;
}
export function isBillQuestion(messages){
  const q=messages.at(-1)?.content||'';
  if(identifiers(q).length)return true;
  if(/\b(?:bill|report)\s*(?:number|no\.?|#)|\bnumber\b.*\bbill\b/i.test(q))return true;
  if(/\b(?:this|that|the) bill\b/i.test(q)&&activeMessages(messages).length>1)return true;
  // Concepts and approval procedures need the toolkit/manual, not a random
  // legislation record that happens to contain the word "bill".
  return /\bbill\b/i.test(q)&&!/\b(?:what is (?:a|an|a faculty senate)|definition|difference|different|how.*(?:approved|approval|become|process)|bills in general)\b/i.test(q)&&/\b(?:for|called|named|about|cover|details|lookup|look up)\b/i.test(q);
}
const OMIT=new Set('if its their they them bill bills number numbers no report reports lookup look up have has does approval approved yet status proposal program major degree bs ba ms phd academic year last current for called named'.split(' '));
export function billEvidence(index,messages){
  const scoped=activeMessages(messages),latest=expandQuestion(scoped.at(-1).content,index.builtAt);
  let explicit=identifiers(latest);const ids=new Set();
  if(!explicit.length&&/\b(?:this|that|the) bill\b/i.test(latest)&&scoped.length>1){
    for(const m of scoped.slice(0,-1).reverse()){const inherited=identifiers(m.content);if(inherited.length){explicit=inherited;break;}}
  }
  if(explicit.length){
    for(const id of explicit){
      const key=id.committee?id.key:`${id.year}:*:${id.number}`;
      for(const n of index.identifiers[key]||[])ids.add(n);
    }
  }else{
    const topic=scoped.filter(m=>m.role==='user').map(m=>expandQuestion(m.content,index.builtAt)).join(' ');
    const words=[...new Set(tokens(topic).filter(w=>!OMIT.has(w)&&!/^\d+$/.test(w)))];
    // Do not match a bare "bill number" to the first unrelated bill in the index.
    const meaningful=words.filter(w=>index.terms[w]);
    if(!meaningful.length||meaningful.length/Math.max(1,words.length)<.6)return [];
    const counts=new Map();for(const w of meaningful)for(const n of index.terms[w])counts.set(n,(counts.get(n)||0)+1);
    const best=Math.max(0,...counts.values());
    if(best<Math.min(2,words.length)||best/words.length<.65)return [];
    const year=topic.match(/(20\d{2})\s*[-–]\s*(20\d{2}|\d{2})/)?.[1];
    for(const [n,hits] of counts)if(hits===best&&(!year||index.records[n][3].some(k=>k.startsWith(year+'-'))))ids.add(n);
  }
  const overview=r=>{
    if(!explicit.length)return r[4];
    const source=index.sources[r[0]],named=identifiers(source.title).some(a=>explicit.some(b=>a.year===b.year&&a.number===b.number&&(!b.committee||a.committee===b.committee)));
    return r[4]+(named?10:0)-(source.kind==='Faculty Senate proposal tracker'?5:0);
  };
  const rows=[...ids].map(n=>index.records[n]).sort((a,b)=>overview(b)-overview(a));
  // When the named subject has an explicit bill record, omit lower-priority
  // report pages that merely mention the same subject in broader discussions.
  const explicitSubject=!explicit.length&&rows.some(r=>r[4]>=4);
  const seen=new Set(),selected=[];
  for(const row of rows){
    if(explicitSubject&&row[4]<4)continue;
    const [sourceId,heading,id]=row,source=index.sources[sourceId],key=source.url+' '+heading;
    if(seen.has(key))continue;seen.add(key);
    selected.push({source,p:{id,source:source.url,heading,text:''}});if(selected.length===8)break;
  }
  return selected;
}
export function missingBillAnswer(index,messages){
  const ids=identifiers(messages.at(-1).content);
  const named=tokens(activeMessages(messages).filter(m=>m.role==='user').map(m=>m.content).join(' ')).filter(w=>!OMIT.has(w)&&!/^\d+$/.test(w)).length>=2;
  if(!ids.length&&named)return {kind:'unanswered',answer:'I couldn’t locate a bill identifier associated with that program or action in the indexed Senate records. Confirm the program title and academic year, or use the email option to ask Genviéve.',followUp:'',sources:[],snapshotDate:index.builtAt};
  return {kind:ids.length?'unanswered':'clarification',answer:ids.length?'I couldn’t locate that exact bill identifier in the indexed Senate records. Please check the academic year, committee prefix, and number, or use the email option to ask Genviéve.':'Which course, program, or Senate action is the bill for? If you have part of the identifier, include its academic year and committee (for example, CASC or Graduate Council).',followUp:'',sources:[],snapshotDate:index.builtAt};
}
