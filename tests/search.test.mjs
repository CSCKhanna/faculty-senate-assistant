import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildSearch,emailLink} from '../search.js';
const data=JSON.parse(fs.readFileSync(new URL('../data/index.json',import.meta.url)));
const search=buildSearch(data);
test('temporary-to-permanent retrieves the toolkit classification, not a fabricated answer',()=>{
  const r=search('How do I make a temporary course permanent?');
  assert.ok(r.length);assert.ok(r.some(x=>/modification/i.test(x.p.text)));
  assert.ok(r.every(x=>data.passages.some(p=>p.text===x.p.text&&p.source===x.p.source)));
});
test('proposal status retrieves tracking steps',()=>{
  const r=search('How do I track my proposal?');assert.equal(r[0].source.title,'Track Your Proposal');assert.match(r[0].p.text,/workflow|status/i);
});
test('unrelated questions fall back rather than presenting an answer',()=>{
  assert.deepEqual(search('What is the weather in Boston?'),[]);
  assert.deepEqual(search('How do I reset my Netflix password?'),[]);
});
test('email draft preserves exact question, including punctuation and newlines',()=>{
  const q='  What about “cross-listed” courses & deadlines?\nMy original question.  ';
  const url=new URL(emailLink(q));assert.equal(url.pathname,'genvieve.spitale@uri.edu');assert.equal(url.searchParams.get('body'),q);assert.equal(url.searchParams.get('subject'),'Faculty Senate curriculum question');
});
test('index contains no raw Notion access or user metadata',()=>{
  const serialized=JSON.stringify(data);assert.doesNotMatch(serialized,/user_permission|bot_permission|api_key|token_v2|crdt_data/);
  assert.ok(data.sources.some(x=>x.kind==='Curriculum Toolkit'));
});
