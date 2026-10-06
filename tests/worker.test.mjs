import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{PilotBudget} from '../backend/worker.js';

function storage(initial){
  let value=initial;
  const tx={get:async()=>structuredClone(value),put:async(_key,next)=>{value=structuredClone(next);}};
  return {transaction:async fn=>fn(tx),value:()=>value};
}
const reserve=(budget,key)=>budget.fetch(new Request('https://internal/reserve',{method:'POST',body:JSON.stringify({key})})).then(r=>r.json());

test('daily cap applies across network addresses and survives object restart',async()=>{
  const saved=storage();
  const first=new PilotBudget({storage:saved},{DAILY_REQUEST_LIMIT:'2'});
  assert.equal((await reserve(first,'a')).allowed,true);
  assert.equal((await reserve(first,'b')).allowed,true);
  const restarted=new PilotBudget({storage:saved},{DAILY_REQUEST_LIMIT:'2'});
  assert.equal((await reserve(restarted,'c')).allowed,false);
  assert.equal(saved.value().count,2);
});
test('old daily usage resets and minute limit rejects a ninth request',async()=>{
  const saved=storage({day:'2000-01-01',count:100});
  const budget=new PilotBudget({storage:saved},{DAILY_REQUEST_LIMIT:'100'});
  for(let i=0;i<8;i++)assert.equal((await reserve(budget,'same')).allowed,true);
  assert.equal((await reserve(budget,'same')).allowed,false);
  assert.equal(saved.value().count,8);
});
test('unconfigured backend and unauthorized origin fail before a paid call',async()=>{
  const health=await worker.fetch(new Request('https://pilot/health'),{});
  assert.equal((await health.json()).ready,false);
  const forbidden=await worker.fetch(new Request('https://pilot/chat',{method:'POST',headers:{Origin:'https://untrusted.example'}}),{});
  assert.equal(forbidden.status,403);
  const unavailable=await worker.fetch(new Request('https://pilot/chat',{method:'POST',headers:{Origin:'https://csckhanna.github.io'}}),{});
  assert.equal(unavailable.status,503);
});
