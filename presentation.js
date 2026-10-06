const SOURCE_HOSTS=new Set(['gilded-toucan-d8a.notion.site','web.uri.edu','digitalcommons.uri.edu','docs.google.com','drive.google.com']);
export function sourceUrl(source){
  try{const u=new URL(source.url);if(u.hostname==='web.uri.edu'&&u.protocol==='http:')u.protocol='https:';return u.protocol==='https:'&&SOURCE_HOSTS.has(u.hostname)?u.href:null;}catch{return null;}
}
export function answerBlocks(text){
  return text.trim().split(/\n\s*\n/).flatMap(paragraph=>{
    const lines=paragraph.split('\n'),blocks=[];let list=null;
    for(const line of lines){
      const match=line.match(/^\s*(?:(\d+)[.)]|([-*•]))\s+(.+)/);
      if(match){const type=match[1]?'ol':'ul';if(!list||list.type!==type){list={type,items:[]};blocks.push(list);}list.items.push(match[3]);}
      else{list=null;const previous=blocks.at(-1);if(previous?.type==='p')previous.text+=' '+line.trim();else blocks.push({type:'p',text:line.replace(/^#{1,4}\s+/,'').trim()});}
    }
    return blocks;
  });
}
function inline(parent,text,sources){
  const pattern=/\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[(\d+)\]/g;let end=0;
  for(const m of text.matchAll(pattern)){
    parent.append(document.createTextNode(text.slice(end,m.index)));
    const source=m[3]&&sources.find(s=>s.id===Number(m[3])),url=source&&sourceUrl(source);
    let node;
    if(url){node=document.createElement('a');node.textContent=m[3];node.href=url;node.target='_blank';node.rel='noopener';node.className='inline-citation';node.setAttribute('aria-label',`Source ${m[3]}: ${source.title}`);node.title=source.title;}
    else if(m[1]||m[2]){node=document.createElement(m[1]?'strong':'span');node.textContent=m[1]||m[2];}
    else node=document.createTextNode(m[0]);
    parent.append(node);end=m.index+m[0].length;
  }
  parent.append(document.createTextNode(text.slice(end)));
}
export function renderAnswer(text,sources=[]){
  const body=document.createElement('div');body.className='answer-body';
  for(const block of answerBlocks(text)){
    const node=document.createElement(block.type);
    if(block.items)for(const item of block.items){const li=document.createElement('li');inline(li,item,sources);node.append(li);}
    else inline(node,block.text,sources);
    body.append(node);
  }
  return body;
}
export function referenceLabel(source){
  const page=source.section?.match(/\| Page (\d+)/)?.[1];
  if(/^Linked from /i.test(source.title))return 'Senate document'+(page?' · page '+page:'');
  return source.title;
}
