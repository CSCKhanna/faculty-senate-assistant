// Historical retrieval expectations belong to a fixed, retained source fixture.
// Build it from the already published immutable objects, without a duplicate
// large index or assumptions about tomorrow's refreshed tracker statuses.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadCorpus} from '../corpus.js';

export const root=new URL('../',import.meta.url);
export const read=path=>JSON.parse(fs.readFileSync(new URL(path,root),'utf8'));
const corpusBase='data/corpus-14e032937a2a',billPath='data/bills-455371660268.json';
const routing=read(corpusBase+'/routing.json');
export const manifest={builtAt:routing.builtAt,corpusBase,sourceCount:routing.sources.length,passageCount:routing.docs.length};
export const local=async url=>{
  const prefix='https://csckhanna.github.io/faculty-senate-assistant/';
  assert.ok(url.startsWith(prefix),'Fixture requests must use the public assistant base');
  const path=url.slice(prefix.length);
  assert.ok(path.startsWith(corpusBase+'/')||path===billPath,'Fixture requests must remain on the retained bootstrap generation');
  return new Response(fs.readFileSync(new URL(path,root)));
};
export const corpus=await loadCorpus(manifest,local);
export const bills=read(billPath);
const shards=new Map();
export const data={builtAt:routing.builtAt,sources:routing.sources,trackerCoverage:routing.trackerCoverage,passages:routing.docs.map((doc,id)=>{
  const shard=Math.floor(id/routing.shardSize);
  if(!shards.has(shard))shards.set(shard,read(corpusBase+'/text-'+shard+'.json'));
  return {source:routing.sources[doc[0]].url,heading:doc[1],text:shards.get(shard)[id%routing.shardSize]};
})};
shards.clear();
