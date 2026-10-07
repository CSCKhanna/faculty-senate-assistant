// Publish only public runtime files and validated corpus objects.
import fs from 'node:fs';
import path from 'node:path';
const destination=process.env.PAGES_OUTPUT||'_site';
if(path.resolve(destination)===process.cwd())throw new Error('Pages output must be a separate directory.');
fs.rmSync(destination,{recursive:true,force:true});fs.mkdirSync(destination,{recursive:true});
for(const file of fs.readdirSync('.')){
  if(/\.(?:html|css|js|svg|png|ico|webmanifest)$/.test(file)&&fs.statSync(file).isFile())fs.copyFileSync(file,path.join(destination,file));
}
for(const file of ['README.md','LICENSE'])if(fs.existsSync(file))fs.copyFileSync(file,path.join(destination,file));
fs.writeFileSync(path.join(destination,'.nojekyll'),'');
fs.cpSync('data',path.join(destination,'data'),{recursive:true});
console.log(`Public site files prepared in ${destination}`);
