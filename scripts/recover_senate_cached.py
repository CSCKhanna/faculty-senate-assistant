"""Merge recovered page OCR and bound extraction of image-only documents.
Keep all existing readable text; a difficult image cannot erase a whole source.
"""
import concurrent.futures as cf,hashlib,io,json,pathlib,re,subprocess,sys
import crawl_senate as c

def target(url):
 m=re.search(r'/(document|spreadsheets|presentation|file)/d/([^/?#]+)',url)
 if not m:return url
 typ,ident=m.groups()
 return 'https://drive.google.com/uc?export=download&id='+ident if typ=='file' else 'https://docs.google.com/'+typ+'/d/'+ident+'/export?format='+('pdf' if typ=='presentation' else 'txt' if typ=='document' else 'xlsx')
def attach_cached(item):
 if item['kind']!='Faculty Senate PDF':return item
 raw,_=c.cached(target(item['url']));sha=hashlib.sha256(raw).hexdigest();pages=set(item.get('ocrPages',[]))
 for i,line in enumerate(item['lines']):
  if i%2!=1:continue
  n=i//2+1;cache=c.CACHE/(sha+'-'+str(n)+'-ocr.json')
  if cache.exists():
   rows=json.loads(cache.read_text())
   if rows and len(c.core.clean(line))<100:item['lines'][i]='\n'.join(rows);pages.add(n)
 item['ocrPages']=sorted(pages);return item

def one_gap(g):
 out=c.CACHE/(hashlib.sha256(g['url'].encode()).hexdigest()+'-recovered.json')
 code="import sys,json,os;os.environ['SENATE_OCR']='1';sys.path.insert(0,'scripts');import crawl_senate as c;item,_=c.read(sys.argv[1],'Recovered Senate document');open(sys.argv[2],'w').write(json.dumps(item,ensure_ascii=False))"
 try:
  subprocess.run([sys.executable,'-c',code,g['url'],str(out)],check=True,timeout=120,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  return json.loads(out.read_text()),None
 except subprocess.TimeoutExpired:return None,{'url':g['url'],'reason':'Image-only PDF extraction exceeded the document time limit; requires a text-accessible copy.'}
 except Exception:return None,g

def main():
 path=c.ROOT/'data/senate-text.json';s=json.loads(path.read_text());items={x['url']:x for x in s['items']}
 with cf.ThreadPoolExecutor(max_workers=8) as pool:
  for item in pool.map(attach_cached,s['items']):items[item['url']]=item
 recover=[g for g in s['gaps'] if re.search('Scanned PDF|NameObject|Unsupported document format: application/pdf',g['reason'])];gaps=[g for g in s['gaps'] if g not in recover]
 with cf.ThreadPoolExecutor(max_workers=4) as pool:
  for item,gap in pool.map(one_gap,recover):
   if item:items[item['url']]=item;print('Recovered',item['url'],flush=True)
   if gap:gaps.append(gap);print('Remaining gap',gap['url'],flush=True)
 # Column labels and identities come from fresh, cached spreadsheet exports.
 raw,_=c.cached('https://web.uri.edu/facsen/archived-proposal-trackers/');p=c.Links();p.feed(raw.decode());titles={c.normalize(u):t+' Curriculum Proposal Tracker' for u,t in p.links if c.normalize(u) and 'spreadsheets/d/' in c.normalize(u)}
 for x in json.loads((c.ROOT/'data/toolkit-linked-text.json').read_text())['items']:
  if 'tracker' in x['title'].lower():titles[c.normalize(x['url'])]=x['title']
 for u,x in list(items.items()):
  if x.get('tabs'):
   item,_=c.read(u,titles.get(u,x['title']));item['kind']='Faculty Senate proposal tracker' if u in titles else 'Faculty Senate spreadsheet';items[u]=item
 s.update(items=list(items.values()),gaps=gaps,trackers=[{'url':u,'title':items[u]['title'],'tabs':items[u]['tabs'],'rows':items[u]['rowCount']} for u in titles if u in items]);path.write_text(json.dumps(s,ensure_ascii=False))
 print(json.dumps({'sources':len(items),'gaps':len(gaps),'ocrDocuments':sum(bool(x.get('ocrPages')) for x in items.values()),'ocrPages':sum(len(x.get('ocrPages',[])) for x in items.values()),'trackers':len(s['trackers'])}))
if __name__=='__main__':main()
