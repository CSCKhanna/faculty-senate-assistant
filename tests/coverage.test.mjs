import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {retrieve,converse} from '../backend/chat.js';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url)));
const data=read('../data/index.json'),coverage=read('../data/coverage.json'),pages=read('../data/toolkit-pages.json'),media=read('../data/toolkit-media-text.json'),linked=read('../data/toolkit-linked-text.json');
test('all reachable toolkit pages and database rows are indexed with usable content',()=>{
 assert.equal(pages.pages.length,296);assert.equal(coverage.toolkit.unresolvedBlocks,0);assert.deepEqual(coverage.failures,[]);
 for(const p of pages.pages){assert.ok(data.sources.some(s=>s.url===p.url),p.title);assert.ok(data.passages.some(x=>x.source===p.url),p.title);}
 assert.deepEqual(pages.databases,{'FAQs':1,'Curriculum Calendar':69,'Curriculum Proposal Requirements':62,'Curricular Process Directory':140});
});
test('every image and attachment has a sourced transcription or text extraction',()=>{
 assert.equal(media.items.length,59);
 for(const a of media.items){assert.ok(a.lines.length,a.title);assert.ok(a.resourceSource);assert.ok(data.passages.some(p=>p.source===a.url),a.title);}
});
test('ABM comparison supplies both definitions rather than only a form field',()=>{
 const evidence=retrieve(data,[{role:'user',content:'What is the difference between an ABM and a 4+1?'}]);
 assert.ok(evidence.some(x=>/does not include double-counted/i.test(x.p.text)));
 assert.ok(evidence.some(x=>/double-count eligible courses/i.test(x.p.text)));
});
test('calendar dates are readable and all spreadsheet tabs are retained',()=>{
 assert.ok(pages.pages.some(x=>x.lines.some(l=>/November 02, 2026 \(2026-11-02\)/.test(l))));
 const tracker=linked.items.find(x=>x.url.includes('13I6-'));assert.ok(tracker);assert.ok(tracker.lines.filter(x=>x.startsWith('# Sheet:')).length>1);
});
test('Sonnet request omits unsupported temperature and remains grounded',async()=>{
 let request;await converse(data,[{role:'user',content:'How can I change my course?'}],{URI_API_KEY:'test'},async(url,options)=>{request=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:'{"kind":"answer","answer":"See the course modification guidance [1].","sourceIds":[1]}'}}]}),{status:200});});
 assert.equal(request.model,'its_direct/pt3-claude-sonnet-5.5-1m-us');assert.equal(request.temperature,undefined);assert.ok(request.messages[0].content.includes('EVIDENCE'));
});

test('prerequisite follow-up retains the full major/minor classification context',()=>{
 const evidence=retrieve(data,[{role:'user',content:'How can I change a class I teach?'},{role:'assistant',content:'Use a Course Modification Proposal. What change do you intend?'},{role:'user',content:'I want to change the prerequisites. What should I do next?'}]);
 assert.ok(evidence.some(x=>x.p.heading==='Course change classifications (full source)'&&/Minor Course Changes[\s\S]*Change prerequisites/.test(x.p.text)));
});
