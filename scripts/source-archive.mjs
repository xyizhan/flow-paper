// Include the two pinned upstream trees: GitHub's automatic source ZIP omits submodules.
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, mkdir, rm, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
const pkg=JSON.parse(await readFile('package.json','utf8'));
if (execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()) throw new Error('Commit reviewed changes before making the source archive.');
const pins=JSON.parse(await readFile('upstream.json','utf8'));
const staging=await mkdtemp(path.join(os.tmpdir(),'flow-paper-source-'));
try {
  const root=path.join(staging,'flow-paper');await mkdir(root);
  for(const [cwd,ref,destination] of [['.','HEAD',root],['vendor/llm-for-zotero',pins.llmForZotero,path.join(root,'vendor/llm-for-zotero')],['vendor/embedpdf',pins.embedpdfSource,path.join(root,'vendor/embedpdf')]]) {
    await mkdir(destination,{recursive:true});
    const archive=execFileSync('git',['-C',cwd,'archive','--format=tar',ref],{maxBuffer:250*1024*1024});
    execFileSync('tar',['-xf','-','-C',destination],{input:archive});
  }
  await mkdir('release',{recursive:true});
  const filename=`Flow-Paper-${pkg.version}-source.zip`;
  execFileSync('ditto',['-c','-k','--norsrc','--noextattr','--noqtn','--keepParent',root,path.resolve('release',filename)],{env:{...process.env,COPYFILE_DISABLE:'1'}});
  const checksum=createHash('sha256').update(await readFile(path.join('release',filename))).digest('hex');
  await appendFile('release/SHA256SUMS.txt',`${checksum}  ${filename}\n`);
  console.log(`Created release/${filename}`);
} finally { await rm(staging,{recursive:true,force:true}); }
