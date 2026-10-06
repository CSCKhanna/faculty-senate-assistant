import {loadCorpus,hydrateEvidence} from './corpus.js?v=2';
import {buildSearch,emailLink,conversationContext} from './search.js?v=8';
import {renderAnswer,sourceUrl,referenceLabel} from './presentation.js?v=3';
import {isFollowUp} from './conversation.js?v=3';
import {CHAT_API_URL} from './config.js';
const $=s=>document.querySelector(s),results=$('#results'),status=$('#load-status'),input=$('#question'),submit=$('#submit'),scroller=$('#chat-scroll'),panel=$('#chat-panel');
const VISIT_KEY='senate-assistant-visit-v1:'+location.pathname,BASE=new URL('./',location.href).href;
let manifest,data,search,indexPromise,inventoryPromise,question='',messages=[],records=[],busy=false,connected=false,ready=false,lastAnswer,quotaUntil=0;
const date=s=>new Date(s).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function link(label,url,cls){const n=el('a',label,cls);n.href=url;if(!url.startsWith('mailto:')){n.target='_blank';n.rel='noopener noreferrer';}return n;}
function button(label,action,cls){const n=el('button',label,cls);n.type='button';n.addEventListener('click',action);return n;}
function persist(){try{sessionStorage.setItem(VISIT_KEY,JSON.stringify({question,records,draft:input.value}));}catch{/* Chat remains usable when browser storage is disabled. */}}
function setBusy(value){busy=value;submit.disabled=!ready||busy;$('#new-question').disabled=busy;results.setAttribute('aria-busy',String(busy));for(const b of document.querySelectorAll('[data-question]'))b.disabled=!ready||busy;}
function syncMode(){
  submit.textContent=connected?'Send':'Search';
  const label=records.length?'Reply or ask a follow-up':'Your question';$('#question-label').textContent=label;input.setAttribute('aria-label',label);
  input.placeholder=records.length?'Type your reply here…':'Type your question here…';
  $('#mode-note').textContent=connected?'Enter to send · Shift + Enter for a new line':'Source search · Enter to search';
  const snapshot=manifest?`${manifest.sourceCount.toLocaleString()} sources · Updated ${date(manifest.builtAt)} · `:'';
  status.textContent=snapshot+(connected?'AI assistant connected':quotaUntil>Date.now()?'Daily AI limit reached · source search available':'AI unavailable · source search available');
  $('#reconnect').hidden=connected||quotaUntil>Date.now();
}
async function checkConnection(){
  if(quotaUntil>Date.now()){connected=false;syncMode();return false;}
  try{const r=await fetch(CHAT_API_URL+'/health',{signal:AbortSignal.timeout(10000)}),h=r.ok&&await r.json();connected=Boolean(h?.ready);if(!manifest&&h?.snapshot)manifest={builtAt:h.snapshot,sourceCount:h.sourceCount};}catch{connected=false;}
  syncMode();return connected;
}
function scrollChat(){scroller.scrollTop=scroller.scrollHeight;}
function revealAnswer(bubble,user){
  lastAnswer=bubble;
  const target=user&&user.offsetHeight<scroller.clientHeight*.35?user:bubble;
  scroller.scrollTop=Math.max(0,target.offsetTop-12);$('#jump-latest').hidden=true;
}
function startConversation(){panel.classList.add('has-conversation');syncMode();}
function messageBubble(role,text){
  const bubble=el('article',undefined,'chat-message '+role);
  bubble.append(el('span',role==='user'?'You':'Faculty Senate Assistant','chat-role'),el('p',text,'chat-text'));
  results.append(bubble);return bubble;
}
function emailAction(original=question){return link('Email Genviéve with the original question',emailLink(original),'chat-email');}
function renderResponse(bubble,answer){
  bubble.querySelector('.chat-text')?.remove();bubble.append(renderAnswer(answer.answer,answer.sources));
  if(answer.followUp)bubble.append(el('p',answer.followUp,'chat-followup'));
  const sources=answer.sources.filter(sourceUrl);
  if(sources.length){
    const references=el('details',undefined,'chat-references');references.append(el('summary',`Sources (${sources.length})`));
    const citations=el('div',undefined,'chat-citations');
    for(const source of sources){
      const row=el('div',undefined,'chat-reference');row.append(link('['+source.id+'] '+referenceLabel(source),sourceUrl(source)));
      const sections=[...new Set(source.sections||[source.section])].filter(s=>s&&s!==source.title);
      if(sections.length)row.append(el('small',sections.join(' · '),'reference-section'));citations.append(row);
    }
    const notices=[...new Set(sources.map(s=>s.notice).filter(Boolean))];
    if(notices.length){const notes=el('details',undefined,'source-notes');notes.append(el('summary','Source qualifications'));for(const note of notices)notes.append(el('p',note));citations.append(notes);}
    references.append(citations);bubble.append(references);
  }
  const actions=el('div',undefined,'answer-actions');
  if(answer.retryable){const retry=button('Retry this question',()=>retryLast(bubble),'retry-answer');actions.append(retry);}
  if(answer.kind==='unanswered'||answer.kind==='error'||answer.kind==='sources'){
    if(answer.escalatable!==false)actions.append(emailAction(answer.originalQuestion||question));bubble.append(actions);if(answer.escalatable!==false)bubble.append(el('small','Opens an unsent draft in your email app. Review it before sending.','chat-note'));
  }else{
    if(answer.kind==='answer')actions.append(button('Copy answer',async e=>{
      const b=e.currentTarget,plain=answer.answer.replace(/\*\*|`/g,'')+(sources.length?'\n\nSources\n'+sources.map(s=>`[${s.id}] ${referenceLabel(s)} — ${sourceUrl(s)}`).join('\n'):'');
      try{await navigator.clipboard.writeText(plain);b.textContent='Copied';$('#action-status').textContent='Answer and references copied.';}catch{b.textContent='Select answer to copy';$('#action-status').textContent='Clipboard access is unavailable. Select the answer text to copy it.';}
    },'copy-answer'));
    if(answer.kind==='answer'){const help=el('details',undefined,'staff-help');help.append(el('summary','Contact Faculty Senate'),emailAction(answer.originalQuestion||question),el('small','Genviéve Spitale · Specialist | Faculty Senate. Opens an unsent email draft.','chat-note'));actions.append(help);}
    if(actions.childNodes.length)bubble.append(actions);
  }
}
async function ensureIndex(){
  if(!indexPromise)indexPromise=(async()=>{
    if(!manifest?.corpusBase){const r=await fetch('data/corpus-manifest.json',{cache:'no-store'});if(!r.ok)throw new Error('Snapshot unavailable');manifest=await r.json();}
    data=await loadCorpus(manifest,fetch,BASE);search=buildSearch(data);return data;
  })().catch(e=>{indexPromise=undefined;throw e;});
  return indexPromise;
}
async function sourceAnswer(original){
  await ensureIndex();
  const {retrieve}=await import('./retrieval.js?v=1');
  const found=await hydrateEvidence(data,retrieve(data,conversationContext(messages)).slice(0,8),fetch);
  if(!found.length)return {kind:'unanswered',answer:'I couldn’t find a clear source match for this question. You can add a course code, program name, committee, or academic year, or ask Genviéve using the email option below.',sources:[],followUp:''};
  const unique=[];for(const r of found)if(!unique.some(x=>x.p.source===r.p.source))unique.push(r);
  return {kind:'sources',answer:'The AI response is unavailable. These published source excerpts may help; open the references for complete guidance.\n\n'+unique.map((r,i)=>r.source.title+' ['+(i+1)+']\n“'+r.p.text.slice(0,480)+(r.p.text.length>480?'…':'')+'”').join('\n\n'),sources:unique.map((r,i)=>({id:i+1,url:r.p.source,title:r.source.title,section:r.p.heading,notice:r.source.notice})),followUp:''};
}
async function requestAnswer(original){
  if(!connected)await checkConnection();
  if(!connected)return sourceAnswer(original);
  const response=await fetch(CHAT_API_URL+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:conversationContext(messages)}),signal:AbortSignal.timeout(55000)});
  let answer;try{answer=await response.json();}catch{throw new Error('Invalid response');}
  if(response.status===429&&typeof answer.error==='string'&&/daily/i.test(answer.error)){
    const now=new Date();quotaUntil=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1);connected=false;syncMode();
    try{const fallback=await sourceAnswer(original);fallback.answer='The pilot’s daily AI request limit has been reached. '+fallback.answer.replace('The AI response is unavailable. ','');return fallback;}catch{/* Keep the precise limit message if source search also fails. */}
  }
  if(!response.ok){const failure=new Error('Request rejected');failure.publicMessage=typeof answer.error==='string'?answer.error.slice(0,300):'The assistant is temporarily unavailable.';failure.retryable=response.status!==400&&response.status!==413&&!(response.status===429&&/daily/i.test(failure.publicMessage));throw failure;}
  if(!['answer','clarification','unanswered','sources'].includes(answer.kind)||typeof answer.answer!=='string'||!answer.answer.trim()||answer.answer.length>6500||/<\/?[a-z][\w:-]*(?:\s[^>]*|\/)?>/i.test(answer.answer)||!Array.isArray(answer.sources)||answer.sources.some(s=>!s||!Number.isInteger(s.id)||typeof s.url!=='string'||typeof s.title!=='string'))throw new Error('Incomplete response');
  return answer;
}
async function deliver(original,bubble,user){
  setBusy(true);
  try{
    const answer=await requestAnswer(original);answer.originalQuestion=question;const wasNearEnd=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<90;
    bubble.replaceChildren(el('span','Faculty Senate Assistant','chat-role'));renderResponse(bubble,answer);
    records.push({role:'assistant',...answer});
    if(!answer.retryable)messages.push({role:'assistant',content:answer.answer+(answer.followUp?'\n'+answer.followUp:'')});
    if(wasNearEnd)revealAnswer(bubble,user);else{lastAnswer=bubble;$('#jump-latest').hidden=false;}
  }catch(error){
    const nearEnd=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<90;
    const answer={kind:'error',answer:error.publicMessage||'The assistant couldn’t complete this request. Your question and conversation are preserved. Please retry, or use the email option below.',sources:[],followUp:'',originalQuestion:question,retryable:error.retryable!==false};
    bubble.replaceChildren(el('span','Faculty Senate Assistant','chat-role'));renderResponse(bubble,answer);records.push({role:'assistant',...answer});
    if(nearEnd)revealAnswer(bubble,user);else{lastAnswer=bubble;$('#jump-latest').hidden=false;}
  }finally{setBusy(false);persist();if(!$('#source-dialog').open&&(document.activeElement===submit||document.activeElement===document.body))input.focus({preventScroll:true});}
}
async function run(){
  if(!ready||busy||!input.value.trim())return;
  const original=input.value;
  // An unresolved previous request remains visible, but is not fabricated into
  // the model's history. Old retry buttons stop being actionable after a reply.
  for(const b of document.querySelectorAll('.retry-answer'))b.disabled=true;
  if(!messages.length||!isFollowUp(original))question=original;
  records.push({role:'user',content:original});messages.push({role:'user',content:original});input.value='';
  startConversation();const user=messageBubble('user',original),waiting=messageBubble('assistant',connected?'Checking the published Senate resources…':'Searching the published sources…');scrollChat();persist();
  await deliver(original,waiting,user);
}
async function retryLast(bubble){
  if(!ready||busy||bubble!==results.lastElementChild)return;
  const original=messages.at(-1)?.content;if(messages.at(-1)?.role!=='user')return;
  records.pop();bubble.replaceChildren(el('span','Faculty Senate Assistant','chat-role'),el('p','Checking the published Senate resources…','chat-text'));scrollChat();
  await deliver(original,bubble,bubble.previousElementSibling);
}
function restore(){
  try{
    const saved=JSON.parse(sessionStorage.getItem(VISIT_KEY)||'null');
    if(!saved||!Array.isArray(saved.records)||saved.records.length>300||typeof saved.question!=='string')return;
    question=saved.question;if(typeof saved.draft==='string'&&saved.draft.length<=4000)input.value=saved.draft;
    for(const r of saved.records){
      if(r.role==='user'&&typeof r.content==='string'&&r.content.length<=4000){records.push(r);messages.push(r);messageBubble('user',r.content);}
      else if(r.role==='assistant'&&typeof r.answer==='string'&&r.answer.length<=6500&&Array.isArray(r.sources)){
        records.push(r);const bubble=messageBubble('assistant','');renderResponse(bubble,r);
        if(!r.retryable&&r.kind!=='error')messages.push({role:'assistant',content:r.answer+(r.followUp?'\n'+r.followUp:'')});lastAnswer=bubble;
      }
    }
    if(records.at(-1)?.role==='user'){const pending={role:'assistant',kind:'error',answer:'The previous request was interrupted by the page refresh. Your question is preserved; retry it below.',sources:[],followUp:'',retryable:true,originalQuestion:question};records.push(pending);const bubble=messageBubble('assistant','');renderResponse(bubble,pending);lastAnswer=bubble;}
    for(const b of [...document.querySelectorAll('.retry-answer')])b.disabled=!results.lastElementChild.contains(b);
    if(records.length){startConversation();scrollChat();}
  }catch{/* Ignore an incomplete or invalid saved visit. */}
}
$('#question-form').addEventListener('submit',e=>{e.preventDefault();run();});
let draftTimer;input.addEventListener('input',()=>{clearTimeout(draftTimer);draftTimer=setTimeout(persist,250);});
window.addEventListener('pagehide',persist);
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();run();}});
for(const b of document.querySelectorAll('[data-question]'))b.addEventListener('click',()=>{input.value=b.dataset.question;run();input.focus({preventScroll:true});});
$('#new-question').addEventListener('click',()=>{if(busy)return;messages=[];records=[];question='';input.value='';results.replaceChildren();panel.classList.remove('has-conversation');$('#jump-latest').hidden=true;lastAnswer=null;syncMode();persist();scroller.scrollTop=0;input.focus({preventScroll:true});});
$('#jump-latest').addEventListener('click',()=>{if(lastAnswer)revealAnswer(lastAnswer,lastAnswer.previousElementSibling);});
scroller.addEventListener('scroll',()=>{if(scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<60)$('#jump-latest').hidden=true;});
$('#reconnect').addEventListener('click',async e=>{const b=e.currentTarget;b.disabled=true;b.textContent='Checking…';await checkConnection();b.disabled=false;b.textContent='Reconnect AI';});
function lazyDetails(label,items,render){const d=el('details');d.append(el('summary',label));d.addEventListener('toggle',()=>{if(d.open&&!d.dataset.loaded){d.dataset.loaded='true';for(const item of items)d.append(render(item));}});return d;}
async function loadInventory(){
  if(inventoryPromise)return inventoryPromise;
  inventoryPromise=(async()=>{
    const c=$('#coverage'),list=$('#source-list');c.replaceChildren(el('p','Loading the source inventory…'));list.replaceChildren();
    const [index,r]=await Promise.all([ensureIndex(),fetch('data/coverage.json?v=7',{cache:'no-store'})]);if(!r.ok)throw new Error('Coverage unavailable');const coverage=await r.json();
    c.replaceChildren(el('p',`${index.sources.length.toLocaleString()} sources and ${index.passages.length.toLocaleString()} passages. Snapshot collected ${date(index.builtAt)}.`));
    const ul=el('ul');for(const text of new Set(coverage.limitations||[]))ul.append(el('li',text));c.append(ul);
    if(coverage.website){const w=coverage.website;c.append(el('p',`${w.publishedPagesIndexed} of ${w.publishedPages} published Senate pages/posts indexed, plus linked public documents and ${w.trackers.length} readable proposal trackers with every downloadable tab.`));if(w.gaps.length)c.append(lazyDetails(`${w.gaps.length} website links unavailable or unreadable`,w.gaps,g=>{const p=el('p',undefined,'coverage-fail');p.append(link(g.url,g.url),document.createTextNode(' — '+g.reason));return p;}));}
    if(coverage.failures?.length)c.append(lazyDetails(`${coverage.failures.length} import issues or partial sources`,coverage.failures,f=>el('p',`${f.url} — ${f.reason}`,'coverage-fail')));
    if(coverage.externalLinksNotIndexed?.length)c.append(lazyDetails('Linked resources outside this index',coverage.externalLinksNotIndexed,url=>{const p=el('p',undefined,'coverage-fail');p.append(link(url,url));return p;}));
    const label=el('label','Filter the source inventory');label.htmlFor='source-filter';const filter=el('input');filter.type='search';filter.id='source-filter';filter.placeholder='Title or resource type';
    const count=el('p',undefined,'inventory-count'),rows=el('div'),more=button('Show more sources',()=>{limit+=100;draw();},'inventory-more');let limit=100;
    const sorted=[...index.sources].sort((a,b)=>a.kind.localeCompare(b.kind)||a.title.localeCompare(b.title));
    function draw(){const q=filter.value.trim().toLowerCase(),matches=sorted.filter(s=>(s.title+' '+s.kind).toLowerCase().includes(q));rows.replaceChildren();count.textContent=`Showing ${Math.min(limit,matches.length).toLocaleString()} of ${matches.length.toLocaleString()} matching sources`;more.hidden=matches.length<=limit;for(const s of matches.slice(0,limit)){const row=el('div',undefined,'listed-source');row.append(link(s.title,s.url),el('span',s.kind+(s.notice?' · Source qualification':'')));rows.append(row);}}
    filter.addEventListener('input',()=>{limit=100;draw();});list.append(label,filter,count,rows,more);draw();
  })().catch(()=>{$('#coverage').replaceChildren(el('p','The source inventory could not load. The direct toolkit and Senate links above remain available.'),button('Retry loading sources',()=>loadInventory(),'inventory-more'));inventoryPromise=undefined;});
  return inventoryPromise;
}
function openSources(){$('#source-dialog').showModal();loadInventory();}
for(const id of ['sources-button','sources-mobile','about-service'])$('#'+id).addEventListener('click',openSources);
$('#close-dialog').addEventListener('click',()=>$('#source-dialog').close());
$('#source-dialog').addEventListener('click',e=>{if(e.target===$('#source-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
if(window.visualViewport){const viewport=()=>document.documentElement.style.setProperty('--viewport-height',window.visualViewport.height+'px');window.visualViewport.addEventListener('resize',viewport);viewport();}
restore();
await Promise.allSettled([fetch('data/corpus-manifest.json',{cache:'no-store'}).then(async r=>{if(r.ok)manifest=await r.json();}),checkConnection()]);
ready=true;syncMode();setBusy(false);
