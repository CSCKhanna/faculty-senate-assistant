"""Extract public instructional website images; keep headshots/decorative photos out."""
import json,hashlib,re,urllib.parse as up,datetime as dt
from html.parser import HTMLParser
import crawl_senate as c
class Images(HTMLParser):
 def __init__(self):super().__init__();self.images=[];self.videos=[];self.depth=0;self.start=None;self.skip=0
 def handle_starttag(self,t,attrs):
  a=dict(attrs)
  if t not in ('img','br','hr','input','meta','link','source','wbr','area','embed','param'):self.depth+=1
  if self.start is None and (t=='main' or 'entry-content' in a.get('class','').split()):self.start=self.depth
  if t in ('script','style','nav','footer'):self.skip+=1
  if self.start is None or self.skip:return
  if t=='img' and a.get('src'):self.images.append(a['src'])
  if 'vimeo.com' in a.get('data-video',''):self.videos.append(a['data-video'])
  if t=='a' and 'vimeo.com' in a.get('href',''):self.videos.append(a['href'])
 def handle_endtag(self,t):
  if t in ('img','br','hr','input','meta','link','source','wbr','area','embed','param'):return
  if self.start==self.depth:self.start=None
  if t in ('script','style','nav','footer'):self.skip=max(0,self.skip-1)
  self.depth=max(0,self.depth-1)
def main():
 snapshot=json.loads((c.ROOT/'data/senate-text.json').read_text())
 if not snapshot.get('publishedPages') or not any(x['url']==c.core.SENATE for x in snapshot['items']):raise ValueError('No freshly crawled public Senate page inventory for image extraction')
 previous_path=c.ROOT/'data/senate-media-text.json'
 previous=json.loads(previous_path.read_text()) if previous_path.exists() else {'items':[]}
 items=[];gaps=[];videos=[];engine=None;failed_parents=set();seen_images=set();references={};image_failures={}
 pages=[x for x in snapshot['items'] if x['kind']=='Faculty Senate website' and up.urlsplit(x['url']).netloc=='web.uri.edu' and up.urlsplit(x['url']).path.startswith('/facsen/')]
 if not snapshot.get('discovery',{}).get('complete'):
  gaps.append({'url':c.core.SENATE,'reason':'Website image refresh incomplete; published page discovery was incomplete.'})
 readable={x['url'] for x in pages}
 failed_parents.update(x['parent'] for x in previous['items'] if x['parent'] not in readable)
 for page in pages:
  parent=page['url'];p=Images()
  try:
   # Reuse the exact freshly downloaded HTML from the source crawl. This avoids
   # a second REST dependency and retains the page's actual image inventory.
   key=hashlib.sha256(parent.encode()).hexdigest();meta_path=c.CACHE/(key+'.json');raw_path=c.CACHE/(key+'.bin')
   meta=json.loads(meta_path.read_text()) if meta_path.exists() else {}
   if raw_path.exists() and meta.get('fetchedAt')==page['fetchedAt']:raw=raw_path.read_bytes()
   else:raw,_=c.cached(parent)
   p.feed(raw.decode('utf-8','replace'))
  except Exception as e:
   failed_parents.add(parent);gaps.append({'url':parent,'reason':'Website image refresh incomplete; page HTML unavailable: '+str(e)[:120]});continue
  references[parent]=set()
  for u in p.images:
   u=c.normalize(u,parent)
   if u and up.urlsplit(u).netloc=='web.uri.edu' and '/wp-content/themes/' not in u and '/wp-content/plugins/' not in u:
    references[parent].add(up.quote(u,safe=':/?#&%='))
  videos.extend({'url':u,'page':parent,'reason':'Instructional video: no transcript imported; use the original video.'} for u in p.videos)
  if parent==c.core.SENATE or any(x in parent for x in ('/people/','/committees/')):continue
  for u in p.images:
   u=c.normalize(u,parent)
   if not u or up.urlsplit(u).netloc!='web.uri.edu':continue
   if '/wp-content/themes/' in u or '/wp-content/plugins/' in u or u in seen_images:continue
   seen_images.add(u)
   u=up.quote(u,safe=':/?#&%=');key=hashlib.sha256(u.encode()).hexdigest()
   try:
    raw,_=c.cached(u);file=c.CACHE/(key+'-image.png');file.write_bytes(raw);out=c.CACHE/(hashlib.sha256(raw).hexdigest()+'-image-ocr.json')
    if out.exists():lines=json.loads(out.read_text())
    else:
     if engine is None:
      from rapidocr_onnxruntime import RapidOCR
      engine=RapidOCR(intra_op_num_threads=4,inter_op_num_threads=1)
     result,_=engine(str(file));lines=[row[1] for row in result or []];out.write_text(json.dumps(lines))
    lines=[line for line in lines if isinstance(line,str) and line.strip()]
    if lines:
     items.append({'url':u,'parent':parent,'title':page['title']+' — '+up.unquote(up.urlsplit(u).path.rsplit('/',1)[-1]),'kind':'Faculty Senate website image','lines':lines,'fetchedAt':json.loads((c.CACHE/(key+'.json')).read_text())['fetchedAt']});print('Image indexed',u,flush=True)
    else:image_failures[u]='Website image refresh incomplete; the current image has no detected readable text. Earlier extracted text is retained for review.'
   except Exception as e:
    image_failures[u]='Website image refresh incomplete; '+str(e)[:140]
    gaps.append({'url':u,'reason':image_failures[u]})
 for image in previous['items']:
  if any(x['url']==image['url'] for x in items):continue
  reason=image_failures.get(image['url'])
  if image['parent'] in failed_parents:
   reason='Website image refresh incomplete; its parent page is missing from the freshly readable snapshot. Earlier extracted text is retained for review.'
  elif image['parent'] in references and image['url'] not in references[image['parent']]:
   reason='Website image refresh incomplete; the current parent page no longer references this image. Earlier extracted text is retained for review.'
  if reason:
   items.append(image)
   if not any(g['url']==image['url'] for g in gaps):gaps.append({'url':image['url'],'reason':reason})
 result={'builtAt':c.STAMP,'items':items,'gaps':gaps,'videos':videos};(c.ROOT/'data/senate-media-text.json').write_text(json.dumps(result,ensure_ascii=False));print(json.dumps({'images':len(items),'gaps':len(gaps),'videos':len(videos)}))
if __name__=='__main__':main()
