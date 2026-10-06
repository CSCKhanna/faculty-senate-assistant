// Precompute retrieval counts so Workers load a small index and fetch only cited text.
import fs from 'node:fs';import crypto from 'node:crypto';import {tokens} from '../search.js';
const data=JSON.parse(fs.readFileSync('data/index.json'));const revision=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0,12),dir=`data/corpus-${revision}`;fs.mkdirSync(dir,{recursive:true});
const ids=new Map(data.sources.map((s,i)=>[s.url,i])),postings=new Map(),lengths=[],docs=[],registry=new Map(data.sources.map(s=>[s.url,s]));
if(data.passages.length>=65536)throw new Error('Corpus needs a larger posting identifier.');
for(let id=0;id<data.passages.length;id++){
 const p=data.passages[id],words=tokens(p.text),title=new Set(tokens(p.heading+' '+registry.get(p.source).title)),counts=new Map();lengths.push(words.length);
 for(const w of words)counts.set(w,(counts.get(w)||0)+1);
 for(const w of new Set([...counts.keys(),...title])){if(!postings.has(w))postings.set(w,[]);postings.get(w).push(id*65536+Math.min(counts.get(w)||0,32767)+(title.has(w)?32768:0));}
 // The procedural add-ons need a few original strings before text hydration.
 const keep=p.heading==='Course change classifications (full source)'||p.heading==='Start the Proposal'||/Create a new version/.test(p.text)&&/Create a new revision/.test(p.text)||registry.get(p.source).title==='Graduate Council Meeting';
 docs.push([ids.get(p.source),p.heading,words.length,keep?p.text:'']);
}
const flat=new Uint32Array([...postings.values()].reduce((n,p)=>n+p.length,0));const terms={};let at=0;
for(const [word,list] of postings){terms[word]=[at,list.length];flat.set(list,at);at+=list.length;}
fs.writeFileSync(`${dir}/postings.bin`,Buffer.from(flat.buffer));
const size=100;
for(let start=0;start<data.passages.length;start+=size)fs.writeFileSync(`${dir}/text-${Math.floor(start/size)}.json`,JSON.stringify(data.passages.slice(start,start+size).map(p=>p.text)));
const coverage=JSON.parse(fs.readFileSync('data/coverage.json'));const trackerCoverage={available:coverage.website.trackers.map(t=>({title:t.title,url:t.url})),unavailable:coverage.website.gaps.filter(g=>g.url.includes('12ENXKw')).map(g=>({title:'2019–2020 Curriculum Proposal Tracker',...g}))};
const routing={trackerCoverage,builtAt:data.builtAt,sources:data.sources,docs,terms,corpusBase:dir,shardSize:size};fs.writeFileSync(`${dir}/routing.json`,JSON.stringify(routing));
const manifest={builtAt:data.builtAt,sourceCount:data.sources.length,passageCount:data.passages.length,corpusBase:dir};fs.writeFileSync('data/corpus-manifest.json',JSON.stringify(manifest));
console.log(JSON.stringify({manifest,postings:flat.byteLength,routing:fs.statSync(`${dir}/routing.json`).size}));
