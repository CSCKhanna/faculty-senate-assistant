"""Index public Senate guidance. No login, private records, or credentials used.

Notion's public read endpoint is unofficial; failures are recorded in coverage.json.
Run with Python 3 and pypdf installed to include linked, text-readable PDFs.
"""
import concurrent.futures as cf
import datetime as dt
import io
import json
import pathlib
import re
import time
import urllib.parse as up
import urllib.request as ur
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parents[1]
NOTION = 'https://gilded-toucan-d8a.notion.site'
SENATE = 'https://web.uri.edu/facsen/'
TOOLKIT = '3a57535b-f92c-80c7-8bac-d5b49e9c6c12'
STAMP = dt.datetime.now(dt.timezone.utc).isoformat()
sources, failures, passages, external = {}, [], [], set()

def fetch(url, payload=None):
    body = json.dumps(payload).encode() if payload else None
    req = ur.Request(url, data=body, headers={'User-Agent': 'SenateToolkitPrototype/1.0', **({'Content-Type': 'application/json'} if body else {})})
    for attempt in range(3):
        try:
            with ur.urlopen(req, timeout=18) as r:
                return r.read(), r.headers.get('Content-Type', '')
        except Exception:
            if attempt==2: raise
            time.sleep(0.5)

def clean(s):
    return re.sub(r'\s+', ' ', s).strip()

def rich(v):
    return ''.join(str(x[0]) for x in v or [] if isinstance(x, list) and x)

def add_source(url, title, kind, lines, edited=None):
    lines = [clean(s) for s in lines if clean(s)]
    text = '\n'.join(lines)
    warning = 'under construction' in text.lower() or 'currently being developed' in text.lower() or 'may become outdated' in text.lower()
    sources[url] = {'url':url, 'title':title, 'kind':kind, 'fetchedAt':STAMP, 'modified':edited, 'notice': 'This source includes a development or outdated-content notice. Check the original page.' if warning else ''}
    # Keep paragraphs adjacent to their headings; do not splice unrelated lines into an answer.
    heading = title
    buffer = []
    def flush():
        if buffer:
            s = '\n'.join(buffer)
            if s:
                passages.append({'source':url, 'heading':heading, 'text':s})
            buffer.clear()
    for line in lines:
        if line.startswith('# '):
            flush(); heading = line[2:]; continue
        if sum(len(x) for x in buffer) + len(line) > 1200: flush()
        # Long PDF paragraphs need bounded excerpts without losing source provenance.
        for part in re.split(r'(?<=[.!?])\s+(?=[A-Z])', line) if len(line)>1800 else [line]:
            if sum(len(x) for x in buffer)+len(part)>1200: flush()
            buffer.append(part)
    flush()
    if title=='Major and Minor Changes':
        passages.append({'source':url,'heading':'Course change classifications (full source)','text':text})

class Page(HTMLParser):
    def __init__(self):
        super().__init__(); self.depth=0; self.start=None; self.skip=0; self.lines=[]; self.buf=[]; self.links=[]; self.title=[]; self.in_title=False; self.heading=False
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if tag=='title': self.in_title=True
        if tag=='a' and a.get('href'): self.links.append(a['href'])
        if tag in ('script','style','nav','footer'): self.skip+=1
        if tag not in ('img','br','hr','input','meta','link','source','wbr','area','embed','param'): self.depth+=1
        if self.start is None and ('entry-content' in a.get('class','').split() or tag=='main'): self.start=self.depth
        if tag in ('p','div','li','tr','h1','h2','h3','h4','h5','h6','br'): self.flush()
        if re.fullmatch('h[1-6]',tag): self.heading=True
    def handle_endtag(self,tag):
        if tag=='title': self.in_title=False
        if tag in ('p','div','li','tr','h1','h2','h3','h4','h5','h6'): self.flush()
        if re.fullmatch('h[1-6]',tag): self.heading=False
        if self.start==self.depth: self.start=None
        if tag in ('script','style','nav','footer'): self.skip=max(0,self.skip-1)
        self.depth=max(0,self.depth-1)
    def handle_data(self,s):
        if self.in_title: self.title.append(s)
        if self.start is not None and not self.skip: self.buf.append(s)
    def flush(self):
        s=clean(' '.join(self.buf)); self.buf=[]
        if s: self.lines.append(('# ' if self.heading else '')+s)

def unpack(v):
    while isinstance(v,dict) and 'value' in v and 'type' not in v: v=v['value']
    return v

