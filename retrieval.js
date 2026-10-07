import {hydrateEvidence} from './corpus.js?v=3';
import {buildSearch,tokens} from './search.js?v=9';
import {activeMessages,isFollowUp,expandQuestion,academicYear} from './conversation.js?v=4';

const searchCache=new WeakMap(),metadataCache=new WeakMap();
function metadata(data){
  if(metadataCache.has(data))return metadataCache.get(data);
  const registry=new Map(data.sources.map(s=>[s.url,s])),bySource=new Map(),byTitle=new Map(),byHeading=new Map();
  for(const p of data.passages){
    if(!bySource.has(p.source))bySource.set(p.source,[]);bySource.get(p.source).push(p);
    const title=registry.get(p.source)?.title;
    if(!byTitle.has(title))byTitle.set(title,[]);byTitle.get(title).push(p);
    if(!byHeading.has(p.heading))byHeading.set(p.heading,[]);byHeading.get(p.heading).push(p);
  }
  const result={registry,bySource,byTitle,byHeading};metadataCache.set(data,result);return result;
}
export function retrieve(data,messages){
  if(!searchCache.has(data))searchCache.set(data,buildSearch(data));
  messages=activeMessages(messages);
  const meta=metadata(data),{registry,bySource,byTitle,byHeading}=meta;
  const allUsers=messages.filter(m=>m.role==='user'),users=allUsers.length>4?[allUsers[0],...allUsers.slice(-3)]:allUsers;
  const search=searchCache.get(data);
  const latest=expandQuestion(users.at(-1).content,data.currentDate||data.builtAt);
  // A short reply needs the question the assistant just asked as well as the user's topic.
  const previous=messages.slice(0,-1).filter(m=>m.role==='assistant').at(-1)?.content||'';
  const combined=users.map(m=>expandQuestion(m.content,data.currentDate||data.builtAt)).join(' ');
  // Assistant prose can contain many unrelated names and dates. Only use its
  // last question for a short reply, and keep factual retrieval on user topics.
  const asked=previous.split(/\n/).at(-1)||'';
  const queries=[combined,...users.slice(0,-1).reverse().map(m=>expandQuestion(m.content,data.currentDate||data.builtAt))];
  if(users.length===1||!isFollowUp(latest))queries.unshift(latest);
  if(latest.length<60&&asked.endsWith('?'))queries.push(latest+' '+asked.slice(0,250));
  if(/temporary/i.test(combined)&&/permanent/i.test(combined))queries.splice(1,0,'course modification start proposal');
  if(/\babm\b/i.test(combined)&&/4\s*\+\s*1/.test(combined))queries.unshift('ABM','4+1');
  const seen=new Set(),found=[];
  // Round-robin prevents one broad query exhausting the evidence budget before context is searched.
  const lists=[...new Set(queries.map(q=>q.trim()))].map(q=>{const exact=search(q,8);return exact.length?exact:search(q,8,true);});
  ranked: for(let rank=0;rank<8;rank++)for(const list of lists){
    const r=list[rank];if(!r)continue;
    const key=r.p.id===undefined?r.p.source+'\n'+r.p.heading+'\n'+r.p.text:r.p.id;
    if(seen.has(key))continue;seen.add(key);found.push(r);
    if(found.length===12)break ranked;
  }
  // Procedural introductions often rank below individual field names. Include the
  // actual start instructions rather than forcing the model to infer navigation.
  for(const source of new Set(found.map(r=>r.p.source))){
    const p=bySource.get(source)?.find(p=>p.heading==='Start the Proposal');
    if(p&&!found.some(r=>r.p===p))found.push({p,source:registry.get(source)});
    const image=[...bySource.entries()].filter(([url])=>url.startsWith(source+'#')).flatMap(([,p])=>p).find(p=>/Create a new version/i.test(p.text)&&/Create a new revision/i.test(p.text));
    if(image&&!found.some(r=>r.p===image)&&found.length<16)found.push({p:image,source:registry.get(image.source)});
    if(registry.get(source)?.title==='Course Modification Proposal Walkthrough')for(const heading of ['Submit to the Workflow','So, what happens now?']){const p=bySource.get(source)?.find(p=>p.heading===heading);if(p&&!found.some(r=>r.p===p)&&found.length<16)found.push({p,source:registry.get(source)});}
    if(found.length>=16)break;
  }
  if(/course|class|prerequis/i.test(combined)&&/chang|modif|permanent/i.test(combined)){
    const taxonomy=byHeading.get('Course change classifications (full source)')?.[0];
    if(taxonomy){const at=found.findIndex(r=>r.p===taxonomy);if(at>=0)found.splice(at,1);found.unshift({p:taxonomy,source:registry.get(taxonomy.source)});if(found.length>16)found.length=16;}
  }
  // Calendar records carry the actual date property. Include those records beside
  // narrative schedules so the model can surface conflicting published dates.
  if(/graduate council|grad council/i.test(combined)&&/when|date|meeting|calendar/i.test(combined)){
    const dates=(byTitle.get('Graduate Council Meeting')||[]).filter(p=>/^Date:/.test(p.text));
    const extras=dates.filter(p=>!found.some(r=>r.p===p)).map(p=>({p,source:registry.get(p.source)}));
    return [...extras,...found].slice(0,20);
  }
  // Access instructions and named tracker rows should precede loosely related reports.
  const priority=[];
  if(/course|class|prerequis/i.test(combined)&&/chang|modif|permanent/i.test(combined)){
    const manual=bySource.get('https://web.uri.edu/manual/appendix-e-specific-procedures-for-processing-curricular-materials/')||[];
    // These consecutive section chunks keep classification and its review path
    // together even when the compact index has not hydrated their text yet.
    for(const p of manual.filter(p=>p.heading==='Part 3. Approval Process').slice(0,5))priority.push({p,source:registry.get(p.source)});
  }
  if(/kuali/i.test(combined)&&/start|access|log.?in|using|begin|use|staff|faculty/i.test(combined)){
    for(const heading of ['Faculty Access','Non-Faculty Access','Logging In','Accessing the Curriculum App','The Kuali Dashboard']){
      const p=byTitle.get('Kuali Basics')?.find(p=>p.heading===heading);
      if(p)priority.push({p,source:registry.get(p.source)});
    }
  }
  let guide;
  if(/how|steps|start|create|establish|propose|proposing|submit|need|require/i.test(combined)&&(!/\b(?:approved|status|happened|whether)\b/i.test(latest)||/\b(?:propose|start|create|establish|submit|change|modify)\b/i.test(latest))){
    const modified=/chang|modif|revise|permanent/i.test(combined);
    if(/specialization/i.test(combined))guide=(modified?'Specialization Modification':'New Specialization')+' Proposal Walkthrough';
    else if(/\bnew (?:undergraduate |graduate |temporary )?course\b/i.test(combined)&&!modified)guide='New Course Proposal Walkthrough';
    else if(/\b(?:program|degree|major|minor|certificate)\b/i.test(combined)&&/\bnew\b|chang|modif/i.test(combined))guide=(modified?'Program Modification':'New Program')+' Proposal Walkthrough';
    else if(/course|class/i.test(combined)&&modified)guide='Course Modification Proposal Walkthrough';
    if(guide){
      const pages=byTitle.get(guide)||[];
      for(const heading of ['Start the Proposal','Submit to the Workflow','So, what happens now?']){const p=pages.find(p=>p.heading===heading);if(p)priority.push({p,source:registry.get(p.source)});}
      // Do not give the model conflicting start buttons from another form.
      for(let i=found.length-1;i>=0;i--)if(/Proposal Walkthrough$/.test(found[i].source.title)&&found[i].source.title!==guide)found.splice(i,1);
    }
  }
  if(/after.*approv|once.*approv/i.test(latest)&&!guide){const p=(byTitle.get('When will my proposal be approved?')||[]).find(p=>/after the Senate Meeting/.test(p.heading));if(p)priority.push({p,source:registry.get(p.source)});}
  if(/contact|staff|office|located|location|address|phone|email/i.test(latest)&&/faculty senate|spitale|genvi[eé]ve/i.test(latest))for(const title of ['Staff','Contact'])priority.push(...(byTitle.get(title)||[]).slice(1).map(p=>({p,source:registry.get(p.source)})));
  const entityQuestion=users.length>1&&isFollowUp(latest)?expandQuestion(users[0].content,data.currentDate||data.builtAt):latest;
  const entity=tokens(entityQuestion).filter(w=>!new Set('approval program major degree status proposal happened academic year last current any not approved start denied rejected bs ba ms phd'.split(' ')).has(w)&&!/^\d+$/.test(w));
  if(/approval|approved|status|happened|track/i.test(combined)&&entity.length){
    const year=latest.match(/(20\d{2})\s*[-–]\s*(20\d{2}|\d{2})/)?.[1];
    if(!meta.trackerRows)meta.trackerRows=data.sources.filter(s=>s.kind==='Faculty Senate proposal tracker').flatMap(source=>(bySource.get(source.url)||[]).filter(p=>Number(p.heading.match(/\| Row (\d+) \|/)?.[1])>=3).map(p=>({p,source,words:new Set(tokens(p.heading.split(/\| Row \d+ \|/)[1]))})));
    const rows=meta.trackerRows.map(r=>({...r,hits:entity.filter(w=>r.words.has(w)).length})).filter(r=>r.hits>=Math.min(2,entity.length)&&r.hits/entity.length>=.6&&(!year||r.source.title.includes(year))).sort((a,b)=>b.hits-a.hits||trackerYear(b.source)-trackerYear(a.source));
    const best=rows[0]?.hits;
    priority.push(...rows.filter(r=>r.hits===best).slice(0,6));
  }
  if(/\bbills?\b|legislation/i.test(latest)&&/what is|difference|different|how.*approv|process/i.test(latest)){
    // An old transmittal form is not needed to explain current legislation.
    for(let i=found.length-1;i>=0;i--)if(found[i].source.kind==='Faculty Senate PDF'||found[i].source.kind==='Faculty Senate proposal tracker')found.splice(i,1);
    priority.push(...(byTitle.get('Appendix C: By-Laws of the Faculty Senate – University Manual')||[]).filter(p=>/^Section (?:8|10)\./.test(p.heading)).slice(0,5).map(p=>({p,source:registry.get(p.source)})));
    const overview=byTitle.get('Legislation')?.[1];if(overview)priority.push({p:overview,source:registry.get(overview.source)});
    const approval=(bySource.get('https://web.uri.edu/manual/appendix-e-specific-procedures-for-processing-curricular-materials/')||[]).find(p=>p.heading==='Part 3. Approval Process');if(approval)priority.push({p:approval,source:registry.get(approval.source)});
    priority.push(...(byTitle.get('When will my proposal be approved?')||[]).filter(p=>/after the Senate Meeting/i.test(p.heading)).map(p=>({p,source:registry.get(p.source)})));
  }
  const merged=[],keys=new Set();for(const r of [...priority,...found]){const k=r.p.id===undefined?r.p.source+'\n'+r.p.heading+'\n'+r.p.text:r.p.id;if(!keys.has(k)){keys.add(k);merged.push(r);}if(merged.length===16)break;}
  return merged;
}
function trackerYear(source){return Math.max(...(source.title.match(/20\d{2}/g)||['0']).map(Number));}

