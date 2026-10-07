"""Extract public instructional website images; keep headshots/decorative photos out."""
import json,hashlib,re,urllib.parse as up,datetime as dt
from html.parser import HTMLParser
import crawl_senate as c
class Images(HTMLParser):
 def __init__(self):super().__init__();self.images=[];self.videos=[]
 def handle_starttag(self,t,attrs):
  a=dict(attrs)
  if t=='img' and a.get('src'):self.images.append(a['src'])
  if 'vimeo.com' in a.get('data-video',''):self.videos.append(a['data-video'])
  if t=='a' and 'vimeo.com' in a.get('href',''):self.videos.append(a['href'])
def main():
 pages=[]
 for endpoint in ('pages','posts'):
  n=1
  while True:
   raw,_=c.cached(c.core.SENATE+'wp-json/wp/v2/'+endpoint+'?per_page=100&page='+str(n));a=json.loads(raw);pages+=a
   if len(a)<100:break
   n+=1
 items=[];gaps=[];videos=[];engine=None
 for page in pages:
  p=Images();p.feed(page['content']['rendered']);parent=c.normalize(page['link'])
  videos.extend({'url':u,'page':parent,'reason':'Instructional video: no transcript imported; use the original video.'} for u in p.videos)
  if parent==c.core.SENATE or any(x in parent for x in ('/people/','/committees/')):continue
  for u in p.images:
   if up.urlsplit(u).netloc!='web.uri.edu':continue
   u=up.quote(u,safe=':/?#&%=');key=hashlib.sha256(u.encode()).hexdigest()
   try:
    raw,_=c.cached(u);file=c.CACHE/(key+'-image.png');file.write_bytes(raw);out=c.CACHE/(hashlib.sha256(raw).hexdigest()+'-image-ocr.json')
    if out.exists():lines=json.loads(out.read_text())
    else:
     if engine is None:
      from rapidocr_onnxruntime import RapidOCR
      engine=RapidOCR(intra_op_num_threads=4,inter_op_num_threads=1)
     result,_=engine(str(file));lines=[row[1] for row in result or []];out.write_text(json.dumps(lines))
    if lines:
     items.append({'url':u,'parent':parent,'title':re.sub('<[^>]+>','',page['title']['rendered'])+' — '+up.unquote(up.urlsplit(u).path.rsplit('/',1)[-1]),'kind':'Faculty Senate website image','lines':lines,'fetchedAt':dt.datetime.fromtimestamp((c.CACHE/(key+'.bin')).stat().st_mtime,dt.timezone.utc).isoformat()});print('Image indexed',u,flush=True)
   except Exception as e:gaps.append({'url':u,'reason':str(e)[:180]})
 result={'builtAt':c.STAMP,'items':items,'gaps':gaps,'videos':videos};(c.ROOT/'data/senate-media-text.json').write_text(json.dumps(result,ensure_ascii=False));print(json.dumps({'images':len(items),'gaps':len(gaps),'videos':len(videos)}))
if __name__=='__main__':main()
