import {loadSourceRelease,validateRelease,SOURCE_BASE} from '../source-release.js';
import {loadCorpus} from '../corpus.js';

export function createSourceStore({fallback=null,fetcher=fetch,now=()=>Date.now(),ttl=300000,base=SOURCE_BASE}={}){
  validateRelease(fallback);
  let current={release:fallback,releaseStatus:'bundled'},previous=fallback,checked=0,pending;
  const corpora=new Map(),bills=new Map();
  function cached(map,key,loader){
    if(!map.has(key))map.set(key,Promise.resolve().then(loader).catch(error=>{map.delete(key);throw error;}));
    while(map.size>2)map.delete(map.keys().next().value);
    return map.get(key);
  }
  async function corpus(release=current.release){
    return cached(corpora,release.corpus.corpusBase,()=>loadCorpus(release.corpus,fetcher,base));
  }
  async function billIndex(release=current.release){
    return cached(bills,release.bills.path,async()=>{
      const response=await fetcher(base+release.bills.path,{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('Bill lookup unavailable');
      const index=await response.json();
      if(index.builtAt!==release.corpus.builtAt||index.corpusBase!==release.corpus.corpusBase||index.records?.length!==release.bills.recordCount)throw new Error('Bill snapshot mismatch');
      return {...index,base};
    });
  }
  async function get(){
    if(checked&&now()-checked<ttl)return current;
    if(!pending)pending=(async()=>{
      try{
        const release=await loadSourceRelease(fetcher,base);
        // Validate both immutable assets before promoting a pointer from the CDN.
        // Keep serving the previous revision while a publish is incomplete.
        await Promise.all([corpus(release),billIndex(release)]);
        if(release.corpus.corpusBase!==current.release.corpus.corpusBase)previous=current.release;
        current={release,releaseStatus:'current'};
      }catch{current={...current,releaseStatus:'last-good'};}
      checked=now();return current;
    })().finally(()=>{pending=undefined;});
    return pending;
  }
  async function run(operation){
    const state=await get();
    let release=state.release,status=state.releaseStatus,answer;
    try{answer=await operation(release);}
    catch(error){
      if(previous.corpus.corpusBase===release.corpus.corpusBase)throw error;
      release=previous;status='last-good';answer=await operation(release);
    }
    return {...answer,sourceCheckedAt:release.checkedAt,sourceStatus:status};
  }
  return {get,corpus,billIndex,run};
}
