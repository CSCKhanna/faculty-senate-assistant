import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadCorpus,hydrateEvidence} from '../corpus.js';
import {retrieve,parseAnswer,validateMessages,converse} from '../backend/chat.js';
import {conversationContext} from '../search.js';
import {activeMessages} from '../conversation.js';
import {billEvidence,isBillQuestion} from '../bills.js';
import {answerBlocks,sourceUrl} from '../presentation.js';
const root=new URL('../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root))),manifest=read('data/corpus-manifest.json');
const local=async url=>new Response(fs.readFileSync(new URL(url.split('/faculty-senate-assistant/')[1],root))),corpus=await loadCorpus(manifest,local),bills=read(read('data/bills-manifest.json').path);
const m=q=>[{role:'user',content:q}];
const cases=[
 ['How do I make a temporary course permanent?','Course Modification Proposal Walkthrough',/Propose Changes/],
 ['My temporary class needs to become permanent. Where do I start?','Course Modification Proposal Walkthrough',/Create a new version|Propose Changes/],
 ['How do I change the prerequisites for an existing course?','Course Modification Proposal Walkthrough',/Prerequisites|Requisites/],
 ['How do I modify the title of a course?','Course Modification Proposal Walkthrough',/Title|Propose Changes/],
 ['How do I propose a new undergraduate course?','New Course Proposal Walkthrough',/New Course|Start the Proposal/],
 ['What do I need in the syllabus for a new course?','New Course Proposal Walkthrough',/syllabus/i],
 ['How do I create a new degree program?','New Program Proposal Walkthrough',/program/i],
 ['How do I change an existing program?','Program Modification Proposal Walkthrough',/program/i],
 ['How do I propose a new specialization?','New Specialization Proposal Walkthrough',/specialization/i],
 ['How do I modify an existing specialization?','Specialization Modification Proposal Walkthrough',/specialization/i],
 ['How do I get Kuali access?','Kuali Basics',/Microsoft 365/],
 ['I am staff. How do I access Kuali?','Kuali Basics',/Non-Faculty|Non Faculty|non-faculty/i],
 ['How can I start using Kuali?','Kuali Basics',/Curriculum App|Curriculum Dashboard|Curriculum/],
 ['How do I track my proposal?','Track Your Proposal',/workflow|status/i],
 ['Where can I check the workflow status of my proposal?','Track Your Proposal',/workflow|status/i],
 ['What happens after a proposal is approved?','When will my proposal be approved?',/approval|approved/i],
 ['What does the Academic Calendar Committee do?','The Academic Calendar Committee (ACC)',/calendar/i],
 ['What is the Curriculum and Standards Committee responsible for?','The Curriculum and Standards Committee (CASC)',/curricul/i],
 ['What does the General Education Committee do?','The General Education Committee (GEC)',/general education/i],
 ['What is the Constitution, By-Laws, and University Manual Committee?','Constitution, By-Laws, and University Manual Committee (CBUM)',/manual/i],
 ['Who may attend Faculty Senate meetings, and can a non-senator vote?','Faculty Senate FAQ — FAQ-Page-3.jpg',/general public may attend/i],
 ['How do I contact Faculty Senate staff?','Staff',/Spitale/i],
 ['What Faculty Senate awards are available?','Annual Awards',/award/i],
 ['Was the interdisciplinary AI major approved?','2026–2027 Curriculum Proposal Tracker',/To President/],
 ['What happened to the Environmental Engineering BS proposal in 2025–2026?','2025 - 2026 Curriculum Proposal Tracker',/Status: Complete/],
];
for(const [question,title,fact] of cases)test('grounded retrieval: '+question,async()=>{
 const p=await hydrateEvidence(corpus,retrieve(corpus,m(question)),local);
 assert.ok(p.some(r=>r.source.title===title&&fact.test(r.p.heading+' '+r.p.text)),JSON.stringify(p.map(r=>({title:r.source.title,heading:r.p.heading}))));
});
test('generic workflow follow-ups and a long chat retain the original proposal type',async()=>{
 let history=[...m('How do I make a temporary course permanent?'),{role:'assistant',content:'Use a Course Modification Proposal.'}];
 for(const q of ['What happens after I submit a request?','Which committee reviews it?','How long does approval take?','What are the next steps?','Can you link the source?','Tell me more.','What is the bill number?']){
   history.push({role:'user',content:q});const context=conversationContext(history);assert.equal(context[0].content,history[0].content);validateMessages(context);
   if(!isBillQuestion(context)){const p=await hydrateEvidence(corpus,retrieve(corpus,context),local);assert.ok(p.some(r=>r.source.title==='Course Modification Proposal Walkthrough'));}
   history.push({role:'assistant',content:'Review the course modification instructions.'});
 }
});
test('a clear new topic drops the old topic even after a lengthy conversation',()=>{
 const context=conversationContext([...m('Was the AI degree approved?'),{role:'assistant',content:'Check its tracker.'},{role:'user',content:'Faculty Senate awards'}]);assert.deepEqual(context,m('Faculty Senate awards'));assert.deepEqual(activeMessages(context),context);
});
test('a temporary-course workflow follow-up includes the written minor-change review path',async()=>{
 const context=[...m('How do I make a temporary course permanent?'),{role:'assistant',content:'Use a Course Modification Proposal.'},{role:'user',content:'What happens after I submit a request?'}];
 const p=await hydrateEvidence(corpus,retrieve(corpus,context),local);
 assert.ok(p.some(r=>r.source.url.includes('/appendix-e-')&&/changing an X-course into a permanent course/.test(r.p.text)));
 assert.ok(p.some(r=>r.source.url.includes('/appendix-e-')&&/Minor course change proposals undergo review/.test(r.p.text)&&/full Faculty Senate/.test(r.p.text)));
});
test('general legislation concepts use the manual rather than the identifier route',async()=>{
 for(const q of ['What is a Faculty Senate bill?','How does a bill get approved?','What is the difference between a bill and a report?']){
  assert.equal(isBillQuestion(m(q)),false,q);const p=await hydrateEvidence(corpus,retrieve(corpus,m(q)),local);assert.ok(p.some(r=>r.source.title.startsWith('Appendix C: By-Laws')&&/10\.1/.test(r.p.text)));assert.ok(p.every(r=>r.source.kind!=='Faculty Senate PDF'));
 }
});
test('an exact identifier remains available through a subsequent bill follow-up',async()=>{
 const context=[...m('What is CASC 25-26-07B?'),{role:'assistant',content:'CASC is the Curriculum and Standards Committee.'},{role:'user',content:'What does that bill cover?'}];
 const p=await hydrateEvidence(bills,billEvidence(bills,context),local);assert.ok(p.some(r=>r.source.title==='2025-2026-CASC-07B'));
});
test('generated Markdown links are converted as a whole and repeated document citations consolidated',()=>{
 const source={title:'Course guidance',fetchedAt:manifest.builtAt};const p=[{source,p:{source:'https://web.uri.edu/facsen/',heading:'Start'}},{source,p:{source:'https://web.uri.edu/facsen/',heading:'Submit'}}];
 const a=parseAnswer(JSON.stringify({kind:'answer',answer:'Read the [course guidance](https://web.uri.edu/facsen/) [1][2].',sourceIds:[1,2]}),p);
 assert.equal(a.sources.length,1);assert.deepEqual(a.sources[0].sections,['Start','Submit']);assert.equal(a.answer,'Read the course guidance [1].');
 assert.throws(()=>parseAnswer(JSON.stringify({kind:'answer',answer:'[Click](javascript:alert(1)) [1].',sourceIds:[1]}),p));
 assert.throws(()=>parseAnswer(JSON.stringify({kind:'answer',answer:'<img src=x onerror=alert(1)> [1].',sourceIds:[1]}),p));
});
test('numbered list continuations retain their starting number and wrapped instruction',()=>{
 const blocks=answerBlocks('3. Open the proposal.\n   Select the current version.\n4. Submit for review.');assert.equal(blocks[0].start,3);assert.equal(blocks[0].items[0],'Open the proposal. Select the current version.');
});
test('a fully cited instruction sequence keeps all sources with one closing citation group',()=>{
 const p=[1,2].map(n=>({source:{title:'Guidance '+n},p:{source:'https://web.uri.edu/facsen/'+n,heading:'Start'}}));
 const a=parseAnswer(JSON.stringify({kind:'answer',answer:'1. Open the form [1].\n2. Complete it [1][2].\n3. Submit [1].',sourceIds:[1,2]}),p);
 assert.equal(a.answer,'1. Open the form.\n2. Complete it.\n3. Submit. [1][2]');assert.equal(a.sources.length,2);
});
test('gateway failures provide bounded, qualified source excerpts without an irrelevant follow-up',async()=>{
 const a=await converse(corpus,m('How do I get Kuali access?'),{URI_API_KEY:'test-only'},async()=>{throw new Error('Timeout');},local);assert.equal(a.kind,'sources');assert.equal(a.retryable,true);assert.equal(a.followUp,'');assert.ok(a.answer.length<1300);assert.ok(a.sources.every(s=>s.section));
});
test('large alternating conversations keep the anchor and final question within API bounds',()=>{
 const history=[...m('How do I make a temporary course permanent?')];for(let i=0;i<35;i++){history.push({role:'assistant',content:'Guidance '+i+' '+'.'.repeat(3500)},{role:'user',content:'Tell me more about that course. '+'.'.repeat(3500)});}
 const context=conversationContext(history);validateMessages(context);assert.equal(context[0].content,history[0].content);assert.equal(context.at(-1).content,history.at(-1).content);assert.ok(context.length<=16);assert.ok(context.reduce((n,m)=>n+m.content.length,0)<=20000);
});
test('the complete published corpus matches every source passage, not just spot checks',()=>{
 const full=read('data/index.json');let count=0;
 for(let shard=0;shard<Math.ceil(full.passages.length/corpus.shardSize);shard++){
  const texts=read(corpus.corpusBase+'/text-'+shard+'.json');
  for(let offset=0;offset<texts.length;offset++){const id=shard*corpus.shardSize+offset;assert.equal(texts[offset],full.passages[id].text);assert.equal(corpus.passages[id].source,full.passages[id].source);assert.equal(corpus.passages[id].heading,full.passages[id].heading);count++;}
 }
 assert.equal(count,28573);assert.equal(count,manifest.passageCount);for(const packed of corpus.postings)assert.ok((packed>>>16)<count);
});
test('host allowlisting also rejects embedded credentials and alternate ports',()=>{
 for(const url of ['https://secret@web.uri.edu/facsen/','https://name:secret@docs.google.com/','https://web.uri.edu:8443/facsen/','data:text/html,<script>bad</script>'])assert.equal(sourceUrl({url}),null,url);
});
test('a thank-you gets a courteous acknowledgement without restarting the interview',async()=>{
 const a=await converse(corpus,m('Thank you!'),{},()=>{throw new Error('No paid call needed');});assert.match(a.answer,/welcome/);assert.doesNotMatch(a.answer,/What would you|\?/);assert.equal(a.followUp,'');
});
test('a known unavailable tracker gives a concise staff path without technical errors or another year',async()=>{
 const a=await converse(corpus,m('Can you look up a program in the 2019–2020 curriculum tracker?'),{},()=>{throw new Error('No paid call needed');});
 assert.equal(a.kind,'unanswered');assert.match(a.answer,/2019–2020/);assert.match(a.answer,/requires access/);assert.match(a.answer,/Genviéve/);assert.doesNotMatch(a.answer,/HTTP|401|2025|2026|unauthorized|Which program/);assert.equal(a.followUp,'');
});
test('the coverage disclosure has no repeated limitation paragraphs',()=>{
 const c=read('data/coverage.json');assert.equal(c.limitations.length,new Set(c.limitations).size);
});
