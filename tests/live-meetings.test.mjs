import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {isLiveMeetingQuestion,getLiveMeetingEvidence,liveMeetingFallback,parseMeetingRows,safeLiveURL,easternDate,MEETINGS_URL} from '../backend/live-meetings.js';
import {pdfAttachment} from '../backend/live-document.js';

const ask=q=>[{role:'user',content:q}];
const now=new Date('2026-10-07T16:00:00Z');
function schedule({agenda='',date='October 15, 2026',old=true}={}){
  return `<html><title>Senate Meetings – Faculty Senate</title><main><h1>Senate Meetings</h1><p>Faculty Senate meetings are scheduled monthly from 3:00 – 5:00PM during the academic year.</p><p>Meetings are hybrid with a Zoom remote option and the in-person portion held in the Hope Room of the Higgins Welcome Center.</p><a href="https://uri-edu.zoom.us/old">9/17 meeting link</a><table><tr><th>Meeting</th><th>Location</th><th>Agenda</th><th>Minutes</th></tr>${old?'<tr><td>September 17, 2026 Meeting*</td><td>Hope Room</td><td><a href="https://drive.google.com/file/d/old-agenda/view">Agenda</a></td><td>Minutes</td></tr>':''}<tr><td>${date} Meeting</td><td>Hope Room, Higgins Welcome Center</td><td>${agenda?`<a href="${agenda}">Agenda</a>`:'Agenda'}</td><td>Minutes</td></tr><tr><td>November 19, 2026 Meeting</td><td>Hope Room</td><td>Agenda</td><td>Minutes</td></tr></table><p>Faculty Senators and the URI Community will receive an invitation with agenda at least 72 hours in advance of each Senate Meeting.</p></main></html>`;
}
function makeFetcher(html,documents={},calls=[]){return async(url,options)=>{calls.push({url,options});if(url===MEETINGS_URL)return new Response(html,{headers:{'Content-Type':'text/html'}});const doc=documents[url];if(doc instanceof Error)throw doc;if(doc instanceof Response)return doc.clone();if(doc)return new Response(doc,{headers:{'Content-Type':'text/plain'}});return new Response('Unavailable',{status:404});};}
const docURL='https://docs.google.com/document/d/new-agenda/edit';
const exportURL='https://docs.google.com/document/d/new-agenda/export?format=txt';
const agendaText='FACULTY SENATE MEETING AGENDA\nThursday, October 15, 2026\n3:00–5:00 PM, Hope Room.\n1. Call to order.\n2. Report of the University President.\n3. Curriculum and Standards Committee: Bill 26-27-02B, new minor in Sustainable Communities.\n4. New business.';