def notion_page(pid):
    blocks={}; cursor={'stack':[]}
    for n in range(12):
        raw,_=fetch(NOTION+'/api/v3/loadPageChunk',{'pageId':pid,'limit':100,'cursor':cursor,'chunkNumber':n,'verticalColumns':False})
        obj=json.loads(raw)
        blocks.update({k:unpack(v) for k,v in obj.get('recordMap',{}).get('block',{}).items()})
        cursor=obj.get('cursor',{'stack':[]})
        if not cursor.get('stack'): break
    page=blocks.get(pid,{})
    if page.get('type')!='page': raise ValueError('Public page unavailable')
    reachable=set()
    def discover(bid):
        if bid in reachable: return
        reachable.add(bid)
        b=blocks.get(bid,{})
        if b.get('type')=='page' and bid!=pid: return
        for c in b.get('content',[]): discover(c)
    discover(pid)
    pending=reachable-set(blocks)
    for _ in range(12):
        if not pending: break
        ids=list(pending); pending=set()
        try:
            raw,_=fetch(NOTION+'/api/v3/getRecordValues',{'requests':[{'id':x,'table':'block'} for x in ids]})
        except Exception:
            failures.append({'url':NOTION+'/'+pid.replace('-',''), 'reason':'Partial import: '+str(len(ids))+' embedded blocks unavailable; linked images and database views require separate import.'})
            break
        for bid,v in zip(ids,json.loads(raw).get('results',[])):
            b=unpack(v)
            if not b.get('type'): continue
            blocks[bid]=b
            if b.get('type')!='page': pending.update(c for c in b.get('content',[]) if c not in blocks)
    title=rich(page.get('properties',{}).get('title')) or 'Toolkit page'
    lines=[]; children=set(); links=set(); visited=set()
    def walk(bid):
        if bid in visited: return
        visited.add(bid); b=blocks.get(bid,{})
        typ=b.get('type'); props=b.get('properties',{})
        if typ=='page' and bid!=pid:
            children.add(bid); return
        txt='' if typ in ('image','video','audio','file') else rich(props.get('title'))
        if typ=='table_row': txt=' | '.join(rich(v) for v in props.values())
        if txt: lines.append(('# ' if typ in ('header','sub_header','sub_sub_header') else '')+txt)
        if typ=='link_to_page':
            target=b.get('format',{}).get('page_pointer',{}).get('id')
            if target: children.add(target)
        # Rich links are public provenance links, not private metadata.
        for value in props.values():
            for item in value if isinstance(value,list) else []:
                if len(item)>1:
                    for mark in item[1]:
                        if mark and mark[0]=='a' and len(mark)>1: links.add(mark[1])
        for c in b.get('content',[]): walk(c)
    walk(pid)
    return pid,title,lines,children,links,page.get('last_edited_time')

def canonical(url):
    p=up.urlsplit(url)
    if p.scheme not in ('http','https'): return None
    path=p.path
    if p.netloc=='web.uri.edu' and path.startswith('/facsen/') and not path.endswith('/') and '.' not in path.rsplit('/',1)[-1]: path+='/'
    return up.urlunsplit((p.scheme,p.netloc,path,'',''))

def is_senate(url):
    return url.startswith(SENATE)

def web_page(url):
    raw,typ=fetch(url)
    if 'pdf' in typ or url.lower().endswith('.pdf'):
        from pypdf import PdfReader
        r=PdfReader(io.BytesIO(raw)); lines=[]
        for n,p in enumerate(r.pages):
            lines.extend(['# Page '+str(n+1),p.extract_text() or ''])
        if sum(len(x) for x in lines)<120: raise ValueError('No usable PDF text; possibly scanned')
        return url, up.unquote(url.rsplit('/',1)[-1]),'PDF',lines,[]
    p=Page();p.feed(raw.decode('utf-8','replace'));p.flush()
    if not p.lines: raise ValueError('No main content extracted')
    return url,clean(' '.join(p.title)).replace(' – Faculty Senate',''),'Faculty Senate website',p.lines,[up.urljoin(url,x) for x in p.links]

