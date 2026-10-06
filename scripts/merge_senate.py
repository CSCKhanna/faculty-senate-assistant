"""Merge the auditable Senate snapshot without dropping reviewed toolkit content."""
import json,re
import build_index as core

def ocr_spacing(line):
 # Restore whitespace only; never change OCR letters, digits or punctuation.
 if '@' in line or 'http' in line:return line
 import wordninja
 line=re.sub(r'(?<=[a-z])(?=[A-Z])',' ',line)
 def split(m):
  word=m.group();parts=wordninja.split(word.lower())
  if ''.join(parts)!=word.lower():return word
  at=0;out=[]
  for part in parts:out.append(word[at:at+len(part)]);at+=len(part)
  return ' '.join(out)
 return re.sub(r'[A-Za-z]{10,}',split,line)

def apply_snapshot(snapshot,indexer=core):
 urls={item['url'] for item in snapshot['items']}
 indexer.passages[:]=[p for p in indexer.passages if p['source'] not in urls]
 for url in urls:indexer.sources.pop(url,None)
 for item in snapshot['items']:
  lines=[ocr_spacing(line) if i%2==1 and i//2+1 in item.get('ocrPages',[]) else line for i,line in enumerate(item['lines'])]
  indexer.add_source(item['url'],item['title'],item['kind'],[item['title']]+lines)
  s=indexer.sources[item['url']];s['fetchedAt']=item['fetchedAt']
  if item.get('tabs'):s['tabs']=item['tabs'];s['rowCount']=item['rowCount']
  if item['kind']=='Faculty Senate proposal tracker':s['notice']='Dated public tracker snapshot. Rows describe the recorded proposal status, not live Kuali status or an approval guarantee. Check the academic year and sheet.'
  elif item['kind']=='Faculty Senate PDF':s['notice']='Check the document and meeting date. Reports and proposed legislation do not automatically establish current policy. Text extraction may omit graphical content or checked approval options.'
  if item.get('ocrPages'):s['notice']+=' Text includes OCR; verify dates, numbers, tables and signatures in the original.'
  s['ocrPages']=item.get('ocrPages',[])
 imagecount=0;media_path=indexer.ROOT/'data/senate-media-text.json'
 if media_path.exists():
  media=json.loads(media_path.read_text());imagecount=len(media['items'])
  for image in media['items']:
   indexer.passages[:]=[p for p in indexer.passages if p['source']!=image['url']]
   indexer.add_source(image['url'],image['title'],image['kind'],[ocr_spacing(line) for line in image['lines']])
   indexer.sources[image['url']]['fetchedAt']=image['fetchedAt'];indexer.sources[image['url']]['notice']='Website image OCR: verify small text, diagram arrows, dates and interface labels in the original.'
   if indexer.sources.get(image['parent'],{}).get('notice'):indexer.sources[image['url']]['notice']+=' Its parent page includes a development or outdated-content notice.'
  snapshot={**snapshot,'gaps':snapshot['gaps']+media['gaps']+media['videos']}
 return {'builtAt':snapshot['builtAt'],'publishedPages':len(snapshot['publishedPages']),'publishedPagesIndexed':sum(u in indexer.sources for u in snapshot['publishedPages']),'attemptedSources':snapshot['attemptedSources'],'indexedSources':len(snapshot['items']),'instructionalImages':imagecount,'trackers':snapshot['trackers'],'gaps':snapshot['gaps']}

def main():
 old=json.loads((core.ROOT/'data/index.json').read_text());cov=json.loads((core.ROOT/'data/coverage.json').read_text());snap=json.loads((core.ROOT/'data/senate-text.json').read_text())
 core.sources.update({s['url']:s for s in old['sources']});core.passages.extend(old['passages'])
 cov['website']=apply_snapshot(snap)
 data={'builtAt':core.STAMP,'sources':list(core.sources.values()),'passages':core.passages}
 cov.update(builtAt=core.STAMP,sourceCount=len(core.sources),passageCount=len(core.passages))
 cov['limitations']=[x for x in cov['limitations'] if not x.startswith('Faculty Senate website snapshot')]+['Faculty Senate website snapshot: every publicly published page/post was audited, including linked reports, minutes, legislation, University Manual pages and all publicly downloadable proposal-tracker tabs. Restricted, broken and unreadable links are listed as gaps; their contents are not available to the assistant.','PDF extraction includes embedded text and recovered OCR; diagrams, charts, handwriting and signatures need original visual review.','Trackers are dated snapshots. Historical records and proposed legislation must not be treated as current policy or live approval status.']
 cov['limitations']=list(dict.fromkeys(cov['limitations']))
 (core.ROOT/'data/index.json').write_text(json.dumps(data,ensure_ascii=False))
 (core.ROOT/'data/coverage.json').write_text(json.dumps(cov,ensure_ascii=False,indent=2))
 print(json.dumps({'sources':len(core.sources),'passages':len(core.passages),'website':{k:v for k,v in cov['website'].items() if k not in ('trackers','gaps')},'trackers':len(cov['website']['trackers']),'gaps':len(cov['website']['gaps'])}))
if __name__=='__main__':main()
