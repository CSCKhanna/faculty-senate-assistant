"""Read all public toolkit blocks, database rows, synced sections and rich references.
Raw cache stays outside the public repository. TOOLKIT_CACHE can reuse a reviewed cache.
"""
import datetime as dt
import importlib.util,json,pathlib,concurrent.futures as cf,urllib.parse as up,urllib.request as ur,re,hashlib,time,os,tempfile
ROOT=pathlib.Path(os.environ.get('SOURCE_ROOT') or pathlib.Path(__file__).resolve().parents[1]).resolve(); CACHE=pathlib.Path(os.environ.get('TOOLKIT_CACHE') or tempfile.mkdtemp(prefix='senate-toolkit-'));CACHE.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('idx',ROOT/'scripts/build_index.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
blocks={};collections={};views={};queried=set();loaded=set();failed={};assets={};links={};rowids=set();catalog={};source_lines={}
def merge(j):
 rm=j.get('recordMap',{})
 for table,dest in [('block',blocks),('collection',collections),('collection_view',views)]:
  for k,v in rm.get(table,{}).items():dest[k]=m.unpack(v)
def request(name,endpoint,payload):
 f=CACHE/(name+'.json')
 if f.exists() and os.environ.get('TOOLKIT_REFRESH')!='1':return json.loads(f.read_text())
 raw,_=m.fetch(m.NOTION+'/api/v3/'+endpoint,payload);j=json.loads(raw);f.write_text(json.dumps(j));return j
def load(bid):
 if bid in loaded:return
 loaded.add(bid);cursor={'stack':[]}
 for n in range(100):
  j=request('full-'+bid+'-'+str(n),'loadPageChunk',{'pageId':bid,'limit':100,'cursor':cursor,'chunkNumber':n,'verticalColumns':False});merge(j);cursor=j.get('cursor',{'stack':[]})
  if not cursor.get('stack'):break
 else:failed[bid]='Pagination did not finish'
 if bid not in blocks:failed[bid]='Referenced block did not return public content'
def rich(value):
 out=[]
 for item in value or []:
  if not isinstance(item,list) or not item:continue
  txt=str(item[0]);marks=item[1] if len(item)>1 else []
  for mark in marks:
   if mark and mark[0]=='d' and len(mark)>1:
    date=mark[1];start=date.get('start_date','');txt=(dt.date.fromisoformat(start).strftime('%B %d, %Y')+' ('+start+')' if start else '')+(' '+date.get('start_time','') if date.get('start_time') else '')+(' through '+date['end_date'] if date.get('end_date') else '')
   if mark and mark[0]=='eoi' and len(mark)>1:
    attrs=blocks.get(mark[1],{}).get('format',{}).get('attributes',[]);txt=next((' '.join(a.get('values',[])) for a in attrs if a.get('id')=='title'),'Linked document')
   if mark and mark[0]=='p' and len(mark)>1:
    pid=mark[1];txt=m.rich(blocks.get(pid,{}).get('properties',{}).get('title')) or txt
  out.append(txt)
 return ''.join(out)
def query(bid,b):
 vid=(b.get('view_ids') or [None])[0];cid=b.get('collection_id') or b.get('format',{}).get('collection_pointer',{}).get('id') or views.get(vid,{}).get('format',{}).get('collection_pointer',{}).get('id')
 if not cid or not vid:failed[bid]='Collection view has no resolvable collection/view';return []
 if cid in queried:return catalog.get(cid,{}).get('rows',[])
 queried.add(cid)
 j=request('query-'+cid,'queryCollection',{'collection':{'id':cid},'collectionView':{'id':vid},'loader':{'type':'reducer','reducers':{'collection_group_results':{'type':'results','limit':1000}},'searchQuery':'','userTimeZone':'America/New_York'}});merge(j)
 result=j.get('result',{}).get('reducerResults',{}).get('collection_group_results',{});ids=result.get('blockIds',[]);rowids.update(ids)
 catalog[cid]={'title':rich(collections.get(cid,{}).get('name')),'rows':ids,'result':{k:v for k,v in result.items() if k!='blockIds'}}
 if len(ids)>=1000 or result.get('hasMore'):failed[bid]='Database row pagination needs further inspection'
 return ids
def edges(bid):
 if bid not in blocks:load(bid)
 b=blocks.get(bid,{})
 e=list(b.get('content',[]));ptr=b.get('format',{}).get('transclusion_reference_pointer',{}).get('id')
 if ptr:e.append(ptr)
 if b.get('type')=='collection_view':
  try:e.extend(query(bid,b))
  except Exception as ex:failed[bid]=str(ex)
 for value in b.get('properties',{}).values():
  for item in value if isinstance(value,list) else []:
   if isinstance(item,list) and len(item)>1:
    for mark in item[1]:
     if mark and mark[0] in ('p','eoi') and len(mark)>1:e.append(mark[1])
 if b.get('type')=='link_to_page':
  pid=b.get('format',{}).get('page_pointer',{}).get('id')
  if pid:e.append(pid)
 return list(dict.fromkeys(e))
load(m.TOOLKIT);seen=set();todo={m.TOOLKIT}
with cf.ThreadPoolExecutor(max_workers=6) as pool:
 while todo:
  missing=[bid for bid in todo if bid not in blocks and bid not in loaded]
  futures={pool.submit(load,bid):bid for bid in missing}
  for f in cf.as_completed(futures):
   try:f.result()
   except Exception as e:failed[futures[f]]=str(e)
  batch=todo-seen;todo=set();seen.update(batch)
  for bid in batch:
   try:todo.update(set(edges(bid))-seen)
   except Exception as e:failed[bid]=str(e)
  print('reachable',len(seen),'pages',sum(blocks.get(x,{}).get('type')=='page' for x in seen),'databases',len(queried),'pending',len(todo),'issues',len(failed),flush=True)
# Keep only reachable published source content; raw API metadata never goes into the index.
pages=[x for x in seen if blocks.get(x,{}).get('type')=='page']
for pid in pages:
 b=blocks[pid];url=m.NOTION+'/'+pid.replace('-','');title=rich(b.get('properties',{}).get('title')) or 'Toolkit entry';lines=[];visited=set()
 if pid in rowids:
  parent=b.get('parent_id');schema=collections.get(parent,{}).get('schema',{})
  for key,value in b.get('properties',{}).items():
   if key!='title':
    text=rich(value)
    if text:lines.append(schema.get(key,{}).get('name',key)+': '+text)
 def walk(bid):
  if bid in visited:return
  visited.add(bid);v=blocks.get(bid,{})
  if v.get('type')=='page' and bid!=pid:
   lines.append('Related toolkit entry: '+rich(v.get('properties',{}).get('title')));return
  typ=v.get('type');props=v.get('properties',{});fmt=v.get('format',{});text=rich(props.get('title'))
  if typ in ('image','file','video','audio','embed','external_object_instance'):
   asset=rich(props.get('source')) or fmt.get('display_source') or fmt.get('uri') or ''
   if asset:assets[bid]={'id':bid,'page':pid,'pageTitle':title,'type':typ,'title':text,'source':asset,'caption':rich(props.get('caption'))}
   text=rich(props.get('caption'))
  if typ=='table':
   rows=[blocks.get(x,{}) for x in v.get('content',[])];header=[]
   if fmt.get('table_block_column_header') and rows:header=[rich(p) for p in rows[0].get('properties',{}).values()]
   for n,row in enumerate(rows):
    values=[rich(p) for p in row.get('properties',{}).values()]
    if n==0 and header:lines.append('Table columns: '+' | '.join(header));continue
    lines.append(' | '.join(((header[i]+': ') if i<len(header) else '')+val for i,val in enumerate(values)))
   return
  if typ=='table_row':text=' | '.join(rich(p) for p in props.values())
  if text:lines.append(('# ' if typ in ('header','sub_header','sub_sub_header','header_4','toggle') else '')+text)
  for value in props.values():
   for item in value if isinstance(value,list) else []:
    if isinstance(item,list) and len(item)>1:
     for mark in item[1]:
      if mark and mark[0]=='a' and len(mark)>1:links.setdefault(mark[1],set()).add(pid)
  for x in edges(bid):walk(x)
 walk(pid)
 source_lines[pid]={'url':url,'title':title,'kind':'Curriculum Toolkit database item' if pid in rowids else 'Curriculum Toolkit','lines':lines,'modified':b.get('last_edited_time')}
(CACHE/'content.json').write_text(json.dumps({'pages':list(source_lines.values()),'assets':list(assets.values()),'links':[{'url':url,'pages':list(ps)} for url,ps in links.items()],'catalog':catalog,'issues':failed},ensure_ascii=False,indent=2))
(CACHE/'block-safe-summary.json').write_text(json.dumps({bid:{'type':blocks.get(bid,{}).get('type'),'title':rich(blocks.get(bid,{}).get('properties',{}).get('title'))} for bid in seen},ensure_ascii=False))
print(json.dumps({'pages':len(pages),'databaseRows':len(rowids),'assets':len(assets),'links':len(links),'issues':failed,'databaseCounts':{c['title']:len(c['rows']) for c in catalog.values()}},indent=2),flush=True)
