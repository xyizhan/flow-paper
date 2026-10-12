import { packager } from '@electron/packager';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This release targets an Apple Silicon Mac.');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const destination = path.resolve('release/Flow Paper-darwin-arm64');
const processes = execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8' });
if (processes.split('\n').some(line => line.startsWith(`${destination}/Flow Paper.app/Contents/MacOS/Flow Paper`))) {
  throw new Error('Quit the packaged Flow Paper app before rebuilding it.');
}
execFileSync(process.execPath, ['scripts/build.mjs', '--release'], { stdio: 'inherit' });
await mkdir('release', { recursive: true });
const staging = await mkdtemp(path.join(os.tmpdir(), 'flow-paper-package-'));
try {
  const appDir = path.join(staging, 'app');
  await mkdir(path.join(appDir, 'dist'), { recursive: true });
  // Positive allowlist: never copy workspace files, test profiles or credentials.
  for (const name of ['main.cjs', 'preload.cjs', 'renderer.js', 'index.html', 'styles.css', 'embedpdf', 'pdfium.wasm', 'katex', 'upstream.json']) {
    await cp(`dist/${name}`, path.join(appDir, 'dist', name), { recursive: true });
  }
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await cp(name, path.join(appDir, name));
  await writeFile(path.join(appDir, 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, main: pkg.main, license: pkg.license, repository: pkg.repository }));
  const licenses = path.join(appDir, 'licenses');
  await mkdir(licenses);
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  for (const [location, data] of Object.entries(lock.packages)) {
    if (!location || data.dev) continue;
    const entries = await readdir(location, { withFileTypes: true });
    for (const entry of entries) if (entry.isFile() && /^(licen[sc]e|notice|copying)(\.|$)/i.test(entry.name)) {
      const name = `${location.replaceAll('node_modules/', '').replaceAll('/', '__')}--${entry.name}`;
      await cp(path.join(location, entry.name), path.join(licenses, name));
    }
  }
  await cp('vendor/llm-for-zotero/LICENSE', path.join(licenses, 'llm-for-zotero--LICENSE'));
  await cp('node_modules/electron/dist/LICENSE', path.join(licenses, 'electron--LICENSE'));
  await cp('node_modules/electron/dist/LICENSES.chromium.html', path.join(licenses, 'LICENSES.chromium.html'));
  const iconset = path.join(staging, 'FlowPaper.iconset');
  execFileSync('swift', ['scripts/make-icon.swift', iconset], { stdio: 'inherit' });
  const icon = path.join(staging, 'FlowPaper.icns');
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icon]);
  if (!existsSync('assets/icon.png')) await cp(path.join(iconset, 'icon_256x256@2x.png'), 'assets/icon.png');
  const paths = await packager({ dir: appDir, out: path.resolve('release'), name: 'Flow Paper', platform: 'darwin', arch: 'arm64',
    electronVersion: lock.packages['node_modules/electron'].version, appVersion: pkg.version, buildVersion: pkg.version.split('-')[0],
    appBundleId: 'io.github.xyizhan.flow-paper', appCategoryType: 'public.app-category.productivity', icon,
    overwrite: true, prune: false, asar: false, darwinDarkModeSupport: true,
    extendInfo: { LSMinimumSystemVersion: '13.0', NSHumanReadableCopyright: 'AGPL-3.0-or-later. See Help → Project source.',
      CFBundleURLTypes: [{ CFBundleURLName: 'Flow Paper source links', CFBundleURLSchemes: ['flow-paper'] }],
      CFBundleDocumentTypes: [{ CFBundleTypeName: 'PDF document', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', LSItemContentTypes: ['com.adobe.pdf'] }] },
  });
  const app = path.join(paths[0], 'Flow Paper.app');
  // Local ad-hoc signature only: no Developer ID or notarization is claimed.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  execFileSync('python3', ['scripts/audit-release.py', '--artifact', app], { stdio: 'inherit' });
  console.log(`Built ${app}`);
} finally { await rm(staging, { recursive: true, force: true }); }
