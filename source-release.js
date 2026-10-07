// A single public pointer keeps corpus routing and bill routing on one revision.
export const SOURCE_BASE='https://csckhanna.github.io/faculty-senate-assistant/';
const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export function validateRelease(value){
  const c=value?.corpus,b=value?.bills;
  if(value?.version!==1||!validDate(value.checkedAt)||!c||!b||!validDate(c.builtAt)||b.builtAt!==c.builtAt||b.corpusBase!==c.corpusBase||!/^data\/corpus-[a-f0-9]{12}$/.test(c.corpusBase)||!/^data\/bills-[a-f0-9]{12}\.json$/.test(b.path))throw new Error('Invalid source release');
  if(!Number.isInteger(c.sourceCount)||c.sourceCount<1||c.sourceCount>20000||!Number.isInteger(c.passageCount)||c.passageCount<1||c.passageCount>=65536||!Number.isInteger(b.recordCount)||b.recordCount<0||b.recordCount>c.passageCount)throw new Error('Invalid source counts');
  return value;
}
export async function loadSourceRelease(fetcher=fetch,base=SOURCE_BASE){
  const response=await fetcher(base+'data/source-release.json',{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('Source release unavailable');
  return validateRelease(await response.json());
}
