import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {billEvidence,billPageEvidence,requestedBillPage,missingBillPageAnswer} from '../bills.js';
import {loadCorpus,hydrateEvidence} from '../corpus.js';

const BASE='https://csckhanna.github.io/faculty-senate-assistant/';
// Reproduces the real refreshed GC report page, whose appendix does not repeat
// a bill identifier and therefore is deliberately absent from the bill index.
const REPORT_URL='https://drive.google.com/file/d/1spwOUNQeQuOLRJS2EjFjVThcXR8udfkK/view';
const PAGE_TEXT='Pharmaceutical Science_Ms Non-Thesis Pharmaceutical Sciences - Ms (Non-Thesis) Under Review 1 Spring 2026';
const question='On page 12 of Graduate Council report 2025–2026-GC-01B, what proposal status and effective term are printed for Pharmaceutical Sciences MS (Non-Thesis)? Please use that report page, distinguish its printed status from a later tracker status, and answer briefly.';
const messages=content=>[{role:'user',content}];
function generation(number){
  const revision=String(number).padStart(12,'0'),builtAt=`2026-10-0${number}T12:00:00Z`,corpusBase=`data/corpus-${revision}`;
  const source={title:'2025-2026-GC-01B',url:REPORT_URL,kind:'Faculty Senate PDF',fetchedAt:builtAt,notice:'Text includes OCR; verify the original report. Generation '+number+'.'};
  const sources=[source,{...source,title:'2024-2025-GC-01B',url:'https://drive.google.com/file/d/previous-report/view'},{...source,title:'2025-2026-CASC-01B',url:'https://drive.google.com/file/d/different-committee/view'},{title:'2025–2026 Curriculum Proposal Tracker',url:'https://docs.google.com/spreadsheets/d/fixture/edit',kind:'Faculty Senate proposal tracker',fetchedAt:builtAt,notice:'Dated tracker record.'}];
  const pageRows=[
    [0,'2025-2026-GC-01B | Page 1','Graduate Council report 2025-2026-GC-01B. Cover page.'],
    [0,'2025-2026-GC-01B | Page 12',PAGE_TEXT],
    [0,'2025-2026-GC-01B | Page 120','PAGE120_DIFFERENT_STATUS'],
    [1,'2024-2025-GC-01B | Page 12','PREVIOUS_YEAR_DIFFERENT_STATUS'],
    [2,'2025-2026-CASC-01B | Page 12','OTHER_DOCUMENT_DIFFERENT_STATUS'],
    [3,'Sheet: B. Modified Programs | Row 89 | MS - Pharmaceutical Sciences (Non-Thesis)','Status: Complete | Effective for: Spring 2026 | Bill: GC 25-26-01B']
  ];
  const corpus={builtAt,corpusBase,sourceCount:sources.length,passageCount:pageRows.length};
  const billPath=`data/bills-${revision}.json`,index={builtAt,corpusBase,shardSize:2,sources,records:[[0,pageRows[0][1],0,['2025-2026:GC:1B'],2],[3,pageRows[5][1],5,['2025-2026:GC:1B'],5]],identifiers:{'2025-2026:GC:1B':[0,1],'2025-2026:*:1B':[0,1]},terms:{}};
  const routing={...corpus,sources,shardSize:2,docs:pageRows.map(([source,heading,text])=>[source,heading,text.length,'']),terms:{}};
  const files=new Map([[corpusBase+'/routing.json',routing],[corpusBase+'/postings.bin',new Uint32Array().buffer],[billPath,index]]);
  for(let start=0;start<pageRows.length;start+=2)files.set(corpusBase+'/text-'+start/2+'.json',pageRows.slice(start,start+2).map(row=>row[2]));
  return {release:{version:1,checkedAt:builtAt,corpus,bills:{builtAt,corpusBase,path:billPath,recordCount:index.records.length}},files,index};
}
function fixture(){
  const values=[generation(1),generation(2)],files=new Map(values.flatMap(value=>[...value.files])),calls=[],prompts=[];
  let pointer=values[0].release;
  const fetcher=async(url,options)=>{
    const path=String(url).slice(BASE.length);calls.push(path);
    if(url==='https://llmgw.its.uri.edu/v1/chat/completions'){
      const body=JSON.parse(options.body),prompt=body.messages[0].content;prompts.push(body);
      const targeted=prompt.includes('2025-2026-GC-01B | Page 12');
      return Response.json({choices:[{message:{content:JSON.stringify({kind:'answer',answer:targeted?'The report page prints **Under Review** and **Spring 2026** [1].':'This is a Graduate Council report [1].',sourceIds:[1],followUp:''})}}]});
    }
    assert.ok(String(url).startsWith(BASE),'Only same-generation public corpus and the mocked gateway may be requested');
    if(path==='data/source-release.json')return Response.json(pointer);
    if(!files.has(path))return new Response('',{status:404});
    const value=files.get(path);return value instanceof ArrayBuffer?new Response(value):Response.json(value);
  };
  return {values,files,calls,prompts,fetcher,publish:number=>{pointer=values[number-1].release;}};
}
function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync(new URL('../backend/schema.sql',import.meta.url),'utf8'));
  return {prepare:sql=>({bind:(...values)=>({sql,values})}),batch:async queries=>queries.map(({sql,values})=>({results:sqlite.prepare(sql).all(...values)}))};
}
function request(content){return new Request('https://pilot/chat',{method:'POST',headers:{Origin:'https://csckhanna.github.io','Content-Type':'application/json'},body:JSON.stringify({messages:messages(content)})});}

