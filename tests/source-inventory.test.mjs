import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCorpus} from '../corpus.js';
import {loadSourceInventory} from '../source-inventory.js';

const base='https://csckhanna.github.io/faculty-senate-assistant/';
function publication(number){
  const revision=String(number).padStart(12,'0'),builtAt=`2027-01-${String(10+number).padStart(2,'0')}T12:00:00Z`,corpusBase=`data/corpus-${revision}`;
  const manifest={builtAt,corpusBase,sourceCount:number,passageCount:number};
  const sources=Array.from({length:number},(_,i)=>({title:`Generation ${number} source ${i+1}`,kind:'Faculty Senate page',url:`https://web.uri.edu/facsen/fixture-${number}-${i}/`,fetchedAt:'2026-09-03T12:00:00Z',...(number===2&&i===0?{notice:'The latest refresh could not verify this source. This is its last readable text.'}:{})}));
  return {
    release:{version:1,checkedAt:builtAt,corpus:manifest,bills:{builtAt,corpusBase,path:`data/bills-${revision}.json`,recordCount:0}},
    routing:{...manifest,sources,docs:sources.map((s,i)=>[i,'Guidance',2,'']),shardSize:100,terms:{}},
    coverage:{builtAt,sourceCount:number,passageCount:number,limitations:[`Coverage for generation ${number}.`],website:{publishedPages:number,publishedPagesIndexed:number,trackers:[],gaps:[]}}
  };
}
function fixture(){
  const values=[publication(1),publication(2)],files=new Map(),calls=[];
  for(const value of values){files.set(value.release.corpus.corpusBase+'/routing.json',value.routing);files.set(value.release.corpus.corpusBase+'/postings.bin',new Uint32Array().buffer);}
  let pointer=values[0].release,coverage=values[0].coverage;
  const fetcher=async url=>{
    const path=String(url).slice(base.length);calls.push(path);
    if(path==='data/source-release.json')return Response.json(pointer);
    if(path==='data/coverage.json')return Response.json(coverage);
    if(!files.has(path))return new Response('',{status:404});
    const value=files.get(path);return value instanceof ArrayBuffer?new Response(value):Response.json(value);
  };
  return {values,files,calls,fetcher,publish:number=>{pointer=values[number-1].release;coverage=values[number-1].coverage;},setPointer:value=>{pointer=value;},setCoverage:value=>{coverage=value;}};
}

test('an existing tab adopts a matching new inventory after its coverage report changes',async()=>{
  const f=fixture(),old=await loadCorpus(f.values[0].release.corpus,f.fetcher,base);f.publish(2);
  const result=await loadSourceInventory(old,f.fetcher,base);
  assert.equal(result.manifest.corpusBase,f.values[1].release.corpus.corpusBase);
  assert.equal(result.index.builtAt,result.coverage.builtAt);
  assert.equal(result.index.sources.length,result.coverage.sourceCount);
  assert.equal(old.sources[0].title,'Generation 1 source 1');
});

test('an aligned inventory reuses its immutable index without unnecessary corpus reads',async()=>{
  const f=fixture(),index=await loadCorpus(f.values[0].release.corpus,f.fetcher,base);f.calls.length=0;
  const result=await loadSourceInventory(index,f.fetcher,base);
  assert.equal(result.index,index);assert.deepEqual(f.calls,['data/coverage.json']);
});

test('a retired old corpus recovers through a readable new release, while missing new assets fail safely',async()=>{
  const f=fixture();f.publish(2);f.files.delete(f.values[0].release.corpus.corpusBase+'/routing.json');
  const result=await loadSourceInventory(loadCorpus(f.values[0].release.corpus,f.fetcher,base),f.fetcher,base);
  assert.equal(result.index.builtAt,f.values[1].coverage.builtAt);
  assert.equal(result.manifest.corpusBase,f.values[1].release.corpus.corpusBase);
  f.files.delete(f.values[1].release.corpus.corpusBase+'/routing.json');
  await assert.rejects(loadSourceInventory(loadCorpus(f.values[0].release.corpus,f.fetcher,base),f.fetcher,base),/Corpus unavailable/);
});

test('a partially published pointer or inconsistent coverage never produces a mixed inventory',async()=>{
  const f=fixture(),index=await loadCorpus(f.values[0].release.corpus,f.fetcher,base);
  f.setCoverage(f.values[1].coverage);
  await assert.rejects(loadSourceInventory(index,f.fetcher,base),/publication is incomplete/);
  f.publish(2);f.setCoverage({...f.values[1].coverage,sourceCount:999});
  await assert.rejects(loadSourceInventory(index,f.fetcher,base),/publication is incomplete/);
  f.setCoverage(f.values[1].coverage);f.files.delete(f.values[1].release.corpus.corpusBase+'/routing.json');
  await assert.rejects(loadSourceInventory(index,f.fetcher,base),/Corpus unavailable/);
  assert.equal(index.sources.length,1);assert.equal(index.builtAt,f.values[0].coverage.builtAt);
});

