import test from 'node:test';import assert from 'node:assert/strict';
import {answerBlocks,sourceUrl} from '../presentation.js';
import {activeMessages,expandQuestion} from '../conversation.js';
test('paragraphs, numbered steps, and bullets become readable blocks',()=>{
  const b=answerBlocks('A direct answer.\n\n1. Sign in.\n2. Open Curriculum.\n\n- Faculty\n- Staff\n\nFinal note.');
  assert.deepEqual(b,[{type:'p',text:'A direct answer.'},{type:'ol',items:['Sign in.','Open Curriculum.']},{type:'ul',items:['Faculty','Staff']},{type:'p',text:'Final note.'}]);
});
test('source links only accept the exact public source hosts and secure protocols',()=>{
  assert.equal(sourceUrl({url:'javascript:alert(1)'}),null);assert.equal(sourceUrl({url:'https://web.uri.edu.evil.example/'}),null);assert.equal(sourceUrl({url:'https://invented.example/'}),null);assert.equal(sourceUrl({url:'http://web.uri.edu/facsen/'}),'https://web.uri.edu/facsen/');
});
test('short replies retain their topic while independent questions start a new context',()=>{
  const m=[{role:'user',content:'How do I change a course?'},{role:'assistant',content:'What are you changing?'},{role:'user',content:'The prerequisites.'}];assert.equal(activeMessages(m).length,3);
  assert.deepEqual(activeMessages([...m,{role:'user',content:'How can I start using Kuali?'}]),[{role:'user',content:'How can I start using Kuali?'}]);
  assert.equal(expandQuestion('Was the AI major approved last academic year?','2026-10-06T20:00:00Z'),'Was the Artificial Intelligence major approved 2025-2026 academic year?');
});