test('the exact refreshed GC page is first, hydrated from the selected generation, and preserves its source notice',async()=>{
  const f=fixture(),index=f.values[0].index,corpus=await loadCorpus(f.values[0].release.corpus,f.fetcher,BASE);
  const selected=billEvidence(index,messages(question));assert.ok(selected.every(r=>!r.p.heading.endsWith('Page 12')));
  const result=billPageEvidence(index,corpus,messages(question),selected),evidence=await hydrateEvidence(corpus,result.evidence,f.fetcher);
  assert.equal(result.found,true);assert.equal(evidence[0].p.heading,'2025-2026-GC-01B | Page 12');assert.equal(evidence[0].p.text,PAGE_TEXT);
  assert.equal(evidence[0].source.url,REPORT_URL);assert.equal(evidence[0].source.notice,index.sources[0].notice);assert.ok(evidence.length<=8);
  assert.ok(evidence.some(r=>r.p.text.includes('Status: Complete')));
  assert.ok(evidence.every(r=>!r.p.text.includes('DIFFERENT_STATUS')));
  const shards=f.calls.filter(path=>/\/text-\d+\.json$/.test(path));assert.ok(shards.length<=8);assert.ok(shards.every(path=>path.startsWith(index.corpusBase+'/')));
});
test('an absent requested page never substitutes Page 120 or the same page of another year or committee',async()=>{
  const f=fixture(),index=f.values[0].index,corpus=await loadCorpus(f.values[0].release.corpus,f.fetcher,BASE);
  corpus.passages=corpus.passages.filter(p=>p.source!==REPORT_URL||!p.heading.endsWith('Page 12'));
  const result=billPageEvidence(index,corpus,messages(question));assert.equal(result.found,false);assert.deepEqual(result.pageIds,[]);
  const fallback=missingBillPageAnswer(index,result);assert.equal(fallback.kind,'unanswered');assert.match(fallback.answer,/page 12/);assert.equal(fallback.sources.length,1);assert.equal(fallback.sources[0].url,REPORT_URL);assert.equal(fallback.sources[0].notice,index.sources[0].notice);
  assert.equal(requestedBillPage(messages('Please inspect page 9999 of 2025-2026-GC-01B.')),9999);
  assert.equal(billPageEvidence(index,corpus,messages('On page 12 of 2023-2024-GC-01B, what is printed?')).found,false);
});
test('page enrichment rejects cross-generation metadata and keeps the unchanged evidence ceiling',async()=>{
  const f=fixture(),index=f.values[0].index,corpus=await loadCorpus(f.values[0].release.corpus,f.fetcher,BASE);
  assert.throws(()=>billPageEvidence(f.values[1].index,corpus,messages(question)),/generation mismatch/);
  const anchors=Array.from({length:8},(_,i)=>({source:index.sources[0],p:{id:100+i,source:REPORT_URL,heading:'Cover anchor '+i,text:''}}));
  const result=billPageEvidence(index,corpus,messages(question),anchors);assert.equal(result.evidence.length,8);assert.equal(result.evidence[0].p.id,1);
});
test('the full Worker route sends the appendix page and later tracker in one model call; ordinary bill routing stays unchanged',async t=>{
  const f=fixture();t.mock.method(globalThis,'fetch',f.fetcher);
  const {default:worker}=await import('../backend/worker.js?bill-page-worker-fixture'),env={URI_API_KEY:'test-only',PILOT_DB:database()};
  const response=await worker.fetch(request(question),env),answer=await response.json();
  assert.equal(response.status,200);assert.match(answer.answer,/Under Review/);assert.equal(answer.sources[0].section,'2025-2026-GC-01B | Page 12');assert.equal(answer.sources[0].notice,f.values[0].index.sources[0].notice);
  assert.equal(f.prompts.length,1);assert.match(f.prompts[0].messages[0].content,/Under Review 1 Spring 2026/);assert.match(f.prompts[0].messages[0].content,/Status: Complete/);assert.equal(answer.sourceStatus,'current');
  const ordinary=await (await worker.fetch(request('What is Graduate Council report 2025-2026-GC-01B?'),env)).json();assert.equal(ordinary.kind,'answer');assert.equal(f.prompts.length,2);assert.doesNotMatch(f.prompts[1].messages[0].content,/Under Review|Page 12/);
});
test('missing or empty requested-page text returns a qualified manual source without a model call',async t=>{
  const f=fixture();t.mock.method(globalThis,'fetch',f.fetcher);
  const {default:worker}=await import('../backend/worker.js?bill-page-missing-fixture'),env={URI_API_KEY:'test-only',PILOT_DB:database()};
  const absent=await (await worker.fetch(request(question.replace('page 12','page 11')),env)).json();
  assert.equal(absent.kind,'unanswered');assert.match(absent.answer,/page 11/);assert.equal(absent.sources[0].url,REPORT_URL);assert.equal(f.prompts.length,0);
  const shardPath=f.values[0].index.corpusBase+'/text-0.json',shard=f.files.get(shardPath);f.files.set(shardPath,[shard[0],'']);
  const empty=await (await worker.fetch(request(question),env)).json();assert.equal(empty.kind,'unanswered');assert.match(empty.answer,/page 12/);assert.equal(f.prompts.length,0);
});
test('a missing new-generation shard falls back to the matching previous corpus and retains its qualification',async t=>{
  const f=fixture();let now=1000;t.mock.method(Date,'now',()=>now);t.mock.method(globalThis,'fetch',f.fetcher);
  const {default:worker}=await import('../backend/worker.js?bill-page-previous-fixture'),env={URI_API_KEY:'test-only',PILOT_DB:database()};
  const first=await (await worker.fetch(request(question),env)).json();assert.equal(first.sourceStatus,'current');
  f.publish(2);f.files.delete(f.values[1].index.corpusBase+'/text-0.json');now+=300001;
  const fallback=await (await worker.fetch(request(question),env)).json();
  assert.equal(fallback.kind,'answer');assert.equal(fallback.sourceStatus,'last-good');assert.equal(fallback.sourceCheckedAt,f.values[0].release.checkedAt);assert.equal(fallback.sources[0].notice,f.values[0].index.sources[0].notice);assert.match(fallback.answer,/Under Review/);
  assert.equal(f.prompts.length,2);assert.ok(f.prompts[1].messages[0].content.includes(f.values[0].index.sources[0].notice));assert.ok(!f.prompts[1].messages[0].content.includes(f.values[1].index.sources[0].notice));
});
