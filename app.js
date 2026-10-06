import {buildSearch,emailLink} from './search.js';
const $=s=>document.querySelector(s);
const results=$('#results'),status=$('#load-status'),input=$('#question'),submit=$('#submit');
let data,coverage,search,question='';
const date=s=>new Date(s).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function link(label,url,cls){const n=el('a',label,cls);n.href=url;if(!url.startsWith('mailto:')){n.target='_blank';n.rel='noopener';}return n;}
function fallback(empty){
  const box=el('div',undefined,'fallback');
  box.append(el('h3',empty?'Let’s get your question to the right person.':'Still need help with your question?'));
  box.append(el('p',empty?'You can email Genviéve Spitale, Specialist | Faculty Senate, with the exact question you entered.':'If these passages don’t resolve your question, you can send your original question to Genviéve Spitale.'));
  const a=link('Email Genviéve with this question',emailLink(question),'email-link');box.append(a);
  box.append(el('small','Opens your email app. Review the draft and send it yourself. Nothing is sent automatically.'));
  if(question.length>1800)box.append(el('small','For a long question, your email app may shorten the draft. Check that the full question above is included before sending.'));
  return box;
}
function run(){
  if(!search||!input.value.trim())return;
  question=input.value;results.replaceChildren();results.setAttribute('aria-busy','true');
  const found=search(question);
  const head=el('div',undefined,'result-head');head.append(el('h3',found.length?'Relevant guidance':'No clear match found'),el('span',found.length?'Original source excerpts':'Search prototype'));results.append(head,el('div',question,'searched'));
  if(!found.length)results.append(el('p','I couldn’t find a clear match in the indexed resources. This prototype searches source text; a missing match does not mean the guidance doesn’t exist.','empty-note'));
  else{
    results.append(el('p','These passages may help. Read the linked source to confirm how the guidance applies to your situation.','empty-note'));
    if(/\b(date|dates|deadline|deadlines|when|calendar|next|today|tomorrow)\b/i.test(question))results.append(el('p','Dates may belong to different academic years. Check the current approval calendar before relying on a deadline.','notice'));
    for(const r of found){
      const card=el('article',undefined,'source-card');card.append(el('span',r.source.kind,'source-kind'),el('h4',r.p.heading));
      if(r.source.notice)card.append(el('p',r.source.notice,'notice'));
      card.append(el('blockquote',r.p.text,'excerpt'));
      const foot=el('div',undefined,'source-link');foot.append(link('Read source: '+r.source.title,r.p.source),el('span','Snapshot '+date(r.source.fetchedAt)));card.append(foot);results.append(card);
    }
  }
  results.append(fallback(!found.length));results.setAttribute('aria-busy','false');
}
$('#question-form').addEventListener('submit',e=>{e.preventDefault();run();});
input.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();run();}});
for(const b of document.querySelectorAll('[data-question]'))b.addEventListener('click',()=>{input.value=b.dataset.question;run();input.focus();});
$('#new-question').addEventListener('click',()=>{question='';input.value='';results.replaceChildren();input.focus();});
$('#sources-button').addEventListener('click',()=>$('#source-dialog').showModal());
$('#close-dialog').addEventListener('click',()=>$('#source-dialog').close());
$('#source-dialog').addEventListener('click',e=>{if(e.target===$('#source-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
try{
  const [a,b]=await Promise.all([fetch('data/index.json'),fetch('data/coverage.json')]);
  if(!a.ok||!b.ok)throw new Error('Source files unavailable');data=await a.json();coverage=await b.json();search=buildSearch(data);submit.disabled=false;
  for(const b of document.querySelectorAll('[data-question]'))b.disabled=false;
  const toolkit=data.sources.filter(s=>s.kind==='Curriculum Toolkit').length;
  status.textContent=`${data.sources.length} sources indexed · ${toolkit} toolkit pages · Snapshot ${date(data.builtAt)} · Search prototype`;
  const c=$('#coverage');c.append(el('p',`${data.sources.length} sources and ${data.passages.length} passages. Snapshot collected ${date(data.builtAt)}.`));
  const ul=el('ul');for(const text of coverage.limitations)ul.append(el('li',text));c.append(ul);
  if(coverage.failures.length){const detail=el('details');detail.append(el('summary',`${coverage.failures.length} import issues or partial sources`));for(const f of coverage.failures)detail.append(el('p',`${f.url} — ${f.reason}`,'coverage-fail'));c.append(detail);}
  if(coverage.externalLinksNotIndexed.length){const detail=el('details');detail.append(el('summary','Linked resources outside this index'));for(const url of coverage.externalLinksNotIndexed){const p=el('p',undefined,'coverage-fail');p.append(link(url,url));detail.append(p);}c.append(detail);}
  const list=$('#source-list');for(const s of [...data.sources].sort((a,b)=>a.kind.localeCompare(b.kind)||a.title.localeCompare(b.title))){const row=el('div',undefined,'listed-source');row.append(link(s.title,s.url),el('span',s.kind+(s.notice?' · Development notice':'')));list.append(row);}
}catch(err){status.textContent='Source snapshot could not load. Please reload the page. You can also open the toolkit directly.';$('#coverage').append(el('p','The source snapshot could not load. Please reload.'));}