// Exercise the real frontend with only a minimal DOM and public-source fixtures.
// This catches conversation resets and invisible qualification text that a
// helper-only test would miss; no browser, gateway, or email requests are made.
class Element {
  constructor(tag='div',text=''){this.tagName=tag;this.children=[];this._text=text;this.events=new Map();this.dataset={};this.value='';this.className='';this.classList={add:name=>{this.className+=' '+name;},remove:name=>{this.className=this.className.split(/\s+/).filter(c=>c!==name).join(' ');}};this.style={setProperty(){}};this.offsetHeight=20;this.offsetTop=0;this.scrollHeight=200;this.scrollTop=0;this.clientHeight=400;}
  get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
  set textContent(value){this._text=String(value);this.children=[];}
  get childNodes(){return this.children;}
  get lastElementChild(){return this.children.at(-1);}
  get previousElementSibling(){const siblings=this.parent?.children||[];return siblings[siblings.indexOf(this)-1];}
  append(...nodes){for(const node of nodes){const child=typeof node==='string'?new Element('#text',node):node;child.parent=this;this.children.push(child);}}
  replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
  insertBefore(node,before){node.parent=this;this.children.splice(this.children.indexOf(before),0,node);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
  setAttribute(name,value){this[name]=String(value);}
  addEventListener(name,action){if(!this.events.has(name))this.events.set(name,[]);this.events.get(name).push(action);}
  dispatch(name){for(const action of this.events.get(name)||[])action({target:this,currentTarget:this,preventDefault(){}});}
  descendants(){return this.children.flatMap(c=>[c,...c.descendants()]);}
  querySelector(selector){return this.descendants().find(n=>selector.startsWith('.')&&n.className.split(/\s+/).includes(selector.slice(1)))||null;}
  contains(node){return this===node||this.descendants().includes(node);}
  showModal(){this.open=true;}
  close(){this.open=false;}
  focus(){}
}
async function until(check){for(let i=0;i<40;i++){if(check())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail('Frontend fixture did not finish loading');}
test('reopening source coverage updates its generation and discovery qualifications while preserving the transcript and draft',async()=>{
  const f=fixture(),nodes=new Map(),saved={question:'How do I modify a course?',draft:'My unfinished follow-up',records:[{role:'user',content:'How do I modify a course?'},{role:'assistant',kind:'answer',answer:'Use the published course guidance.',sources:[],followUp:''}]};
  const visitKey='senate-assistant-visit-v1:/faculty-senate-assistant/',storage=new Map([[visitKey,JSON.stringify(saved)]]);
  const node=selector=>{if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector);};
  const document={querySelector:node,querySelectorAll:selector=>[...new Set([...nodes.values()].flatMap(n=>[n,...n.descendants()]))].filter(n=>selector.startsWith('.')&&n.className.split(/\s+/).includes(selector.slice(1))),createElement:tag=>new Element(tag),createTextNode:text=>new Element('#text',text),documentElement:new Element(),body:new Element()};
  const globals={document,window:{addEventListener(){}},location:{href:base,pathname:'/faculty-senate-assistant/'},sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},fetch:async(url,options)=>String(url).endsWith('/health')?Response.json({ready:true}):f.fetcher(url,options)};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  try{
    await import('../app.js?source-inventory-fixture');
    node('#sources-button').dispatch('click');await until(()=>node('#source-list').textContent.includes('Generation 1 source 1'));
    assert.doesNotMatch(node('#coverage').textContent,/complete list of published Senate pages could not be verified/);
    node('#close-dialog').dispatch('click');
    const transcript=node('#results').textContent,stored=storage.get(visitKey);
    f.values[1].coverage.website.discoveryComplete=false;
    f.publish(2);node('#sources-button').dispatch('click');
    await until(()=>node('#source-list').textContent.includes('Generation 2 source 2'));
    assert.match(node('#coverage').textContent,/2 sources and 2 passages/);
    assert.match(node('#coverage').textContent,/Coverage for generation 2/);
    assert.match(node('#coverage').textContent,/The complete list of published Senate pages could not be verified/);
    assert.match(node('#coverage').textContent,/Known pages and followed public links were checked, but some newly published pages may be missing/);
    const discoveryNote=node('#coverage').children.find(child=>child.className==='coverage-discovery-note');
    assert.equal(discoveryNote.children[0].tagName,'strong');
    assert.doesNotMatch(node('#source-list').textContent,/Generation 1 source/);
    assert.match(node('#source-list').textContent,/Source text collected Sep 3, 2026/);
    assert.match(node('#source-list').textContent,/Source qualification: The latest refresh could not verify this source/);
    assert.equal(node('#results').textContent,transcript);
    assert.equal(node('#question').value,saved.draft);
    assert.equal(storage.get(visitKey),stored);
    assert.match(node('#load-status').textContent,/2 sources/);
    node('#close-dialog').dispatch('click');f.values[1].coverage.website.discoveryComplete=true;node('#sources-button').dispatch('click');
    await until(()=>node('#source-list').textContent.includes('Generation 2 source 2'));
    assert.doesNotMatch(node('#coverage').textContent,/complete list of published Senate pages could not be verified/);
    assert.equal(node('#results').textContent,transcript);assert.equal(node('#question').value,saved.draft);assert.equal(storage.get(visitKey),stored);
  }finally{for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
