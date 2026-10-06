import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {loadCorpus,hydrateEvidence} from '../corpus.js';import {retrieve,converse} from '../backend/chat.js';
const root=new URL('../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root))),manifest=read('data/corpus-manifest.json'),snapshot=read('data/senate-text.json');
const local=async url=>{assert.ok(url.startsWith('https://csckhanna.github.io/faculty-senate-assistant/data/'));return new Response(fs.readFileSync(new URL(url.split('/faculty-senate-assistant/')[1],root)));};
const corpus=await loadCorpus(manifest,local);
test('every published Senate page has a registered source and searchable content',()=>{assert.equal(snapshot.publishedPages.length,48);for(const url of snapshot.publishedPages){assert.ok(corpus.sources.some(s=>s.url===url));assert.ok(corpus.passages.some(p=>p.source===url));}});
test('current and eight readable archived trackers preserve every downloaded tab and nonempty row',()=>{
 assert.equal(snapshot.trackers.length,9);assert.ok(snapshot.gaps.some(g=>g.url.includes('12ENXKw')&&/401/.test(g.reason)));
 for(const tracker of snapshot.trackers){assert.ok(tracker.tabs.length);const s=corpus.sources.find(s=>s.url===tracker.url);assert.ok(s,tracker.title);assert.equal(s.rowCount,tracker.rows);for(const tab of tracker.tabs.filter(t=>t.rows))assert.ok(corpus.passages.some(p=>p.source===tracker.url&&p.heading.includes('Sheet: '+tab.name+' |')),tab.name);}
});
test('compact retrieval fetches the exact stored text for every selected passage',async()=>{
 const original=read('data/index.json');const evidence=retrieve(corpus,[{role:'user',content:'How can I change the prerequisites for a course?'}]);const full=await hydrateEvidence(corpus,evidence,local);
 assert.ok(full.some(x=>x.p.heading==='Course change classifications (full source)'&&/Minor Course Changes[\s\S]*Change prerequisites/.test(x.p.text)));
 for(let i=0;i<full.length;i++)assert.equal(full[i].p.text,original.passages[evidence[i].p.id].text);
});
test('specific historical program lookup retrieves labeled tracker fields and the correct academic year',async()=>{
 const evidence=await hydrateEvidence(corpus,retrieve(corpus,[{role:'user',content:'What happened to the Environmental Engineering BS proposal in 2025–2026?'}]),local);
 assert.ok(evidence.some(x=>x.source.kind==='Faculty Senate proposal tracker'&&/2025.*2026/.test(x.source.title)&&/Program Title: BS - Environmental Engineering/.test(x.p.text)&&/Status: Complete/.test(x.p.text)));
});
test('Sonnet receives hydrated evidence rather than empty routing records',async()=>{
 let body;const response=await converse(corpus,[{role:'user',content:'What does the Academic Calendar Committee do?'}],{URI_API_KEY:'test'},async(u,o)=>{body=JSON.parse(o.body);return new Response(JSON.stringify({choices:[{message:{content:'{"kind":"answer","answer":"Consult the committee’s charge [1].","sourceIds":[1]}'}}]}));},local);
 assert.equal(response.kind,'answer');assert.match(body.messages[0].content,/EVIDENCE/);assert.ok(body.messages[0].content.length>7000);
});
test('immutable corpus URLs reject untrusted locations and failed downloads',async()=>{
 await assert.rejects(loadCorpus({...manifest,corpusBase:'https://untrusted.example'},local));await assert.rejects(loadCorpus(manifest,async()=>new Response('',{status:404})));
});

test('procedural lookup includes submission steps alongside the selected modification',async()=>{
 const evidence=await hydrateEvidence(corpus,retrieve(corpus,[{role:'user',content:'How do I change the prerequisites for an existing course?'}]),local);
 assert.ok(evidence.some(x=>x.p.heading==='Submit to the Workflow'&&/Leave Edit Mode/.test(x.p.text)));
});
test('image-only Senate FAQ is searchable and carries its OCR qualification',async()=>{
 const evidence=await hydrateEvidence(corpus,retrieve(corpus,[{role:'user',content:'Who may attend Faculty Senate meetings, and can a non-senator vote?'}]),local);
 assert.ok(evidence.some(x=>x.source.kind==='Faculty Senate website image'&&/FAQ/.test(x.source.title)&&/general public may attend/.test(x.p.text)&&/OCR/.test(x.source.notice)));
});