// For a year-wide status question, inspect every primary program row before
// producing a summary. Ranked excerpts cannot establish an exhaustive result.
export async function gatherEvidence(data,messages,fetcher=fetch){
  const scoped=activeMessages(messages),q=expandQuestion(scoped.at(-1).content,data.currentDate||data.builtAt);
  let passages=await hydrateEvidence(data,retrieve(data,messages),fetcher);
  if(!/\b(?:any|all|which|how many)\b/i.test(q)||!/program/i.test(q)||!/not approved|denied|rejected|status|pending|incomplete/i.test(q))return passages;
  const year=q.match(/(20\d{2})\s*[-–]\s*(20\d{2}|\d{2})/)?.[1]||academicYear(data.currentDate||data.builtAt).current.split('-')[0];
  const source=data.sources.find(s=>s.kind==='Faculty Senate proposal tracker'&&s.title.includes(year));
  if(!source)return passages;
  const primary=data.passages.filter(p=>p.source===source.url&&/Sheet: [BC]\./.test(p.heading)&&/\| Row \d+ \|/.test(p.heading));
  if(!primary.length)return passages;
  const hydrated=await hydrateEvidence(data,primary.map(p=>({p,source})),fetcher),records=hydrated.filter(r=>{const status=r.p.text.match(/(?:^|\|)\s*Status:\s*([^|]+)/)?.[1].trim();return status&&status!=='Status';});
  const counts={},pending=[];for(const r of records){const status=r.p.text.match(/(?:^|\|)\s*Status:\s*([^|]+)/)[1].trim();counts[status]=(counts[status]||0)+1;if(status!=='Complete')pending.push(r);}
  const summary={source,p:{source:source.url,heading:source.title+' — primary program tabs, complete status audit',text:`Snapshot audit of the primary B and C program tabs. ${records.length} rows have a recorded status (header rows excluded; blank statuses are not counted). Recorded status counts: ${JSON.stringify(counts)}. These are tracker rows, not necessarily distinct degree programs. A status other than Complete does not mean denied. Rows whose recorded status is not Complete:\n`+pending.map(r=>r.p.heading+'\n'+r.p.text).join('\n\n')+(pending.length?'':'None among rows with recorded statuses.') }};
  return [summary,...pending,...passages].slice(0,20);
}
