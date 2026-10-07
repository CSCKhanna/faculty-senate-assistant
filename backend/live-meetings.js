import {decodeEntities,htmlToText,htmlLinks,mainContent,pdfAttachment} from './live-document.js';

export const MEETINGS_URL='https://web.uri.edu/facsen/meetings/';
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
const DATE_PATTERN=/\b(January|February|March|April|May|June|July|August|September|Sept\.?|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Oct\.?|Nov\.?|Dec\.?)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s+(20\d{2})\b/i;
const OTHER_COMMITTEE=/\b(?:graduate council|CASC|GEC|FSEC|executive committee|curriculum and standards|general education committee|student senate|calendar committee)\b/i;
const HISTORIC=/\b(?:19|20)\d{2}\b|\b(?:last|previous) (?:academic|school) year\b|\b(?:historical|archived)\b/i;
const LIVE=/\b(?:next|upcoming|current|latest|today|tomorrow|this (?:week|month)|last|most recent)\b/i;
const MEETING=/\b(?:meetings?|agenda)\b/i;
function removeBillDates(text){return text.replace(/\b(?:bill\s*#?\s*)?(?:20\d{2}|\d{2})\s*[-–]\s*(?:20\d{2}|\d{2})\s*[-–]\s*(?:[A-Z]+\s*[-–]\s*)?\d{1,3}[A-Z]?\b/gi,'');}
function historicQuestion(text){return HISTORIC.test(removeBillDates(text));}
const MONTH_YEAR_PATTERN=/\b(January|February|March|April|May|June|July|August|September|Sept\.?|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Oct\.?|Nov\.?|Dec\.?)\s+(20\d{2})\b/i;
function shiftCalendarDay(date,days){
  const day=new Date(date+'T00:00:00Z');day.setUTCDate(day.getUTCDate()+days);return day.toISOString().slice(0,10);
}
function calendarLabel(date){const [year,month,day]=date.split('-').map(Number);return `${MONTHS[month-1][0].toUpperCase()+MONTHS[month-1].slice(1)} ${day}, ${year}`;}
function requestedPeriod(text,now){
  const clean=removeBillDates(text),writtenDate=clean.match(DATE_PATTERN);
  if(writtenDate){const date=parseMeetingDate(writtenDate[0]);return date?{type:'date',...date}:{type:'invalid-date',label:writtenDate[0]};}
  const academic=clean.match(/\b(20\d{2})\s*[-–—]\s*(20\d{2}|\d{2})\s+(?:academic|school)\s+year\b/i)
    ||clean.match(/\b(?:academic|school)\s+year\s*:?\s*(20\d{2})\s*[-–—]\s*(20\d{2}|\d{2})\b/i)
    ||clean.match(/\bAY\s*(20\d{2})\s*[-–—]\s*(20\d{2}|\d{2})\b/i);
  if(academic){
    const start=Number(academic[1]),end=academic[2].length===2?Math.floor(start/100)*100+Number(academic[2]):Number(academic[2]),label=`${start}–${end} academic year`;
    // Keep the same July–June year classification as conversation.academicYear.
    return end===start+1?{type:'academic-year',startDate:`${start}-07-01`,endDate:`${end}-06-30`,label}:{type:'invalid-period',label};
  }
  const month=clean.match(MONTH_YEAR_PATTERN);
  if(month){const index=MONTHS.findIndex(s=>s.startsWith(month[1].toLowerCase().slice(0,3))),year=month[2];return {type:'month',month:`${year}-${String(index+1).padStart(2,'0')}`,label:`${MONTHS[index][0].toUpperCase()+MONTHS[index].slice(1)} ${year}`};}
  if(/\b(?:today|tomorrow|this week|this month)\b/i.test(clean)){
    const today=easternDate(now).date;
    if(/\b(?:today|tomorrow)\b/i.test(clean)){
      const relative=/\btomorrow\b/i.test(clean)?'tomorrow':'today',date=shiftCalendarDay(today,relative==='tomorrow'?1:0);
      return {type:'date',date,label:calendarLabel(date),relative};
    }
    if(/\bthis week\b/i.test(clean)){
      // US calendar week, Sunday–Saturday, derived from the Eastern local day.
      // UTC arithmetic on that day avoids daylight-saving hour changes.
      const weekday=new Date(today+'T00:00:00Z').getUTCDay(),startDate=shiftCalendarDay(today,-weekday),endDate=shiftCalendarDay(startDate,6);
      return {type:'week',startDate,endDate,label:`${calendarLabel(startDate)} through ${calendarLabel(endDate)}`,relative:'this-week'};
    }
    const month=today.slice(0,7),index=Number(month.slice(5))-1;
    return {type:'month',month,label:`${MONTHS[index][0].toUpperCase()+MONTHS[index].slice(1)} ${month.slice(0,4)}`,relative:'this-month'};
  }
  const year=clean.match(/\b(20\d{2})\b/);
  return year?{type:'year',year:year[1],label:year[1]}:null;
}
function requestedScope(messages,now){return requestedPeriod(latestQuestion(messages),now)||requestedPeriod(topicQuestion(messages),now);}
function matchesScope(row,scope){return !scope||scope.type==='date'&&row.date===scope.date||scope.type==='month'&&row.date.startsWith(scope.month+'-')||scope.type==='year'&&row.date.startsWith(scope.year+'-')||['academic-year','week'].includes(scope.type)&&row.date>=scope.startDate&&row.date<=scope.endDate;}

function latestQuestion(messages){return messages.filter(m=>m.role==='user').at(-1)?.content||'';}
function topicQuestion(messages){
  const latest=latestQuestion(messages);
  if(/\bfaculty senate\b/i.test(latest)||OTHER_COMMITTEE.test(latest))return latest;
  // A follow-up agenda/time/location query keeps the immediately preceding
  // committee/topic. A fully new nonmeeting question does not inherit it.
  if(MEETING.test(latest)||/\b(?:what time|where|when|what will|on it|be considered|will .*consider|posted|available)\b/i.test(latest)){
    const previous=messages.filter(m=>m.role==='user').slice(0,-1).reverse().find(m=>MEETING.test(m.content)||OTHER_COMMITTEE.test(m.content));
    if(previous)return previous.content+'\n'+latest;
  }
  return latest;
}
export function isLiveMeetingQuestion(messages,now=new Date()){
  const latest=latestQuestion(messages),topic=topicQuestion(messages);
  const today=easternDate(now).date,scope=requestedScope(messages,now),currentPeriod=scope&&(scope.type==='date'?scope.date>=today:scope.type==='month'?scope.month>=today.slice(0,7):scope.type==='year'?scope.year>=today.slice(0,4):['academic-year','week'].includes(scope.type)?scope.endDate>=today:false);
  const currentQuery=Boolean(currentPeriod)||/\b(?:next|upcoming|current)\b/i.test(latest)&&!scope;
  if(!latest||historicQuestion(latest)&&!currentQuery||historicQuestion(topic)&&!currentQuery&&!LIVE.test(latest))return false;
  if(OTHER_COMMITTEE.test(latest)&&!/\bfaculty senate\b/i.test(latest)||(!/\bfaculty senate\b/i.test(latest)&&OTHER_COMMITTEE.test(topic)))return false;
  if(!MEETING.test(topic))return false;
  if(/\b(?:policy|procedure|parliamentary|quorum|rules|how often|how (?:are|is).*(?:prepared|distributed|posted)|how (?:much|many) (?:notice|days)|notice (?:requirement|required))\b/i.test(latest)&&!LIVE.test(latest))return false;
  if(LIVE.test(topic)||currentPeriod)return true;
  return /\b(?:when|where|what time|what(?:'s| is) on|what will|what is the agenda|agenda (?:available|posted)|has .*agenda|is .*agenda)\b/i.test(latest);
}
function modeFor(messages){
  const latest=latestQuestion(messages),topic=topicQuestion(messages);
  const chosen=LIVE.test(latest)?latest:topic;
  return /\b(?:last|latest|most recent)\b/i.test(chosen)&&! /\b(?:next|upcoming)\b/i.test(chosen)?'latest':'upcoming';
}
export function easternDate(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const value=type=>parts.find(p=>p.type===type).value;
  return {date:`${value('year')}-${value('month')}-${value('day')}`,minutes:Number(value('hour'))*60+Number(value('minute'))};
}
export function parseMeetingDate(text){
  const m=String(text).match(DATE_PATTERN);if(!m)return null;
  const mon=m[1].toLowerCase().replace(/\./g,''),month=MONTHS.findIndex(s=>s.startsWith(mon.slice(0,3))),day=Number(m[2]),year=Number(m[3]);
  const d=new Date(Date.UTC(year,month,day));
  if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month||d.getUTCDate()!==day)return null;
  return {date:`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`,label:`${MONTHS[month][0].toUpperCase()+MONTHS[month].slice(1)} ${day}, ${year}`};
}

// URI sometimes publishes Google's /url wrapper. Unwrap it without making a
// Google request, then constrain every subsequent redirect too.
export function safeLiveURL(input,base=MEETINGS_URL){
  let u;try{u=new URL(decodeEntities(input),base);}catch{return null;}
  if(u.hostname==='www.google.com'&&u.pathname==='/url'){
    const target=u.searchParams.get('q')||u.searchParams.get('url');
    if(!target)return null;
    try{u=new URL(target);}catch{return null;}
  }
  if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
  const host=u.hostname,path=u.pathname;
  const allowed=host==='web.uri.edu'&&/^\/facsen\//.test(path)
    ||host==='docs.google.com'&&/^\/document\/d\/(?:e\/)?[a-zA-Z0-9_-]+(?:\/|$)/.test(path)
    ||host==='drive.google.com'&&(/^\/file\/d\/[a-zA-Z0-9_-]+(?:\/|$)/.test(path)||path==='/uc'&&/^[a-zA-Z0-9_-]+$/.test(u.searchParams.get('id')||''))
    ||host==='drive.usercontent.google.com'&&path==='/download'&&/^[a-zA-Z0-9_-]+$/.test(u.searchParams.get('id')||'')
    ||/^(?:[a-zA-Z0-9-]+\.)?googleusercontent\.com$/.test(host)&&/^\/(?:docs|download|doc|drive|[a-zA-Z0-9_-]+\/)/.test(path);
  if(!allowed)return null;
  u.hash='';return u.href;
}
function agendaRequestURL(url){
  const u=new URL(url),drive=u.pathname.match(/^\/file\/d\/([a-zA-Z0-9_-]+)/);
  if(u.hostname==='drive.google.com'&&drive)return `https://drive.google.com/uc?export=download&id=${drive[1]}`;
  const doc=u.pathname.match(/^\/document\/d\/([a-zA-Z0-9_-]+)/);
  if(u.hostname==='docs.google.com'&&doc&&doc[1]!=='e')return `https://docs.google.com/document/d/${doc[1]}/export?format=txt`;
  return url;
}
async function readBounded(response,maxBytes,signal){
  const declared=Number(response.headers.get('Content-Length'));
  if(declared>maxBytes)throw new Error('Source exceeds the live reading size limit.');
  const reader=response.body?.getReader();
  if(!reader){const data=new Uint8Array(await response.arrayBuffer());if(data.length>maxBytes)throw new Error('Source exceeds the live reading size limit.');return data;}
  const chunks=[];let length=0;
  try{while(true){if(signal.aborted)throw new Error('Source read timed out.');const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>maxBytes)throw new Error('Source exceeds the live reading size limit.');chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
async function fetchPublic(url,{fetcher,deadline,maxBytes=4000000}){
  const initial=safeLiveURL(url);if(!initial)throw new Error('Source URL is outside the live reading allowlist.');
  const ms=Math.min(6500,deadline-Date.now());if(ms<50)throw new Error('Live source check timed out.');
  const controller=new AbortController();let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Live source check timed out.'));},ms);});
  try{return await Promise.race([(async()=>{
    let next=initial;
    for(let hop=0;hop<4;hop++){
      const response=await fetcher(next,{redirect:'manual',signal:controller.signal,headers:{'Accept':'text/html,text/plain,application/pdf','Cache-Control':'no-cache'}});
      if([301,302,303,307,308].includes(response.status)){
        const location=response.headers.get('Location');response.body?.cancel().catch(()=>{});
        const target=location&&safeLiveURL(location,next);if(!target)throw new Error('Source redirected outside the live reading allowlist.');next=target;continue;
      }
      if(!response.ok)throw new Error(`Public source returned HTTP ${response.status}.`);
      if(response.url&&!safeLiveURL(response.url))throw new Error('Source redirected outside the live reading allowlist.');
      const bytes=await readBounded(response,maxBytes,controller.signal);
      return {bytes,type:response.headers.get('Content-Type')||'',url:next};
    }
    throw new Error('Source exceeded the redirect limit.');
  })(),timeout]);}finally{clearTimeout(timer);}
}

export function parseMeetingRows(html){
  const main=mainContent(html),rows=[];
  for(const row of main.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)){
    const cells=[...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)].map(m=>m[1]);
    if(!cells.length)continue;
    const first=htmlToText(cells[0]),date=parseMeetingDate(first);if(!date)continue;
    const agendaCell=cells.find(c=>/\bagenda\b/i.test(htmlToText(c))),agendaLink=agendaCell&&htmlLinks(agendaCell).find(a=>/\bagenda\b/i.test(a.text));
    const agendaURL=agendaLink&&safeLiveURL(agendaLink.href);
    rows.push({...date,rowText:cells.map(htmlToText).join(' | '),location:htmlToText(cells[1]||''),orientation:/orientation/i.test(first),cancelled:/\bcancel(?:l)?ed\b/i.test(cells.map(htmlToText).join(' ')),
      generalFaculty:/\*/.test(first),agendaURL:agendaURL||null,unsafeAgenda:Boolean(agendaLink&&!agendaURL)});
  }
  return rows.sort((a,b)=>a.date.localeCompare(b.date));
}
function pageEvidence(html,meeting,now,mode,rows,scope){
  const paragraphs=[...mainContent(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map(m=>htmlToText(m[1]));
  const general=paragraphs.filter(s=>/Faculty Senate meetings are scheduled|Meetings are hybrid|invitation with agenda|Senate meetings are open|General Faculty.*precedes/i.test(s)).join('\n\n').slice(0,5000);
  const specific=meeting?`Dated meeting row on the current Faculty Senate meetings page:\n${meeting.rowText}\nMeeting date: ${meeting.label}. Location: ${meeting.location}.\n${meeting.agendaURL?'The Agenda cell has a public link.':'The Agenda cell has no readable public agenda link at the time of this check.'}`:
    `The page currently lists these dated Faculty Senate meetings:\n${rows.filter(r=>!r.orientation).slice(-16).map(r=>r.rowText).join('\n')}\n${scope?`No ${mode==='upcoming'?'upcoming dated meeting':'published meeting agenda'} matching the requested period ${scope.label} could be identified. Other dated rows do not answer the requested period.`:`No ${mode==='upcoming'?'upcoming dated meeting':'published meeting agenda'} could be identified from this current schedule.`}`;
  return {source:{title:'Faculty Senate — current meeting schedule',url:MEETINGS_URL,fetchedAt:now.toISOString(),notice:'Read from the live Faculty Senate website for this question.'},
    p:{source:MEETINGS_URL,heading:meeting?`Faculty Senate meeting — ${meeting.label}`:'Current meeting schedule',text:(scope?`Requested meeting period: ${scope.label}.\n`:'')+specific+'\n\n'+general}};
}
export async function getLiveMeetingEvidence(messages,{fetcher=fetch,now=new Date(),timeoutMs=12000}={}){
  const mode=modeFor(messages),deadline=Date.now()+Math.min(15000,Math.max(1000,timeoutMs)),result={evidence:[],attachments:[],checkedAt:null,attemptedAt:now.toISOString(),status:'source-unavailable',issues:[],nextMeeting:null,mode};
  let html,rows;
  try{
    const read=await fetchPublic(MEETINGS_URL,{fetcher,deadline,maxBytes:1500000});
    html=new TextDecoder().decode(read.bytes);
    if(!/Faculty Senate/i.test(html)||!/\bmeetings?\b/i.test(html))throw new Error('The Faculty Senate schedule could not be read.');
    rows=parseMeetingRows(html);if(!rows.length)throw new Error('No valid dated Faculty Senate schedule rows were readable.');
    result.checkedAt=now.toISOString();
  }catch(error){result.issues.push({source:MEETINGS_URL,message:error.message});return result;}
  const today=easternDate(now),orientation=/\borientation\b/i.test(latestQuestion(messages)),candidateRows=rows.filter(r=>!r.cancelled&&(orientation||!r.orientation));
  const hasFivePM=/3:00\s*[–—-]\s*5:00\s*(?:p\.?m\.?|PM)/i.test(htmlToText(mainContent(html)));
  const upcoming=candidateRows.filter(r=>r.date>today.date||r.date===today.date&&(!hasFivePM||today.minutes<17*60));
  const past=candidateRows.filter(r=>r.date<=today.date);
  const question=latestQuestion(messages),scope=requestedScope(messages,now);
  result.requestedPeriod=scope;
  const asksNext=/\b(?:next|upcoming)\b/i.test(question)||!requestedPeriod(question,now)&&/\b(?:next|upcoming)\b/i.test(topicQuestion(messages)),upcomingMatches=upcoming.filter(r=>matchesScope(r,scope));
  const pastRelativePeriod=scope?.relative&&!asksNext&&!upcomingMatches.length&&scope.type!=='date';
  const applicable=scope?.type==='date'&&!asksNext?candidateRows.filter(r=>matchesScope(r,scope)):
    scope?.relative&&!asksNext&&!upcomingMatches.length?candidateRows.filter(r=>matchesScope(r,scope)):upcomingMatches;
  const latestPublishedAgenda=/\b(?:latest|most recent)\b/i.test(question)&&/\bagenda\b/i.test(question)&&! /\blast meeting\b/i.test(question);
  const meeting=mode==='upcoming'?(pastRelativePeriod?applicable.at(-1):applicable[0]):latestPublishedAgenda?candidateRows.filter(r=>r.agendaURL&&matchesScope(r,scope)).at(-1):past.filter(r=>matchesScope(r,scope)).at(-1);
  if(pastRelativePeriod&&meeting)result.mode='latest';
  result.nextMeeting=meeting||null;
  result.evidence.push(pageEvidence(html,meeting,now,result.mode,rows,scope));
  if(!meeting){result.status=mode==='upcoming'?'no-upcoming-meeting':'no-published-agenda';return result;}
  if(!meeting.agendaURL){result.status=meeting.unsafeAgenda?'agenda-unavailable':'agenda-not-posted';if(meeting.unsafeAgenda)result.issues.push({source:MEETINGS_URL,message:'Agenda link is outside the approved public-source hosts.'});return result;}
  try{
    const read=await fetchPublic(agendaRequestURL(meeting.agendaURL),{fetcher,deadline});
    const isPDF=/pdf/i.test(read.type)||new TextDecoder().decode(read.bytes.slice(0,5))==='%PDF-';
    let pages;
    if(isPDF){
      result.attachments.push(pdfAttachment(read.bytes,{sourceUrl:meeting.agendaURL,sourceId:result.evidence.length+1,filename:`faculty-senate-agenda-${meeting.date}.pdf`}));
      result.evidence.push({source:{title:`Faculty Senate meeting agenda — ${meeting.label}`,url:meeting.agendaURL,fetchedAt:now.toISOString(),notice:'Public agenda PDF opened for this question. Verify its meeting date in the original.'},
        p:{source:meeting.agendaURL,heading:`Agenda linked for ${meeting.label}`,text:`The dated ${meeting.label} row of the current Faculty Senate schedule links this public agenda PDF. Its full contents are in the attached PDF for this evidence ID. Read the attachment before making any claim about agenda items. Verify the meeting date printed in the PDF; if it conflicts with ${meeting.label}, explain the mismatch and do not present its items as this meeting’s agenda. This metadata is not a transcription of the agenda.`}});
      result.status='agenda-attached';return result;
    }
    else{
      const raw=new TextDecoder().decode(read.bytes),text=/html/i.test(read.type)||/<html\b/i.test(raw)?htmlToText(mainContent(raw)):raw.trim();
      if(/(?:Sign in.*Google|You need access|Request access|Sorry, unable to open the file|Google Drive.*virus scan)/i.test(text.slice(0,3000))||text.length<60)throw new Error('The linked agenda does not expose readable public text.');
      if(text.length>45000)throw new Error('Agenda exceeds the live reading text limit.');
      pages=[{page:null,text}];
    }
    const printedDate=parseMeetingDate(pages[0].text.slice(0,1800));
    if(printedDate&&printedDate.date!==meeting.date){result.status='agenda-date-mismatch';result.issues.push({source:meeting.agendaURL,message:`The linked agenda is dated ${printedDate.label}, but the schedule row is ${meeting.label}.`});return result;}
    for(const page of pages){
      // Bound individual excerpts while retaining the complete supported agenda.
      for(let offset=0;offset<page.text.length;offset+=12000)result.evidence.push({
        source:{title:`Faculty Senate meeting agenda — ${meeting.label}`,url:meeting.agendaURL,fetchedAt:now.toISOString(),notice:'Read from the agenda linked by the current Faculty Senate meeting schedule.'},
        p:{source:meeting.agendaURL,heading:`Agenda — ${meeting.label}${page.page?`, page ${page.page}`:''}${offset?`, continued`:''}`,text:page.text.slice(offset,offset+12000)}
      });
    }
    result.status='agenda-read';return result;
  }catch(error){result.status='agenda-unavailable';result.issues.push({source:meeting.agendaURL,message:error.message});return result;}
}

export function liveMeetingFallback(result){
  if(result.status==='source-unavailable')return {kind:'unanswered',answer:'I couldn’t read the current Faculty Senate meeting schedule, so I can’t verify the next meeting or agenda. Please try again shortly, or use the email option below to ask Genviéve. Your original question will be included in the draft.',followUp:'',sources:[],retryable:true,checkedAt:null,attemptedAt:result.attemptedAt,liveStatus:result.status};
  const meeting=result.nextMeeting,source={id:1,url:MEETINGS_URL,title:'Faculty Senate — current meeting schedule',section:meeting?`Faculty Senate meeting — ${meeting.label}`:'Current meeting schedule',sections:[]};
  let answer=meeting?(result.requestedPeriod?.type==='date'?`The schedule lists a Faculty Senate meeting on ${meeting.label}${meeting.location?`, at ${meeting.location}`:''}. [1]`:
    `The ${result.mode==='upcoming'?'next':'most recent'} Faculty Senate meeting${result.requestedPeriod?` listed for ${result.requestedPeriod.label}`:' listed'} is ${meeting.label}${meeting.location?`, at ${meeting.location}`:''}. [1]`):
    result.requestedPeriod?`The current Faculty Senate schedule does not list a ${result.mode==='upcoming'?'dated upcoming meeting':'published meeting agenda'} for ${result.requestedPeriod.label} that I can verify. [1]`:
    result.status==='no-published-agenda'?'The current Faculty Senate meeting schedule does not provide a public agenda link that I can verify. [1]':'The current Faculty Senate schedule does not provide a dated upcoming meeting that I can verify. [1]';
  if(result.status==='agenda-not-posted')answer+='\n\nThe meeting’s Agenda cell does not yet contain a public link. I can verify the date and location, but the agenda items are not available from that row. [1]';
  if(result.status==='agenda-unavailable')answer+='\n\nI couldn’t read the linked agenda, so I can’t verify its items. You can try its link from the meeting schedule or ask Genviéve using the email option below.';
  if(result.status==='agenda-attached')answer+='\n\nThe schedule provides an agenda link, but I couldn’t complete a verified reading of its contents. Open the Agenda link from the meeting schedule to review it, or ask Genviéve using the email option below. [1]';
  if(result.status==='agenda-date-mismatch')answer+='\n\nThe agenda link opens a document with a different meeting date. I can’t verify this meeting’s agenda from that document; Genviéve can help resolve the mismatch.';
  return {kind:'answer',answer,followUp:'',sources:[source],snapshotDate:result.checkedAt,checkedAt:result.checkedAt,liveStatus:result.status,escalatable:['agenda-unavailable','agenda-attached','agenda-date-mismatch','no-upcoming-meeting','no-published-agenda'].includes(result.status)};
}
