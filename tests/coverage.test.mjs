import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {retrieve,converse} from '../backend/chat.js';
import {data as bootstrapData} from './bootstrap-fixture.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url)));
const data=read('../data/index.json'),coverage=read('../data/coverage.json'),pages=read('../data/toolkit-pages.json'),media=read('../data/toolkit-media-text.json'),linked=read('../data/toolkit-linked-text.json');
test('reachable toolkit pages and database rows have content or a declared gap',()=>{
 assert.ok(pages.pages.length>0);assert.ok(pages.pages.some(p=>p.url.endsWith('3a57535bf92c80c78bacd5b49e9c6c12')));
 const gaps=[...coverage.failures,...(coverage.website?.gaps||[])];
 for(const p of pages.pages){
  if(data.sources.some(s=>s.url===p.url))assert.ok(data.passages.some(x=>x.source===p.url),p.title);
  else assert.ok(gaps.some(g=>g.url===p.url&&g.reason),p.title);
 }
 assert.deepEqual(pages.databases,coverage.toolkit.databases);
 assert.equal(coverage.toolkit.pages,pages.pages.filter(p=>p.kind==='Curriculum Toolkit').length);
 assert.equal(coverage.toolkit.databaseEntries,pages.pages.filter(p=>p.kind.endsWith('database item')).length);
 assert.equal(coverage.sourceCount,data.sources.length);assert.equal(coverage.passageCount,data.passages.length);
});
test('reviewed image and attachment text is indexed or explicitly awaiting replacement',()=>{
 assert.ok(media.items.length>0);
 for(const a of media.items){
  assert.ok(a.lines.length,a.title);assert.ok(a.resourceSource);
  if(!data.passages.some(p=>p.source===a.url))assert.ok(coverage.failures.some(g=>g.url===a.url&&/changed|removed|transcription|extraction/i.test(g.reason)),a.title);
 }
});
test('ABM comparison supplies both definitions rather than only a form field',()=>{
 const evidence=retrieve(bootstrapData,[{role:'user',content:'What is the difference between an ABM and a 4+1?'}]);
 assert.ok(evidence.some(x=>/does not include double-counted/i.test(x.p.text)));
 assert.ok(evidence.some(x=>/double-count eligible courses/i.test(x.p.text)));
});
test('historical calendar extraction preserves its human-readable and ISO date',()=>{
 assert.ok(bootstrapData.passages.some(x=>/November 02, 2026 \(2026-11-02\)/.test(x.text)));
});
test('Sonnet request omits unsupported temperature and remains grounded',async()=>{
 let request;await converse(bootstrapData,[{role:'user',content:'How can I change my course?'}],{URI_API_KEY:'test'},async(url,options)=>{request=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:'{"kind":"answer","answer":"See the course modification guidance [1].","sourceIds":[1]}'}}]}),{status:200});});
 assert.equal(request.model,'its_direct/pt3-claude-sonnet-5.5-1m-us');assert.equal(request.temperature,undefined);assert.ok(request.messages[0].content.includes('EVIDENCE'));
});

test('prerequisite follow-up retains the full major/minor classification context',()=>{
 const evidence=retrieve(bootstrapData,[{role:'user',content:'How can I change a class I teach?'},{role:'assistant',content:'Use a Course Modification Proposal. What change do you intend?'},{role:'user',content:'I want to change the prerequisites. What should I do next?'}]);
 assert.ok(evidence.some(x=>x.p.heading==='Course change classifications (full source)'&&/Minor Course Changes[\s\S]*Change prerequisites/.test(x.p.text)));
});
