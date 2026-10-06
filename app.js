import {loadCorpus,hydrateEvidence} from './corpus.js';
import {buildSearch,emailLink,conversationContext} from './search.js?v=7';
import {CHAT_API_URL} from './config.js';
const $=s=>document.querySelector(s);
const results=$('#results'),status=$('#load-status'),input=$('#question'),submit=$('#submit');
let data,coverage,search,question='',messages=[],busy=false,connected=false;
const scroller=$('#chat-scroll'),panel=$('#chat-panel');
function scrollChat(){scroller.scrollTop=scroller.scrollHeight;}
function startConversation(){
  panel.classList.add('has-conversation');
  $('#question-label').textContent=connected?'Reply or ask a follow-up':'Your question';
  input.placeholder=connected?'Type your reply here…':'Type your question here…';
}
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
async function runSourceSearch(){
  if(!search||!input.value.trim())return;
  startConversation();question=input.value;results.replaceChildren();results.setAttribute('aria-busy','true');
  let found;try{found=await hydrateEvidence(data,search(question));}catch{results.append(el('p','Source excerpts could not load. Please try again shortly.'));results.setAttribute('aria-busy','false');return;}
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
  results.append(fallback(!found.length));results.setAttribute('aria-busy','false');scrollChat();
}
function messageBubble(role,text){
  const bubble=el('article',undefined,'chat-message '+role);
  bubble.append(el('span',role==='user'?'YOU':'FACULTY SENATE ASSISTANT','chat-role'),el('p',text,'chat-text'));
  results.append(bubble);scrollChat();return bubble;
}
async function run(){
  if(!input.value.trim()||busy)return;
  if(!connected){runSourceSearch();return;}
  startConversation();
  const original=input.value;
  if(!messages.length){question=original;results.replaceChildren();}
  messages.push({role:'user',content:original});messageBubble('user',original);input.value='';
  busy=true;submit.disabled=true;results.setAttribute('aria-busy','true');
  const waiting=messageBubble('assistant','Looking through Senate resources…');
  try{
    const response=await fetch(CHAT_API_URL+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:conversationContext(messages)}),signal:AbortSignal.timeout(55000)});
    const answer=await response.json();if(!response.ok)throw new Error(answer.error||'The assistant is unavailable.');
    if(typeof answer.answer!=='string'||!Array.isArray(answer.sources))throw new Error('The assistant returned an incomplete answer.');
    waiting.remove();const bubble=messageBubble('assistant',answer.answer);
    if(answer.followUp)bubble.append(el('p',answer.followUp,'chat-followup'));
    if(answer.sources.length){const citations=el('div',undefined,'chat-citations');
      for(const source of answer.sources){
        const citationUrl=source.url.replace(/^http:\/\/web\.uri\.edu\//,'https://web.uri.edu/');
        if(!/^https:\/\/(gilded-toucan-d8a\.notion\.site|web\.uri\.edu|digitalcommons\.uri\.edu|docs\.google\.com|drive\.google\.com)\//.test(citationUrl))continue;
        citations.append(link('['+source.id+'] '+source.title,citationUrl));
        if(source.notice)citations.append(el('p',source.notice,'notice'));
      }bubble.append(citations);
    }
    bubble.append(el('small',answer.kind==='sources'?'Original source excerpts. Open the linked source for complete guidance.':'AI-generated guidance. Check the linked sources.','chat-note'));
    if(answer.kind!=='clarification'){const email=link('Email Genviéve with my original question',emailLink(question),'chat-email');bubble.append(email);}
    messages.push({role:'assistant',content:answer.answer+(answer.followUp?'\n'+answer.followUp:'')});
  }catch(error){waiting.remove();const bubble=messageBubble('assistant',error.message+' You can still consult the related guidance below.');
    for(const r of await hydrateEvidence(data,search(original,2,true)).catch(()=>[])){bubble.append(el('p',r.p.text.slice(0,900),'excerpt'),link('Read '+r.source.title,r.p.source));}
    messages.pop();input.value=original;}
  finally{busy=false;submit.disabled=false;results.setAttribute('aria-busy','false');scrollChat();input.focus({preventScroll:true});}
}
$('#question-form').addEventListener('submit',e=>{e.preventDefault();run();});
input.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();run();}});
for(const b of document.querySelectorAll('[data-question]'))b.addEventListener('click',()=>{input.value=b.dataset.question;run();input.focus();});
$('#new-question').addEventListener('click',()=>{if(busy)return;messages=[];question='';input.value='';results.replaceChildren();panel.classList.remove('has-conversation');$('#question-label').textContent='Your question';input.placeholder='Type your question here…';scroller.scrollTop=0;input.focus({preventScroll:true});});
$('#sources-button').addEventListener('click',()=>$('#source-dialog').showModal());
$('#close-dialog').addEventListener('click',()=>$('#source-dialog').close());
$('#source-dialog').addEventListener('click',e=>{if(e.target===$('#source-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
try{
  const [a,b]=await Promise.all([fetch('data/corpus-manifest.json',{cache:'no-store'}),fetch('data/coverage.json?v=7',{cache:'no-store'})]);
  if(!a.ok||!b.ok)throw new Error('Source files unavailable');data=await loadCorpus(await a.json());coverage=await b.json();search=buildSearch(data);submit.disabled=false;
  for(const b of document.querySelectorAll('[data-question]'))b.disabled=false;
  const toolkit=data.sources.filter(s=>s.kind==='Curriculum Toolkit').length;
  const entries=coverage.toolkit?.databaseEntries||0;
  if(CHAT_API_URL){try{const h=await fetch(CHAT_API_URL+'/health',{signal:AbortSignal.timeout(10000)});connected=h.ok&&(await h.json()).ready;}catch{connected=false;}}
  status.textContent=`${data.sources.length} sources indexed · ${toolkit} toolkit pages + ${entries} database entries · Snapshot ${date(data.builtAt)} · ${connected?'Sonnet conversational pilot':'Source search — AI connection pending'}`;
  submit.textContent=connected?'Send question':'Find guidance';
  $('#mode-note').textContent=connected?'Answers grounded in the toolkit, Senate website and proposal trackers.':'Source search available while the AI connection is being set up.';
  const c=$('#coverage');c.append(el('p',`${data.sources.length} sources and ${data.passages.length} passages. Snapshot collected ${date(data.builtAt)}.`));
  const ul=el('ul');for(const text of coverage.limitations)ul.append(el('li',text));c.append(ul);
  if(coverage.website){const w=coverage.website;c.append(el('p',`${w.publishedPagesIndexed} of ${w.publishedPages} published Senate pages/posts indexed, plus linked documents and ${w.trackers.length} proposal trackers with all downloadable tabs.`));if(w.gaps.length){const d=el('details');d.append(el('summary',`${w.gaps.length} website links unavailable or unreadable`));for(const gap of w.gaps){const p=el('p',undefined,'coverage-fail');p.append(link(gap.url,gap.url),document.createTextNode(' — '+gap.reason));d.append(p);}c.append(d);}}
  if(coverage.failures.length){const detail=el('details');detail.append(el('summary',`${coverage.failures.length} import issues or partial sources`));for(const f of coverage.failures)detail.append(el('p',`${f.url} — ${f.reason}`,'coverage-fail'));c.append(detail);}
  if(coverage.externalLinksNotIndexed.length){const detail=el('details');detail.append(el('summary','Linked resources outside this index'));for(const url of coverage.externalLinksNotIndexed){const p=el('p',undefined,'coverage-fail');p.append(link(url,url));detail.append(p);}c.append(detail);}
  const list=$('#source-list');for(const s of [...data.sources].sort((a,b)=>a.kind.localeCompare(b.kind)||a.title.localeCompare(b.title))){const row=el('div',undefined,'listed-source');row.append(link(s.title,s.url),el('span',s.kind+(s.notice?' · Source note':'')));list.append(row);}
}catch(err){status.textContent='Source snapshot could not load. Please reload the page. You can also open the toolkit directly.';$('#coverage').append(el('p','The source snapshot could not load. Please reload.'));}
