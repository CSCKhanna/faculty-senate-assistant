// Derive a small source lookup from the complete corpus; no curated answer bank.
import fs from 'node:fs';import crypto from 'node:crypto';
import {identifiers} from '../bills.js';import {tokens} from '../search.js';
const data=JSON.parse(fs.readFileSync('data/index.json')),manifest=JSON.parse(fs.readFileSync('data/corpus-manifest.json')),registry=new Map(data.sources.map(s=>[s.url,s])),sources=[],sourceIds=new Map(),records=[],terms={},byId={};
for(const [passageId,p] of data.passages.entries()){
  const source=registry.get(p.source),tracker=source.kind==='Faculty Senate proposal tracker';
  const explicit=/\bbill\s*(?:no\.?|number|#|:)?\s*(?:(?:CASC|GC|GEC|FSEC)\s*)?(?:19|20)?\d{2}\s*[-–]/i.test(p.text);
  const firstPage=/\| Page [12]$/.test(p.heading)||!p.heading.includes('| Page ');
  const report=firstPage&&/\breport\s*#?\s*(?:19|20)?\d{2}\s*[-–]/i.test(p.text);
  const named=firstPage&&identifiers(source.title).length>0;
  const billField=/\bBill(?:\s*(?:Number|#))?\s*:\s*(?:(?:[A-Z]+)\s*)?\d/i.test(p.text);
  if(!(explicit||report||named||source.title==='Legislation'||tracker&&billField))continue;
  if(tracker&&(/(?:^|\|)\s*Status:\s*Status(?:\s*\||$)/.test(p.text)||!billField))continue;
  // Keep complete tracker rows and bill paragraphs. A long PDF page gets a
  // bounded excerpt centered on its identifier, with omission clearly marked.
  const marker=p.text.search(/\b(?:bill|report)\s*(?:no\.?|number|#|:)?\s*(?:(?:CASC|GC|GEC|FSEC)\s*)?(?:19|20)?\d{2}\s*[-–]/i);
  const start=tracker?0:Math.max(0,marker-150),limit=source.title==='Legislation'?2400:1600;
  const text=(start?'… ':'')+p.text.slice(start,start+limit)+(p.text.length>start+limit?' …':'');
  const keys=[...new Set(identifiers(source.title+' '+text).map(i=>i.key))];if(!keys.length)continue;
  if(!sourceIds.has(p.source)){sourceIds.set(p.source,sources.length);const {url,title,kind,fetchedAt,notice}=source;sources.push({url,title,kind,fetchedAt,notice});}
  const n=records.length,quality=tracker?5:explicit&&/\bminutes\b/i.test(p.heading+' '+source.title)?6:explicit?4:source.title==='Legislation'?3:2;
  // Text already lives in immutable corpus shards. This index only routes to
  // exact passage IDs, avoiding a second multi-megabyte text load on Workers.
  const heading=tracker?p.heading.replace(source.title+' | ',''):p.heading;
  records.push([sourceIds.get(p.source),heading,passageId,keys,quality]);
  for(const key of keys){const [year,,number]=key.split(':');for(const k of [key,`${year}:*:${number}`]){if(!byId[k])byId[k]=[];if(!byId[k].includes(n))byId[k].push(n);}}
  // A tracker lookup matches the actual course/program name, not generic field
  // labels or the other dates repeated across thousands of spreadsheet rows.
  const searchable=tracker?heading.split(/\| Row \d+ \|/)[1]||heading:p.heading+' '+text;
  for(const w of new Set(tokens(searchable)))(terms[w]??=[]).push(n);
}
const index={builtAt:data.builtAt,corpusBase:manifest.corpusBase,shardSize:100,sources,records,terms,identifiers:byId};
const content=JSON.stringify(index),hash=crypto.createHash('sha256').update(content).digest('hex').slice(0,12),path=`data/bills-${hash}.json`;
fs.writeFileSync(path,content);fs.writeFileSync('data/bills-manifest.json',JSON.stringify({builtAt:data.builtAt,path,recordCount:records.length}));
console.log(JSON.stringify({path,records:records.length,bytes:Buffer.byteLength(content)}));
