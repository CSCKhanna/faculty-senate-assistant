import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {converse,validateMessages} from './backend/chat.js';
const root=process.cwd();
const port=Number(process.env.PORT||4173);
const localEnv=process.env.URI_ENV_FILE?Object.fromEntries((await fs.readFile(process.env.URI_ENV_FILE,'utf8')).trim().split('\n').map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];})):{};
const index=JSON.parse(await fs.readFile('data/index.json','utf8'));
let calls=0;
http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ready:Boolean(localEnv.URI_API_KEY)}));return;}
    if(pathname==='/chat'&&req.method==='POST'){
      if(!localEnv.URI_API_KEY){res.writeHead(503);res.end(JSON.stringify({error:'Local AI connection not configured.'}));return;}
      let body='';for await(const chunk of req){body+=chunk;if(body.length>50000)throw new Error('Conversation too long.');}
      if(++calls>100)throw new Error('Local test request limit reached.');
      const messages=validateMessages(JSON.parse(body).messages);
      const answer=await converse(index,messages,localEnv);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(answer));return;
    }
    if(pathname==='/config.js'&&localEnv.URI_API_KEY){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(`export const CHAT_API_URL = 'http://127.0.0.1:${port}';`);return;}
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)||pathname.split('/').some(x=>x.startsWith('.'))){res.writeHead(403);res.end();return;}
    const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json'};
    const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain','Cache-Control':'no-store'});res.end(data);
  }catch{res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'The request could not be completed. Please retry.'}));}
}).listen(port,'127.0.0.1',()=>console.log(`Prototype: http://127.0.0.1:${port} (AI ${localEnv.URI_API_KEY?'connected':'not connected'})`));
