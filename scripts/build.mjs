import { build } from 'esbuild';
import ts from 'typescript';
import { readFile, writeFile, mkdir, cp, rm, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const release = process.argv.includes('--release');
await rm('dist', { recursive: true, force: true });
await mkdir('src/generated', { recursive: true });
await mkdir('dist', { recursive: true });
// Extract the exact upstream functions, without importing Zotero's PDF/file host.
// This is generated on every build: fixes to upstream ranking are preserved.
const upstream = 'vendor/llm-for-zotero/src/services/paperContent/pdfContext.ts';
const source = await readFile(upstream, 'utf8');
const tree = ts.createSourceFile(upstream, source, ts.ScriptTarget.Latest, true);
const names = ['tokenizeText', 'buildChunkIndex', 'scoreChunkBM25'];
const functions = names.map(name => {
  const node = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!node) throw new Error(`Upstream retrieval API changed: ${name}`);
  return node.getText(tree);
});
await writeFile('src/generated/retrieval.ts', `// Generated from llm-for-zotero (AGPL-3.0-or-later). Do not edit.\nimport { tokenizeRetrievalText } from '../../vendor/llm-for-zotero/src/services/retrieval/retrievalTokenizer';\nimport type { ChunkStat } from '../../vendor/llm-for-zotero/src/services/paperContent/types';\n${functions.join('\n\n')}\n`);
const common = { bundle: true, logLevel: 'info', sourcemap: !release, loader: { '.md': 'text' }, tsconfigRaw: { compilerOptions: { target: 'ES2022', esModuleInterop: true } } };
await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs', platform: 'node', format: 'cjs', external: ['electron'], target: 'node24' });
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs', platform: 'node', format: 'cjs', external: ['electron'] });
await build({ ...common, entryPoints: ['src/renderer.ts'], outfile: 'dist/renderer.js', platform: 'browser', format: 'esm', target: 'chrome140' });
await build({ ...common, entryPoints: ['src/context.ts', 'src/ai.ts', 'src/zotero-settings.ts'], outdir: 'dist/test', platform: 'node', format: 'esm', target: 'node24' });
await cp('src/index.html', 'dist/index.html');
await cp('src/styles.css', 'dist/styles.css');
await cp('node_modules/@embedpdf/snippet/dist', 'dist/embedpdf', { recursive: true });
await cp('node_modules/@embedpdf/pdfium/dist/pdfium.wasm', 'dist/pdfium.wasm');
await cp('node_modules/katex/dist', 'dist/katex', { recursive: true });
await cp('LICENSE', 'dist/LICENSE');
await cp('THIRD_PARTY_NOTICES.md', 'dist/THIRD_PARTY_NOTICES.md');
const pins = JSON.parse(await readFile('upstream.json', 'utf8'));
for (const [directory, key] of [['llm-for-zotero', 'llmForZotero'], ['embedpdf', 'embedpdfSource']]) {
  let commit;
  try { commit = execFileSync('git', ['-C', `vendor/${directory}`, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Full source archive has no Git metadata. */ }
  if (commit && commit !== pins[key]) throw new Error(`Update upstream.json after changing ${directory}`);
}
await cp('upstream.json', 'dist/upstream.json');
if (release) {
  // Vendor distributions may contain maps even when our own bundle does not.
  async function stripMaps(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await stripMaps(file);
      else if (entry.name.endsWith('.map') || entry.name.endsWith('.pdf')) await rm(file);
    }
  }
  await stripMaps('dist');
}
