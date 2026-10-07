// Public documents are read as source material only. HTML is never executed;
// PDFs are attached directly to the existing model request, avoiding a PDF
// renderer/parser and its CPU cost in the Cloudflare Worker.

const ENTITIES={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',hellip:'…'};
export function decodeEntities(text){
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(all,key)=>{
    if(key[0]!=='#')return ENTITIES[key.toLowerCase()]??all;
    const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);
    return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):' ';
  });
}
export function htmlToText(html){
  return decodeEntities(String(html).replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
    .replace(/<\/?(?:p|div|h[1-6]|li|tr|section|article|main|br)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' '))
    .replace(/[\t \r]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
export function mainContent(html){
  const clean=String(html).replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  return clean.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1]||clean.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i)?.[1]||clean;
}
export function htmlLinks(html){
  return [...String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].map(m=>{
    const attrs=m[1],href=attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    return {href:decodeEntities(href?.[1]??href?.[2]??href?.[3]??''),text:htmlToText(m[2])};
  }).filter(a=>a.href);
}

export function pdfAttachment(bytes,{sourceUrl='',sourceId=2,filename='faculty-senate-agenda.pdf'}={}){
  const decoder=new TextDecoder(),header=decoder.decode(bytes.slice(0,8)),tail=decoder.decode(bytes.slice(-4096));
  if(!header.startsWith('%PDF-')||!tail.includes('%%EOF'))throw new Error('The linked file is not a complete readable PDF.');
  if(/\/Encrypt\b/.test(tail))throw new Error('The linked PDF requires a password.');
  let encoded;
  if(typeof bytes.toBase64==='function')encoded=bytes.toBase64();
  else{
    const chunks=[];
    for(let offset=0;offset<bytes.length;offset+=32768)chunks.push(String.fromCharCode(...bytes.subarray(offset,offset+32768)));
    encoded=btoa(chunks.join(''));
  }
  return {sourceUrl,sourceId,filename,mediaType:'application/pdf',fileData:'data:application/pdf;base64,'+encoded};
}