test('live intent recognizes current meeting questions and preserves an agenda follow-up',()=>{
  for(const q of ['When is the next Faculty Senate meeting?','What is on the next agenda?','Is the latest Faculty Senate agenda available?','When is the Faculty Senate meeting?','What will be considered at the upcoming Faculty Senate meeting?','Will bill 2026-2027-08C be on the next Faculty Senate agenda?','Will CASC 26-27-02B be on the next Faculty Senate agenda?','What Graduate Council reports are on the next Faculty Senate agenda?','What is on the next Faculty Senate meeting agenda in 2026?'])assert.equal(isLiveMeetingQuestion(ask(q),now),true,q);
  const messages=[...ask('When is the next Faculty Senate meeting?'),{role:'assistant',content:'October 15.'},{role:'user',content:'What will be considered?'}];
  assert.equal(isLiveMeetingQuestion(messages),true);
  messages[2].content='Where will it be?';assert.equal(isLiveMeetingQuestion(messages),true);
});
test('historic bills, committee meetings, and agenda procedures stay with indexed retrieval',()=>{
  for(const q of ['What is the bill number for the AI degree?','What was on the October 2025 Faculty Senate agenda?','When is the next Graduate Council meeting?','What is the next CASC agenda?','How often does Faculty Senate meet?','What is the agenda posting policy?'])assert.equal(isLiveMeetingQuestion(ask(q)),false,q);
  assert.equal(isLiveMeetingQuestion([...ask('When is the next Graduate Council meeting?'),{role:'user',content:'What is on its agenda?'}]),false);
  assert.equal(isLiveMeetingQuestion([...ask('What happened at the October 2025 Faculty Senate meeting?'),{role:'user',content:'What was on its agenda?'}]),false);
});
test('Eastern local day determines the next meeting across a UTC date boundary',async()=>{
  assert.deepEqual(easternDate(new Date('2026-10-16T00:15:00Z')),{date:'2026-10-15',minutes:1215});
  const fetcher=makeFetcher(schedule());
  const before=await getLiveMeetingEvidence(ask('Next meeting?'),{fetcher,now:new Date('2026-10-15T20:30:00Z')});
  assert.equal(before.nextMeeting.date,'2026-10-15');
  const after=await getLiveMeetingEvidence(ask('Next meeting?'),{fetcher,now:new Date('2026-10-16T00:15:00Z')});
  assert.equal(after.nextMeeting.date,'2026-11-19');
});
test('future row without agenda does not reuse the old agenda or Zoom link',async()=>{
  const calls=[],result=await getLiveMeetingEvidence(ask('What is on the next meeting agenda?'),{fetcher:makeFetcher(schedule(),{},calls),now});
  assert.equal(result.status,'agenda-not-posted');assert.equal(result.nextMeeting.date,'2026-10-15');assert.equal(result.checkedAt,now.toISOString());assert.equal(calls.length,1);
  assert.doesNotMatch(result.evidence[0].p.text,/old-agenda|9\/17 meeting link|uri-edu.zoom/);
  assert.match(result.evidence[0].p.text,/72 hours/);
  assert.match(liveMeetingFallback(result).answer,/does not yet contain a public link/);
});
test('agenda published after the first question is read on the very next question',async()=>{
  let linked=false;const calls=[];
  const fetcher=async(url,opts)=>makeFetcher(schedule({agenda:linked?docURL:''}),{[exportURL]:agendaText},calls)(url,opts);
  const first=await getLiveMeetingEvidence(ask('What is on the next agenda?'),{fetcher,now});
  assert.equal(first.status,'agenda-not-posted');linked=true;
  const second=await getLiveMeetingEvidence(ask('What is on the next agenda?'),{fetcher,now:new Date('2026-10-07T16:01:00Z')});
  assert.equal(second.status,'agenda-read');assert.equal(second.evidence[1].p.source,docURL);assert.match(second.evidence[1].p.text,/Sustainable Communities/);assert.equal(second.checkedAt,'2026-10-07T16:01:00.000Z');
  assert.equal(calls.filter(c=>c.url===MEETINGS_URL).length,2);
});
test('Google redirect wrapper is unwrapped to the actual cited agenda',async()=>{
  const wrapper='https://www.google.com/url?q='+encodeURIComponent(docURL)+'&sa=D';
  const result=await getLiveMeetingEvidence(ask('Next agenda?'),{fetcher:makeFetcher(schedule({agenda:wrapper}),{[exportURL]:agendaText}),now});
  assert.equal(result.status,'agenda-read');assert.equal(result.evidence[1].source.url,docURL);
});
test('latest agenda selects the posted row, while next meeting selects the future row',async()=>{
  const old='https://drive.google.com/uc?export=download&id=old-agenda',oldText=agendaText.replace('October 15, 2026','September 17, 2026');
  const fetcher=makeFetcher(schedule(),{[old]:oldText});
  const latest=await getLiveMeetingEvidence(ask('What is on the latest Faculty Senate agenda?'),{fetcher,now});
  assert.equal(latest.nextMeeting.date,'2026-09-17');assert.equal(latest.status,'agenda-read');
  const next=await getLiveMeetingEvidence(ask('When is the next Faculty Senate meeting?'),{fetcher,now});
  assert.equal(next.nextMeeting.date,'2026-10-15');
});
test('last meeting agenda uses a past meeting even when a future agenda is posted',async()=>{
  const old='https://drive.google.com/uc?export=download&id=old-agenda',oldText=agendaText.replace('October 15, 2026','September 17, 2026');
  const fetcher=makeFetcher(schedule({agenda:docURL}),{[old]:oldText,[exportURL]:agendaText});
  const latest=await getLiveMeetingEvidence(ask('What was on the last Faculty Senate meeting agenda?'),{fetcher,now});
  assert.equal(latest.nextMeeting.date,'2026-09-17');assert.equal(latest.status,'agenda-read');
  const future=await getLiveMeetingEvidence(ask('What is on the latest Faculty Senate agenda?'),{fetcher,now});
  assert.equal(future.nextMeeting.date,'2026-10-15');
});
test('an unavailable linked agenda retains verified date but never claims its contents',async()=>{
  const result=await getLiveMeetingEvidence(ask('What is on the next agenda?'),{fetcher:makeFetcher(schedule({agenda:docURL})),now});
  assert.equal(result.status,'agenda-unavailable');assert.equal(result.evidence.length,1);assert.equal(result.nextMeeting.date,'2026-10-15');assert.match(liveMeetingFallback(result).answer,/couldn’t read the linked agenda/);
});
test('a mislabeled past agenda is identified without passing it as current evidence',async()=>{
  const result=await getLiveMeetingEvidence(ask('What is on the next agenda?'),{fetcher:makeFetcher(schedule({agenda:docURL}),{[exportURL]:agendaText.replace('October 15, 2026','September 17, 2026')}),now});
  assert.equal(result.status,'agenda-date-mismatch');assert.equal(result.evidence.length,1);assert.match(result.issues[0].message,/September 17, 2026/);assert.match(liveMeetingFallback(result).answer,/different meeting date/);
});
test('unsafe agenda URLs and redirects are refused without requesting their destination',async()=>{
  for(const url of ['http://web.uri.edu/facsen/','https://user:secret@web.uri.edu/facsen/','https://web.uri.edu:8080/facsen/','https://web.uri.edu.evil.example/facsen/','https://127.0.0.1/facsen/','https://docs.google.com/spreadsheets/d/foo/edit','https://accounts.google.com/signin','javascript:alert(1)'])assert.equal(safeLiveURL(url),null,url);
  const calls=[],fetcher=makeFetcher(schedule({agenda:docURL}),{[exportURL]:new Response('',{status:302,headers:{Location:'https://evil.example/agenda'}})},calls);
  const result=await getLiveMeetingEvidence(ask('Next agenda?'),{fetcher,now});
  assert.equal(result.status,'agenda-unavailable');assert.equal(calls.length,2);assert.doesNotMatch(JSON.stringify(calls),/evil/);
});
test('schedule failure has an attempted time but no successful checked time',async()=>{
  const result=await getLiveMeetingEvidence(ask('Next meeting?'),{fetcher:async()=>new Response('Unavailable',{status:503}),now});
  assert.equal(result.status,'source-unavailable');assert.equal(result.checkedAt,null);assert.equal(result.attemptedAt,now.toISOString());assert.equal(result.evidence.length,0);assert.equal(liveMeetingFallback(result).kind,'unanswered');
});
test('login pages and sources exceeding the reading limit do not become agenda evidence',async()=>{
  for(const doc of [new Response('Sign in to Google to request access to this document',{headers:{'Content-Type':'text/html'}}),new Response('x',{headers:{'Content-Length':'5000000','Content-Type':'application/pdf'}})]){
    const result=await getLiveMeetingEvidence(ask('Next agenda?'),{fetcher:makeFetcher(schedule({agenda:docURL}),{[exportURL]:doc}),now});
    assert.equal(result.status,'agenda-unavailable');assert.equal(result.evidence.length,1);
  }
});
test('invalid dates and orientation are not silently selected as Senate meetings',async()=>{
  assert.equal(parseMeetingRows(schedule({date:'February 30, 2027',old:false})).some(r=>r.date==='2027-03-02'),false);
  const html=schedule({date:'Senate Orientation: October 8, 2026'}),result=await getLiveMeetingEvidence(ask('Next meeting?'),{fetcher:makeFetcher(html),now});
  assert.equal(result.nextMeeting.date,'2026-11-19');
  const cancelled=schedule().replace('October 15, 2026 Meeting','October 15, 2026 Meeting — Cancelled');
  assert.equal((await getLiveMeetingEvidence(ask('Next meeting?'),{fetcher:makeFetcher(cancelled),now})).nextMeeting.date,'2026-11-19');
});

