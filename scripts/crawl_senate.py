"""Audit all published Senate pages/posts and their public linked documents/trackers.
Raw download caches stay outside the repository. No authenticated downloads.
"""
import concurrent.futures as cf, datetime as dt, hashlib, io, json, os, pathlib, re, urllib.parse as up, subprocess, threading, shutil
from html.parser import HTMLParser
import build_index as core
ROOT=core.ROOT
CACHE=pathlib.Path(os.environ.get('SENATE_CACHE',ROOT/'../../work/senate-audit')).resolve(); CACHE.mkdir(parents=True,exist_ok=True)
STAMP=dt.datetime.now(dt.timezone.utc).isoformat()
_fetched_this_run=set()
class Links(HTMLParser):
 def __init__(self): super().__init__(); self.links=[]; self.current=None
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='a' and a.get('href'): self.current=[a['href'],[]]
  if tag in ('iframe','embed','object') and (a.get('src') or a.get('data')): self.links.append((a.get('src') or a['data'],'Embedded document'))
 def handle_data(self,s):
  if self.current:self.current[1].append(s)
 def handle_endtag(self,tag):
  if tag=='a' and self.current:self.links.append((self.current[0],core.clean(' '.join(self.current[1]))));self.current=None

def normalize(url,base=core.SENATE):
 url=up.urljoin(base,url); p=up.urlsplit(url)
 if p.netloc in ('www.google.com','google.com') and p.path=='/url': return normalize(up.parse_qs(p.query).get('q',up.parse_qs(p.query).get('url',['']))[0],base)
 if p.scheme not in ('http','https'):return None
 if p.netloc=='web.uri.edu':
  path=p.path
  if '.' not in path.rsplit('/',1)[-1] and not path.endswith('/'):path+='/'
  return up.urlunsplit(('https',p.netloc,path,p.query if not p.query.startswith('utm_') else '',''))
 if p.netloc in ('docs.google.com','drive.google.com'):
  match=re.search(r'/(document|spreadsheets|presentation|file)/d/([^/?#]+)',p.path)
  if match:return 'https://'+p.netloc+'/'+match[1]+'/d/'+match[2]+('/view' if match[1]=='file' else '/edit')
  if p.path in ('/open','/uc') and up.parse_qs(p.query).get('id'):return 'https://drive.google.com/file/d/'+up.parse_qs(p.query)['id'][0]+'/view'
 return up.urlunsplit((p.scheme,p.netloc,p.path,p.query,''))

def eligible(url):
 p=up.urlsplit(url)
 if p.netloc=='web.uri.edu':
  if re.search(r'/feed/|/wp-json/|wp-content/(themes|plugins)|xmlrpc',p.path):return False
  return p.path.startswith(('/facsen/','/manual/')) or bool(re.search(r'\.(pdf|docx|xlsx|doc|xls)$',p.path,re.I))
 if p.netloc in ('docs.google.com','drive.google.com'):return bool(re.search(r'/(document|spreadsheets|presentation|file)/d/',p.path))
 return p.netloc=='digitalcommons.uri.edu' and ('facsen' in url) and ('viewcontent.cgi' in p.path or p.path.endswith('.pdf'))

def cached(url):
 key=hashlib.sha256(url.encode()).hexdigest(); file=CACHE/(key+'.bin'); meta=CACHE/(key+'.json')
 if file.exists() and meta.exists() and (os.environ.get('SENATE_REFRESH')!='1' or url in _fetched_this_run):return file.read_bytes(),json.loads(meta.read_text())['type']
 raw,typ=core.fetch(url); file.write_bytes(raw);meta.write_text(json.dumps({'type':typ,'url':url,'fetchedAt':dt.datetime.now(dt.timezone.utc).isoformat()}));_fetched_this_run.add(url);return raw,typ

