import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {loadCorpus,hydrateEvidence} from '../corpus.js';import {retrieve,converse,gatherEvidence} from '../backend/chat.js';
import {corpus as bootstrapCorpus,local as bootstrapLocal} from './bootstrap-fixture.mjs';
const root=new URL('../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root))),manifest=read('data/corpus-manifest.json'),snapshot=read('data/senate-text.json'),coverage=read('data/coverage.json');
const local=async url=>{assert.ok(url.startsWith('https://csckhanna.github.io/faculty-senate-assistant/data/'));return new Response(fs.readFileSync(new URL(url.split('/faculty-senate-assistant/')[1],root)));};
const corpus=await loadCorpus(manifest,local);
test('published Senate pages are searchable or have an explicit coverage gap',()=>{
 assert.ok(snapshot.publishedPages.length>0);assert.ok(corpus.sources.some(s=>s.url==='https://web.uri.edu/facsen/'));
 const gaps=[...snapshot.gaps,...coverage.failures,...(coverage.website?.gaps||[])];
 for(const url of snapshot.publishedPages){
  const source=corpus.sources.find(s=>s.url===url);
  if(source)assert.ok(corpus.passages.some(p=>p.source===url),url);
  else assert.ok(gaps.some(g=>g.url===url&&g.reason),`Missing unqualified published source: ${url}`);
 }
});
test('all readable trackers preserve every downloaded tab and nonempty row',()=>{
 assert.ok(Array.isArray(snapshot.trackers));
 for(const tracker of snapshot.trackers){assert.ok(tracker.tabs.length);const s=corpus.sources.find(s=>s.url===tracker.url);assert.ok(s,tracker.title);assert.equal(s.rowCount,tracker.rows);for(const tab of tracker.tabs.filter(t=>t.rows))assert.ok(corpus.passages.some(p=>p.source===tracker.url&&p.heading.includes('Sheet: '+tab.name+' |')),tab.name);}
});
test('compact retrieval fetches the exact stored text for every selected passage',async()=>{
 const original=read('data/index.json');const evidence=retrieve(corpus,[{role:'user',content:'How can I change the prerequisites for a course?'}]);const full=await hydrateEvidence(corpus,evidence,local);
 assert.ok(full.length>0);
 for(let i=0;i<full.length;i++)assert.equal(full[i].p.text,original.passages[evidence[i].p.id].text);
});
test('specific historical program lookup retrieves labeled tracker fields and the correct academic year',async()=>{
 const evidence=await hydrateEvidence(bootstrapCorpus,retrieve(bootstrapCorpus,[{role:'user',content:'What happened to the Environmental Engineering BS proposal in 2025–2026?'}]),bootstrapLocal);
 assert.ok(evidence.some(x=>x.source.kind==='Faculty Senate proposal tracker'&&/2025.*2026/.test(x.source.title)&&/Program Title: BS - Environmental Engineering/.test(x.p.text)&&/Status: Complete/.test(x.p.text)));
});
test('Sonnet receives hydrated evidence rather than empty routing records',async()=>{
 let body;const response=await converse(bootstrapCorpus,[{role:'user',content:'What does the Academic Calendar Committee do?'}],{URI_API_KEY:'test'},async(u,o)=>{body=JSON.parse(o.body);return new Response(JSON.stringify({choices:[{message:{content:'{"kind":"answer","answer":"Consult the committee’s charge [1].","sourceIds":[1]}'}}]}));},bootstrapLocal);
 assert.equal(response.kind,'answer');assert.match(body.messages[0].content,/EVIDENCE/);assert.ok(body.messages[0].content.length>7000);
});
test('immutable corpus URLs reject untrusted locations and failed downloads',async()=>{
 await assert.rejects(loadCorpus({...manifest,corpusBase:'https://untrusted.example'},local));await assert.rejects(loadCorpus(manifest,async()=>new Response('',{status:404})));
});

test('procedural lookup includes submission steps alongside the selected modification',async()=>{
 const evidence=await hydrateEvidence(bootstrapCorpus,retrieve(bootstrapCorpus,[{role:'user',content:'How do I change the prerequisites for an existing course?'}]),bootstrapLocal);
 assert.ok(evidence.some(x=>x.p.heading==='Submit to the Workflow'&&/Leave Edit Mode/.test(x.p.text)));
});
test('image-only Senate FAQ is searchable and carries its OCR qualification',async()=>{
 const evidence=await hydrateEvidence(bootstrapCorpus,retrieve(bootstrapCorpus,[{role:'user',content:'Who may attend Faculty Senate meetings, and can a non-senator vote?'}]),bootstrapLocal);
 assert.ok(evidence.some(x=>x.source.kind==='Faculty Senate website image'&&/FAQ/.test(x.source.title)&&/general public may attend/.test(x.p.text)&&/OCR/.test(x.source.notice)));
});
test('compiled corpus retrieves Kuali login and actual AI program status across topic changes',async()=>{
 const messages=[{role:'user',content:'Was the interdisciplinary AI major approved?'},{role:'assistant',content:'Check Senate records.'},{role:'user',content:'How can I start using kuali?'}];
 const access=await gatherEvidence(bootstrapCorpus,messages,bootstrapLocal);assert.ok(access.some(r=>r.p.heading==='Logging In'&&/Microsoft 365/.test(r.p.text)));
 const status=await gatherEvidence(bootstrapCorpus,messages.slice(0,1),bootstrapLocal);assert.ok(status.some(r=>/2026.2027/.test(r.source.title)&&/To President/.test(r.p.text)));
 const audit=await gatherEvidence(bootstrapCorpus,[{role:'user',content:'Were there any programs not approved last academic year?'}],bootstrapLocal);assert.match(audit[0].p.text,/159 rows/);assert.match(audit[0].p.text,/"To FS":1/);
});
