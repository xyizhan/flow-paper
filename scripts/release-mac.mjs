import { cp, mkdir, mkdtemp, readFile, rm, symlink, access, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const app = path.resolve('release/Flow Paper-darwin-arm64/Flow Paper.app');
const stem = `Flow-Paper-${pkg.version}-macos-arm64`;
await access(app);
for (const ext of ['dmg','zip']) {
  try { await access(`release/${stem}.${ext}`); } catch { continue; }
  throw new Error(`release/${stem}.${ext} already exists. Do not replace published assets.`);
}
execFileSync('codesign', ['--verify','--deep','--strict',app], { stdio:'inherit' });
const arch = execFileSync('lipo', ['-archs', path.join(app,'Contents/MacOS/Flow Paper')], { encoding:'utf8' }).trim();
if (arch !== 'arm64') throw new Error(`Unexpected architecture: ${arch}`);
const staging = await mkdtemp(path.join(os.tmpdir(),'flow-paper-dmg-'));
try {
  execFileSync('ditto',['--norsrc','--noextattr','--noqtn',app,path.join(staging,'Flow Paper.app')]);
  await cp('LICENSE',path.join(staging,'LICENSE.txt'));
  await cp('docs/INSTALL.md',path.join(staging,'INSTALL.txt'));
  await symlink('/Applications',path.join(staging,'Applications'));
  execFileSync('ditto',['-c','-k','--norsrc','--noextattr','--noqtn','--keepParent',path.join(staging,'Flow Paper.app'),path.resolve(`release/${stem}.zip`)],{env:{...process.env,COPYFILE_DISABLE:'1'}});
  execFileSync('hdiutil',['create','-quiet','-volname','Flow Paper','-srcfolder',staging,'-format','UDZO',`release/${stem}.dmg`],{stdio:'inherit'});
  execFileSync('hdiutil',['verify',`release/${stem}.dmg`],{stdio:'inherit'});
  const lines = await Promise.all(['zip','dmg'].map(async ext => `${createHash('sha256').update(await readFile(`release/${stem}.${ext}`)).digest('hex')}  ${stem}.${ext}`));
  await writeFile('release/SHA256SUMS.txt',lines.join('\n')+'\n');
  console.log(`Created release/${stem}.dmg and .zip`);
} finally { await rm(staging,{recursive:true,force:true}); }