def spreadsheet(raw,title,url):
 from openpyxl import load_workbook
 w=load_workbook(io.BytesIO(raw),data_only=True);lines=[];tabs=[];count=0
 for sheet in w:
  rows=[(n,[core.clean(str(c.value)) if c.value is not None else '' for c in row]) for n,row in enumerate(sheet,1)]
  rows=[(n,v) for n,v in rows if any(v)];tabs.append({'name':sheet.title,'rows':len(rows)});count+=len(rows)
  # Select a genuine column-heading row; never let the first proposal rows
  # overwrite field names. Blank columns retain their original positions.
  heading_words=re.compile(r'^(order of entry|college|dept\.?|department.*|course code|course title|program title|proposal.*|effective.*|status.*|.*decision|.*signature.*|.*bill.*|.*meeting.*|report|notes|present.*)$',re.I)
  candidate=max(rows[:12],key=lambda r:sum(bool(heading_words.fullmatch(v)) for v in r[1]),default=(0,[]))
  headers={i:v for i,v in enumerate(candidate[1]) if v} if sum(bool(heading_words.fullmatch(v)) for v in candidate[1])>=3 else {}
  for n,values in rows:
   fields=['%s: %s'%(headers.get(i,'Column '+str(i+1)),v) for i,v in enumerate(values) if v]
   identity=' | '.join(v for i,v in enumerate(values) if re.search(r'course code|course title|program title|^proposal$',headers.get(i,''),re.I))
   lines.extend(['# '+title+' | Sheet: '+sheet.title+' | Row '+str(n)+(' | '+identity[:240] if identity else ''), ' | '.join(fields)])
 return lines,tabs,count

def image_text_needed(page):
 # Empty Kuali form sections are often real blank pages. OCR only substantial
 # painted images, not thousands of blank sections and tiny repeated logos.
 substantial=False
 objects=page.get('/Resources',{}).get('/XObject',{})
 objects=objects.get_object() if hasattr(objects,'get_object') else objects
 area=float(page.mediabox.width)*float(page.mediabox.height)
 def visit(op,args,cm,tm):
  nonlocal substantial
  if op!=b'Do' or not args:return
  obj=objects.get(args[0]) if hasattr(objects,'get') else None
  if obj is None:return
  obj=obj.get_object()
  pixels=int(obj.get('/Width',0))*int(obj.get('/Height',0))
  painted=abs(cm[0]*cm[3]-cm[1]*cm[2])
  if obj.get('/Subtype')=='/Image' and pixels>100000 and painted>area*.03:substantial=True
 page.extract_text(visitor_operand_before=visit)
 return substantial

_ocr_lock=threading.Lock();_ocr_engine=None

def cleanup_legacy_ocr_inputs():
 # Older runs copied the complete document for every OCR page. Only remove
 # this crawler's known transient names after a completed OCR JSON proves the
 # page result is cached. Shared document inputs and unrelated files stay intact.
 removed=0
 for file in CACHE.iterdir():
  match=re.fullmatch(r'([a-f0-9]{64}-[1-9][0-9]*)(?:\.pdf|-render\.png)',file.name)
  if match and file.is_file() and (CACHE/(match[1]+'-ocr.json')).is_file():
   file.unlink();removed+=1
 return removed

