// Scope short replies to their topic while allowing a new question in the same chat.
export function isFollowUp(text){
  const q=text.trim();
  if(/^(?:yes|no|sure|okay|ok|the prerequisites|the credits|the title|the description)\b/i.test(q))return true;
  if(/\b(?:it|its|their|they|them|those|that|this|next|after that)\b/i.test(q))return true;
  if(/^(?:what(?:'s| is) (?:the )?bill number|is there a bill number|and (?:the )?bill number)[?.! ]*$/i.test(q))return true;
  if(/^(?:what about|and what|how about|can you explain|tell me more|why is that)\b/i.test(q))return true;
  if(/^(?:what happens (?:after|once)|how long (?:does|will|would)|what (?:are|is) (?:the )?(?:next steps?|deadline|timeline)|which committee|who (?:reviews|approves)|(?:can|could) you (?:summarize|clarify|link|give (?:me )?(?:the )?source))\b/i.test(q))return true;
  // Short answers to the assistant's question stay in the topic. Explicit new
  // subject labels (for example, "Faculty Senate awards") start a new one.
  return /^(?:the\s+)?[\w +,-]{1,60}[.!]?$/.test(q)&&!/[?]/.test(q)&&!/^how|^what|^who|^where|^when|^were|^was|^is|^are/i.test(q)&&! /\b(?:faculty senate|kuali|awards|university manual|calendar committee)\b/i.test(q);
}
export function activeMessages(messages){
  let start=0;
  for(let i=0;i<messages.length;i++)if(messages[i].role==='user'&&!isFollowUp(messages[i].content))start=i;
  return messages.slice(start);
}
export function academicYear(snapshot){
  const d=new Date(snapshot),year=d.getUTCFullYear()-(d.getUTCMonth()<6?1:0);
  return {current:`${year}-${year+1}`,previous:`${year-1}-${year}`};
}
export function expandQuestion(text,snapshot){
  const y=academicYear(snapshot);
  return text.replace(/\bAI\b/gi,'Artificial Intelligence').replace(/\blast academic year\b/gi,y.previous+' academic year').replace(/\b(?:this|current) academic year\b/gi,y.current+' academic year');
}