function tinyPDF(lines,{compressed=true}={}){
  const escaped=lines.map(s=>'('+s.replace(/[\\()]/g,'\\$&')+') Tj T*').join('\n'),stream=Buffer.from('BT /F1 12 Tf 14 TL 50 750 Td\n'+escaped+'\nET'),data=compressed?deflateSync(stream):stream;
  const objects=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'),Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),Buffer.concat([Buffer.from(`<< /Length ${data.length}${compressed?' /Filter /FlateDecode':''} >>\nstream\n`),data,Buffer.from('\nendstream')])];
  let body=Buffer.from('%PDF-1.4\n'),offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(body.length);body=Buffer.concat([body,Buffer.from(`${i+1} 0 obj\n`),objects[i],Buffer.from('\nendobj\n')]);}
  const xref=body.length;return new Uint8Array(Buffer.concat([body,Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)]));
}
test('live Google Drive PDF is attached with exact fetched bytes and verified provenance',async()=>{
  const pdf=tinyPDF(['FACULTY SENATE MEETING AGENDA','October 15, 2026','1. Call to order.','2. Bill 26-27-02B: New minor in Sustainable Communities.']);
  const pdfURL='https://drive.google.com/file/d/new-pdf/view',download='https://drive.google.com/uc?export=download&id=new-pdf';
  const calls=[],result=await getLiveMeetingEvidence(ask('Next agenda?'),{fetcher:makeFetcher(schedule({agenda:pdfURL}),{[download]:new Response(pdf,{headers:{'Content-Type':'application/pdf'}})},calls),now});
  assert.equal(result.status,'agenda-attached');assert.equal(result.evidence[1].source.url,pdfURL);assert.equal(calls.length,2);assert.equal(result.attachments.length,1);
  const attachment=result.attachments[0];assert.equal(attachment.sourceId,2);assert.equal(attachment.sourceUrl,pdfURL);assert.equal(attachment.filename,'faculty-senate-agenda-2026-10-15.pdf');assert.match(attachment.fileData,/^data:application\/pdf;base64,/);
  assert.deepEqual(new Uint8Array(Buffer.from(attachment.fileData.split(',')[1],'base64')),pdf);
  assert.match(result.evidence[1].p.text,/not a transcription/);assert.match(result.evidence[1].p.text,/Verify the meeting date/);assert.doesNotMatch(result.evidence[1].p.text,/Sustainable Communities/);
  const fallback=liveMeetingFallback(result);assert.match(fallback.answer,/couldn’t complete a verified reading/);assert.doesNotMatch(JSON.stringify(fallback),/fileData|base64/);
});
test('incomplete PDFs fail and valid image-only PDFs can use the model document reader',()=>{
  assert.throws(()=>pdfAttachment(new TextEncoder().encode('%PDF-1.4 invalid')),/PDF/i);
  const empty=tinyPDF([]),attachment=pdfAttachment(empty,{sourceUrl:docURL,sourceId:2});
  assert.equal(attachment.mediaType,'application/pdf');assert.deepEqual(new Uint8Array(Buffer.from(attachment.fileData.split(',')[1],'base64')),empty);
});