def main():
    import os, subprocess, sys, tempfile
    cache=pathlib.Path(os.environ.get('TOOLKIT_CACHE') or tempfile.mkdtemp(prefix='senate-toolkit-'))
    subprocess.run([sys.executable,str(ROOT/'scripts/crawl_toolkit.py')],env={**os.environ,'TOOLKIT_CACHE':str(cache)},check=True)
    toolkit=json.loads((cache/'content.json').read_text())
    webq={SENATE}
    for page in toolkit['pages']:
        add_source(page['url'],page['title'],page['kind'],[page['title']]+page['lines'],page['modified'])
    for bid,reason in toolkit['issues'].items(): failures.append({'url':NOTION+'/'+bid.replace('-',''),'reason':reason})
    assets={a['id']:a for a in toolkit['assets'] if a['type'] in ('file','image')}
    reviewed=json.loads((ROOT/'data/toolkit-media-text.json').read_text())
    imported=set()
    for item in reviewed['items']:
        current=assets.get(item['id'])
        if not current: continue
        if item.get('resourceSource')!=current['source']:
            failures.append({'url':item['url'],'reason':'Image or attachment changed; new extraction/transcription must be reviewed.'}); continue
        add_source(item['url'],item['title'],item['kind'],item['lines'])
        sources[item['url']]['notice']='Image transcription: verify small text and diagram arrows in the original.' if item['method'].startswith('Sonnet') else ''
        imported.add(item['id'])
    for bid in set(assets)-imported:
        failures.append({'url':NOTION+'/'+assets[bid]['page'].replace('-',''),'reason':'New or changed attachment is not yet transcribed: '+assets[bid]['title']})
    # Linked resources have separate, auditable extraction dates. Keep the reviewed
    # public snapshot until a full linked-file refresh is reviewed; never drop it.
    linked=json.loads((ROOT/'data/toolkit-linked-text.json').read_text())
    for item in linked['items']:
        url=item['url'].split('?')[0] if 'google.com' in item['url'] else item['url']
        add_source(url,item['title'],item['kind'],item['lines'])
        sources[url]['fetchedAt']=linked['builtAt']
    for entry in toolkit['links']:
        link=canonical(entry['url'])
        if link and is_senate(link): webq.add(link)
    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        webseen=set(); pdfq=set()
        while webq:
            batch=sorted(webq-webseen);webq=set()
            if not batch: break
            webseen.update(batch)
            jobs={pool.submit(web_page,u):u for u in batch}
            for f in cf.as_completed(jobs):
                url=jobs[f]
                try:
                    _,title,kind,lines,links=f.result();add_source(url,title,kind,lines)
                    for link in links:
                        link=canonical(link)
                        if not link: continue
                        if is_senate(link) and not re.search(r'/feed/?$|/wp-json/',link): webq.add(link)
                        elif link.lower().endswith('.pdf') and up.urlsplit(link).netloc in ('web.uri.edu','uri.edu','www.uri.edu'): pdfq.add(link)
                        elif 'notion.site/' in link:
                            pass
                        else: external.add(link)
                    print('Website:',title,flush=True)
                except Exception as e: failures.append({'url':url,'reason':str(e)[:180]})
        jobs={pool.submit(web_page,u):u for u in sorted(pdfq-webseen)}
        for f in cf.as_completed(jobs):
            url=jobs[f]
            try:
                _,title,kind,lines,_=f.result();add_source(url,title,kind,lines)
            except Exception as e: failures.append({'url':url,'reason':str(e)[:180]})
    (ROOT/'data').mkdir(exist_ok=True)
    data={'builtAt':STAMP,'sources':list(sources.values()),'passages':passages}
    (ROOT/'data/index.json').write_text(json.dumps(data,ensure_ascii=False))
    coverage={'builtAt':STAMP,'sourceCount':len(sources),'passageCount':len(passages),'toolkit':{'pages':sum(p['kind']=='Curriculum Toolkit' for p in toolkit['pages']),'databaseEntries':sum(p['kind'].endswith('database item') for p in toolkit['pages']),'databases':{x['title']:len(x['rows']) for x in toolkit['catalog'].values()},'attachmentsAndImages':len(imported),'unresolvedBlocks':len(toolkit['issues'])},'failures':failures,'externalLinksNotIndexed':sorted(external),'limitations':['Snapshot, not a live connection. Toolkit pages and all public database rows were refreshed.','Image and file transcriptions are reused only when their attachment reference is unchanged. New or replaced files are reported as gaps. Verify small text and diagram arrows in the original.','Linked-document snapshot collected '+linked['builtAt']+'. Refresh and review linked files separately; the toolkit crawler does not silently replace that snapshot.','Kuali account contents and access-request forms are operational destinations. The external NCES classification search remains a reference link.','Historical, incomplete and conflicting source material may need staff clarification. The tracker is a dated snapshot, not live Kuali status.']}
    (ROOT/'data/coverage.json').write_text(json.dumps(coverage,ensure_ascii=False,indent=2))
    print(json.dumps({'sources':len(sources),'passages':len(passages),'failures':len(failures),'external':len(external)}),flush=True)

if __name__=='__main__': main()