def ocr_page(raw,n):
 global _ocr_engine
 digest=hashlib.sha256(raw).hexdigest();key=digest+'-'+str(n+1);out=CACHE/(key+'-ocr.json')
 if out.exists():return json.loads(out.read_text())
 with _ocr_lock:
  # Another fetch worker may have cached this page while we waited for OCR.
  if out.exists():return json.loads(out.read_text())
  if _ocr_engine is None:
   from rapidocr_onnxruntime import RapidOCR
   _ocr_engine=RapidOCR(intra_op_num_threads=4,inter_op_num_threads=1)
  # One immutable input serves every page of this document. Per-page copies
  # previously consumed gigabytes for long scanned curriculum reports.
  pdf=CACHE/(digest+'.pdf');prefix=CACHE/(key+'-render');image=prefix.with_suffix('.png')
  if not pdf.exists():pdf.write_bytes(raw)
  binary=os.environ.get('PDFTOPPM') or shutil.which('pdftoppm')
  if not binary:raise RuntimeError('Poppler pdftoppm is required for scanned PDF extraction')
  try:
   subprocess.run([binary,'-f',str(n+1),'-l',str(n+1),'-singlefile','-r','160','-png',str(pdf),str(prefix)],check=True,timeout=90,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   result,_=_ocr_engine(str(image))
   rows=[r[1] for r in result or []]
   temporary=out.with_suffix('.tmp');temporary.write_text(json.dumps(rows));temporary.replace(out)
   return rows
  finally:
   image.unlink(missing_ok=True)

def read(url,label):
 target=url;match=re.search(r'/(document|spreadsheets|presentation|file)/d/([^/?#]+)',url)
 if match:
  typ,ident=match.groups()
  target=('https://drive.google.com/uc?export=download&id='+ident) if typ=='file' else ('https://docs.google.com/'+typ+'/d/'+ident+'/export?format='+{'document':'txt','spreadsheets':'xlsx','presentation':'pdf'}[typ])
 raw,ctype=cached(target);key=hashlib.sha256(target.encode()).hexdigest();meta=json.loads((CACHE/(key+'.json')).read_text());fetched=meta.get('fetchedAt') or dt.datetime.fromtimestamp((CACHE/(key+'.bin')).stat().st_mtime,dt.timezone.utc).isoformat();links=[];tabs=[];rowcount=0;ocrpages=[]
 title=label or up.unquote(up.urlsplit(url).path.rstrip('/').rsplit('/',1)[-1]);kind='Faculty Senate linked document'
 if match and match[1]=='document':
  if 'html' in ctype:raise ValueError('Public document export unavailable')
  lines=raw.decode('utf-8-sig').splitlines()
 elif (match and match[1]=='spreadsheets') or raw[:2]==b'PK' and ('.xlsx' in url or 'spreadsheet' in ctype):
  lines,tabs,rowcount=spreadsheet(raw,title,url);kind='Faculty Senate proposal tracker' if re.search(r'track|20\d\d\s*[-–]',title,re.I) else 'Faculty Senate spreadsheet'
 elif raw.lstrip().startswith(b'%PDF') or 'application/pdf' in ctype:
  from pypdf import PdfReader
  pdf=PdfReader(io.BytesIO(raw));lines=[];extracted=[]
  for page in pdf.pages:
   try:extracted.append(page.extract_text() or '')
   except Exception:extracted.append('')
  image_only=sum(len(core.clean(t)) for t in extracted)<100
  for n,page in enumerate(pdf.pages):
   text=extracted[n]
   if len(core.clean(text))<100 and os.environ.get('SENATE_OCR')=='1' and (image_only or image_text_needed(page)):
    try:
     recovered=ocr_page(raw,n)
     if recovered:text='\n'.join(recovered);ocrpages.append(n+1)
    except ImportError:pass
   lines.extend(['# '+title+' | Page '+str(n+1),text])
   for annotation in page.get('/Annots',[]):
    a=annotation.get_object().get('/A',{});a=a.get_object() if hasattr(a,'get_object') else a;uri=a.get('/URI') if hasattr(a,'get') else None
    if uri:links.append((str(uri),'Linked from '+title))
  if sum(len(x) for x in lines)<120:raise ValueError('Scanned PDF has no usable embedded text')
  kind='Faculty Senate PDF'
 elif raw[:2]==b'PK':
  import zipfile,xml.etree.ElementTree as ET
  z=zipfile.ZipFile(io.BytesIO(raw));ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
  lines=[''.join(p.itertext()) for p in ET.fromstring(z.read('word/document.xml')).findall('.//w:p',ns)]
 elif 'html' in ctype or raw.lstrip().startswith((b'<!DOCTYPE',b'<html')):
  if match:raise ValueError('Public file download requires access or returned an HTML page')
  text=raw.decode('utf-8','replace');p=core.Page();p.feed(text);p.flush();lines=p.lines
  title=core.clean(' '.join(p.title)).replace(' – Faculty Senate','');kind='Faculty Senate website'
  a=Links();a.feed(text);links=a.links
  if not lines:raise ValueError('No main page content extracted')
 else:raise ValueError('Unsupported document format: '+ctype)
 if not any(core.clean(x) for x in lines):raise ValueError('Empty document')
 return {'url':url,'title':title,'kind':kind,'lines':lines,'fetchedAt':fetched,'tabs':tabs,'rowCount':rowcount,'ocrPages':ocrpages},links

def main():
 os.environ.setdefault('SENATE_REFRESH','1')
 cleaned=cleanup_legacy_ocr_inputs()
 if cleaned:print('Removed',cleaned,'completed legacy OCR render inputs from cache',flush=True)
 pending={core.SENATE:'Faculty Senate'};published=[];issues=[];seen=set();items={};labels={};tracker_ids=set()
 if os.environ.get('SOURCE_SEEDS'):
  for seed in json.loads(pathlib.Path(os.environ['SOURCE_SEEDS']).read_text()):
   url=normalize(seed['url'])
   if url and (eligible(url) or up.urlsplit(url).netloc=='web.uri.edu'):
    pending.setdefault(url,seed.get('title','Linked toolkit document'))
    if 'spreadsheets/d/' in url and re.search(r'track|20\d\d\s*[-–]',seed.get('title',''),re.I):tracker_ids.add(url);labels[url]=seed.get('title','Curriculum Proposal Tracker')
 # Enumerate every publicly published page/post, including pages missing from menus.
 for endpoint in ('pages','posts'):
  page=1
  while True:
   try:raw,_=cached(core.SENATE+'wp-json/wp/v2/'+endpoint+'?per_page=100&page='+str(page));data=json.loads(raw)
   except Exception as e:issues.append({'url':core.SENATE+'wp-json/wp/v2/'+endpoint,'reason':str(e)[:180]});break
   if not data:break
   for entry in data:pending[normalize(entry['link'])]=core.clean(re.sub('<[^>]+>','',entry['title']['rendered']));published.append(normalize(entry['link']))
   if len(data)<100:break
   page+=1
 with cf.ThreadPoolExecutor(max_workers=8) as pool:
  while pending:
   batch={u:t for u,t in pending.items() if u not in seen};pending={}
   if not batch:break
   seen.update(batch);jobs={pool.submit(read,u,t):u for u,t in batch.items()}
   for job in cf.as_completed(jobs):
    url=jobs[job]
    try:
     item,links=job.result();items[url]=item
     for link,label in links:
      link=normalize(link,url)
      if link and eligible(link):
       if label and label!='Embedded document':labels.setdefault(link,label)
       if link not in seen:pending[link]=labels.get(link,label)
       if 'spreadsheets/d/' in link and ('track' in item['title'].lower() or 'track' in label.lower() or re.search(r'20\d\d\s*[-–]',label)):tracker_ids.add(link)
     print('Indexed',len(items),'/',len(seen),'pending',len(pending),item['title'][:90],flush=True)
    except Exception as e:issues.append({'url':url,'reason':str(e)[:180]});print('GAP',url,str(e)[:90],flush=True)
 # Correct tracker titles from the archive labels, never from arbitrary PDF mentions.
 for url in tracker_ids:
  if url in items:
   items[url]['kind']='Faculty Senate proposal tracker'
   label=labels.get(url,items[url]['title']);items[url]['title']=label if 'curriculum proposal tracker' in label.lower() else label+' Curriculum Proposal Tracker'
 snapshot={'builtAt':STAMP,'publishedPages':sorted(set(published)),'items':list(items.values()),'trackers':[{'url':u,'title':items[u]['title'],'tabs':items[u]['tabs'],'rows':items[u]['rowCount']} for u in sorted(tracker_ids) if u in items],'gaps':issues,'attemptedSources':len(seen)}
 (ROOT/'data/senate-text.json').write_text(json.dumps(snapshot,ensure_ascii=False))
 print(json.dumps({'indexed':len(items),'publishedPages':len(set(published)),'trackers':len(snapshot['trackers']),'gaps':len(issues)}))
if __name__=='__main__':main()
