import {loadCorpus} from './corpus.js';
import {loadSourceRelease,SOURCE_BASE} from './source-release.js';

// Coverage is mutable while corpus files are immutable. Only display them
// together after their generation and counts agree, including during a publish.
export async function loadSourceInventory(currentIndex,fetcher=fetch,base=SOURCE_BASE){
  async function coverage(){
    const response=await fetcher(base+'data/coverage.json',{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Coverage unavailable');
    return response.json();
  }
  const descriptor=index=>({builtAt:index.builtAt,corpusBase:index.corpusBase,sourceCount:index.sources.length,passageCount:index.passages.length});
  const matches=(index,report)=>report?.builtAt===index.builtAt&&report.sourceCount===index.sources.length&&report.passageCount===index.passages.length;
  const [initialIndex,initialReport]=await Promise.allSettled([currentIndex,coverage()]);
  if(initialIndex.status==='fulfilled'&&initialReport.status==='fulfilled'&&matches(initialIndex.value,initialReport.value))return {index:initialIndex.value,coverage:initialReport.value,manifest:descriptor(initialIndex.value)};
  // An old tab may refer to an immutable revision that has since been pruned.
  // Its failed load must not prevent recovery through the current public release.
  let index,report;
  // A second bounded attempt allows the CDN to finish publishing its pointer.
  for(let attempt=0;attempt<2;attempt++){
    const manifest=(await loadSourceRelease(fetcher,base)).corpus;
    [index,report]=await Promise.all([loadCorpus(manifest,fetcher,base),coverage()]);
    if(matches(index,report))return {index,coverage:report,manifest};
  }
  throw new Error('Source inventory publication is incomplete');
}
