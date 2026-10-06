// Package the full public corpus compactly; runtime decodes it once at startup.
import fs from 'node:fs';import path from 'node:path';import {gzipSync} from 'node:zlib';import {build} from 'esbuild';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=process.argv[2]||path.resolve(root,'../../work/sonnet-worker.js');
await build({entryPoints:[path.join(root,'backend/worker.js')],bundle:true,format:'esm',platform:'browser',outfile:output,plugins:[{name:'compressed-public-corpus',setup(builder){builder.onLoad({filter:/data\/index\.json$/},async({path:filename})=>{const packed=gzipSync(fs.readFileSync(filename)).toString('base64');return {resolveDir:root,loader:'js',contents:`import {ungzip} from 'pako';export default JSON.parse(ungzip(Uint8Array.from(atob(${JSON.stringify(packed)}),c=>c.charCodeAt(0)),{to:'string'}));`};});}}]});
console.log('Worker bundle saved:',output,'bytes:',fs.statSync(output).size);
