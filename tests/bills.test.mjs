import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {identifiers,isBillQuestion,billEvidence,missingBillAnswer} from '../bills.js';
import {hydrateEvidence} from '../corpus.js';import {answerEvidence} from '../backend/chat.js';
const root=new URL('../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root))),manifest=read('data/bills-manifest.json'),index=read(manifest.path);
const fetchLocal=async url=>new Response(fs.readFileSync(new URL(url.split('/faculty-senate-assistant/')[1],root)));
const evidence=async messages=>hydrateEvidence(index,billEvidence(index,messages),fetchLocal);
const followUp=[{role:'user',content:'Do you know if the BS interdisciplinary AI major was approved yet?'},{role:'assistant',content:'The current tracker says To President. The earlier tracker says To FS, tabled.'},{role:'user',content:'Does it have a bill number?'}];
test('the actual bill follow-up retrieves the minutes explicitly linking the BS to 08C',async()=>{
  for(const q of ['Does it have a bill number?',"What's its bill number?",'What is the bill number?']){
    const p=await evidence([...followUp.slice(0,-1),{role:'user',content:q}]);assert.ok(p.length);assert.match(p[0].p.text,/Bill No\. 2025-2026-08C, covering the new BS in Interdisciplinary Artificial Intelligence/);
    assert.ok(p.every(r=>!r.p.text.includes('Bill Number: Bill Number')));
    assert.ok(!p.some(r=>/Ocean Science/.test(r.p.text)));
  }
});
test('named bill queries retrieve the associated tracker bill field',async()=>{
  const p=await evidence([{role:'user',content:'What is the bill number for the Environmental Engineering BS proposal in 2025–2026?'}]);
  assert.ok(p.some(r=>/Program Title: BS - Environmental Engineering/.test(r.p.text)&&/Faculty Senate Bill #: CASC 25-26-06C/.test(r.p.text)));
});
test('short years, long years, dashes, committee placement, and leading zeros resolve consistently',async()=>{
  for(const q of ['CASC 25-26-07B','2025–2026–CASC–07B','casc 2025-2026-7b']){
    assert.equal(identifiers(q)[0].key,'2025-2026:CASC:7B');assert.equal(isBillQuestion([{role:'user',content:q}]),true);
    const p=await evidence([{role:'user',content:'What is '+q+'?'}]);assert.ok(p.some(r=>r.source.title==='2025-2026-CASC-07B'));
  }
  assert.equal(identifiers('26-04-23').length,0);assert.equal(identifiers('2025-2026')[0],undefined);
});
test('exact bill lookup includes 08C overview rather than only tracker rows',async()=>{
  const p=await evidence([{role:'user',content:'What is bill 2025-2026-08C?'}]);
  assert.ok(p.some(r=>/NEW PROGRAM REPORT/.test(r.p.text)&&/Interdisciplinary Artificial Intelligence/.test(r.p.text)));
});
test('a new topic drops earlier program context and an unknown identifier never substitutes another bill',()=>{
  assert.equal(billEvidence(index,[...followUp,{role:'assistant',content:'Bill 08C.'},{role:'user',content:'What is the bill number for a nonexistent Quantum Horticulture degree?'}]).length,0);
  const unknown=[{role:'user',content:'What is Bill 2025–2026–999?'}];assert.equal(billEvidence(index,unknown).length,0);assert.equal(missingBillAnswer(index,unknown).kind,'unanswered');
  assert.equal(billEvidence(index,[followUp.at(-1)]).length,0);assert.equal(missingBillAnswer(index,[followUp.at(-1)]).kind,'clarification');
});
test('bill evidence uses the same immutable corpus and keeps routing text-free',()=>{
  const corpus=read('data/corpus-manifest.json');assert.equal(index.corpusBase,corpus.corpusBase);assert.equal(index.builtAt,corpus.builtAt);
  assert.ok(index.records.length>2000);assert.ok(index.records.every(r=>Number.isInteger(r[2])&&r[2]<corpus.passageCount));
});
test('Sonnet gets the contextual bill question and cited source facts, with no general search required',async()=>{
  const p=await evidence(followUp);let sent;
  const result=await answerEvidence(index,followUp,{URI_API_KEY:'test-only'},p,async(u,o)=>{
    sent=JSON.parse(o.body);return Response.json({choices:[{message:{content:JSON.stringify({kind:'answer',answer:'Yes. The proposed BS is identified as **Bill No. 2025–2026–08C** in the Senate minutes [1].',sourceIds:[1],followUp:''})}}]});
  });
  assert.equal(result.kind,'answer');assert.match(result.sources[0].url,/1QZFoVwJIs5VG/);assert.ok(sent.messages.some(m=>m.content.includes('BS interdisciplinary AI')));assert.ok(sent.messages[0].content.includes('Bill No. 2025-2026-08C'));
});
