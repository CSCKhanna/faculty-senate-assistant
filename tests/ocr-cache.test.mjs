import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('OCR cache shares document inputs, coalesces parallel page work, and safely removes transient renders',()=>{
  const result=spawnSync(process.env.REFRESH_PYTHON||'python3',['tests/ocr_cache_test.py'],{
    cwd:new URL('..',import.meta.url),encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}
  });
  assert.equal(result.status,0,result.stderr||result.stdout||result.error?.message);
});
