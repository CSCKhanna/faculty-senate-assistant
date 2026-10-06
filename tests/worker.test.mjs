import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker,{reserveBudget} from '../backend/worker.js';

function database(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(new URL('../backend/schema.sql',import.meta.url),'utf8'));
  return {sqlite,prepare:sql=>({bind:(...values)=>({sql,values})}),batch:async queries=>{
    sqlite.exec('BEGIN');
    try{const result=queries.map(({sql,values})=>({results:sqlite.prepare(sql).all(...values)}));sqlite.exec('COMMIT');return result;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }};
}
test('daily cap applies across network addresses and repeated database calls',async()=>{
  const db=database(),now=Date.UTC(2026,9,6,12);
  const results=await Promise.all(Array.from({length:20},(_,i)=>reserveBudget(db,'network-'+i,2,now)));
  assert.equal(results.filter(r=>r.allowed).length,2);
  assert.equal(db.sqlite.prepare('SELECT count FROM pilot_daily').get().count,2);
  assert.equal((await reserveBudget(db,'next',2,now+86400000)).allowed,true);
});
test('minute limit rejects ninth request without consuming daily budget and expires old network counters',async()=>{
  const db=database(),now=Date.UTC(2026,9,6,12);
  for(let i=0;i<8;i++)assert.equal((await reserveBudget(db,'same',100,now)).allowed,true);
  assert.equal((await reserveBudget(db,'same',100,now)).allowed,false);
  assert.equal(db.sqlite.prepare('SELECT count FROM pilot_daily').get().count,8);
  assert.equal((await reserveBudget(db,'same',100,now+120000)).allowed,true);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM pilot_rate').get().count,1);
  assert.equal((await reserveBudget(db,'same',NaN,now)).allowed,false);
});
test('unconfigured backend and unauthorized origin fail before a paid call',async()=>{
  const health=await worker.fetch(new Request('https://pilot/health'),{});
  assert.equal((await health.json()).ready,false);
  const forbidden=await worker.fetch(new Request('https://pilot/chat',{method:'POST',headers:{Origin:'https://untrusted.example'}}),{});
  assert.equal(forbidden.status,403);
  const unavailable=await worker.fetch(new Request('https://pilot/chat',{method:'POST',headers:{Origin:'https://csckhanna.github.io'}}),{});
  assert.equal(unavailable.status,503);
});
