// Public, immutable source shards. No credentials or conversation data are sent here.
const BASE='https://csckhanna.github.io/faculty-senate-assistant/';
export async function loadCorpus(manifest,fetcher=fetch,base=BASE){
 if(!/^data\/corpus-[a-f0-9]{12}$/.test(manifest.corpusBase))throw new Error('Invalid corpus revision');
 const [a,b]=await Promise.all([fetcher(base+manifest.corpusBase+'/routing.json',{signal:AbortSignal.timeout(15000)}),fetcher(base+manifest.corpusBase+'/postings.bin',{signal:AbortSignal.timeout(15000)})]);
 if(!a.ok||!b.ok)throw new Error('Corpus unavailable');
 const [routing,buffer]=await Promise.all([a.json(),b.arrayBuffer()]);
 if(routing.builtAt!==manifest.builtAt||routing.corpusBase!==manifest.corpusBase||routing.sources?.length!==manifest.sourceCount||routing.docs?.length!==manifest.passageCount)throw new Error('Corpus mismatch');
 const sources=routing.sources;
 return {...routing,base,postings:new Uint32Array(buffer),passages:routing.docs.map((d,id)=>({id,source:sources[d[0]].url,heading:d[1],text:d[3]}))};
}
export async function hydrateEvidence(data,evidence,fetcher=fetch){
 if(!data.corpusBase)return evidence;
const shardIds=[...new Set(evidence.map(r=>Math.floor(r.p.id/data.shardSize)))];
 const shards=new Map(await Promise.all(shardIds.map(async id=>{const r=await fetcher((data.base||BASE)+data.corpusBase+'/text-'+id+'.json',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Source text unavailable');return [id,await r.json()];})));
 return evidence.map(r=>{const id=r.p.id,text=shards.get(Math.floor(id/data.shardSize))[id%data.shardSize];if(typeof text!=='string')throw new Error('Source text mismatch');return {...r,p:{...r.p,text}};});
}
