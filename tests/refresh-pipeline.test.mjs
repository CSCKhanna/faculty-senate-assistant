import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
test('source refresh preserves provenance and rejects corrupt publication generations',()=>{
  const result=spawnSync(process.env.REFRESH_PYTHON||'python3',['tests/refresh_pipeline_test.py'],{
    cwd:new URL('..',import.meta.url),encoding:'utf8',
    env:{...process.env,PYTHONPYCACHEPREFIX:path.join(os.tmpdir(),'senate-refresh-test-pycache')}
  });
  assert.equal(result.status,0,result.stderr||result.stdout||result.error?.message);
});
