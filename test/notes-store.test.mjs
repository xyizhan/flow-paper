import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, readdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NotesStore, paperTarget } from '../dist/test/notes-store.js';

const paper = { id: 'zotero-ATTACH01', source: 'zotero', parentKey: 'PARENT01', zoteroKey: 'ATTACH01', title: 'Attention: research / notes', authors: 'Smith, Doe', year: '2024', collections: ['Research'] };
const template = '---\ntype: paper\nstatus: 在读\ndate: "{{date}}"\n---\n# {{title}}\n\n## 方法核心\n- \n';
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flow-paper-notes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = path.join(root, 'vault'); await mkdir(path.join(vault, '.obsidian'), { recursive: true });
  await mkdir(path.join(vault, 'templates')); await writeFile(path.join(vault, 'templates/paper.md'), template);
  const config = { vault, folder: 'research/论文', template: 'templates/paper.md' }, recovery = path.join(root, 'recovery');
  const store = await new NotesStore(config, recovery).init();
  return { root, vault, config, recovery, store, target: paperTarget(paper) };
}
test('paper template, metadata, stable identity and first write', async t => {
  const { store, target } = await fixture(t), note = await store.read(target);
  assert.equal(note.exists, false); assert.match(note.text, /## 方法核心/); assert.match(note.text, /status: 在读/); assert.match(note.text, /flow_paper_id: zotero:library:PARENT01/);
  assert.doesNotMatch(path.basename(note.path), /[:/]/);
  const saved = await store.save(target, note.text + 'My thoughts\n', note.revision);
  assert.equal(saved.conflict, false); assert.match(await readFile(note.path, 'utf8'), /My thoughts/);
  const attachment = await store.read(paperTarget({ ...paper, id: 'zotero-ATTACH02', zoteroKey: 'ATTACH02' }));
  assert.equal(attachment.path, note.path);
});
test('long Chinese titles remain writable without losing the full title in the note', async t => {
  const { store } = await fixture(t), title = '多模态强化学习研究与论文阅读'.repeat(20);
  const target = paperTarget({ ...paper, title }), note = await store.read(target);
  const saved = await store.save(target, note.text, note.revision);
  assert.equal(saved.conflict, false); assert.ok(Buffer.byteLength(path.basename(saved.path)) < 200);
  assert.ok((await readFile(saved.path, 'utf8')).includes('# ' + title));
});
test('external changes cause a separate draft; neither side overwrites the other', async t => {
  const { store, target } = await fixture(t), n = await store.read(target);
  const baseline = await store.save(target, n.text, n.revision);
  const external = baseline.text + '\nWritten in Obsidian\n'; await writeFile(n.path, external);
  const draft = baseline.text + '\nWritten in Flow Paper\n';
  const result = await store.save(target, draft, baseline.revision);
  assert.equal(result.conflict, true);
  assert.equal(await readFile(n.path, 'utf8'), external);
  assert.equal(await readFile(result.conflictPath, 'utf8'), draft);
  const loaded = await store.read(target); assert.equal(loaded.text, external); assert.ok(loaded.conflictPath);
  await store.acknowledge(target); assert.equal((await store.read(target)).conflictPath, undefined);
});
test('a note renamed in Obsidian is rediscovered, including after restart', async t => {
  const { store, target, config, recovery } = await fixture(t), n = await store.read(target);
  await store.save(target, n.text, n.revision);
  const destination = path.join(path.dirname(n.path), '更合适的名字.md'); await rename(n.path, destination);
  const restarted = await new NotesStore(config, recovery).init(), loaded = await restarted.read(target);
  assert.equal(loaded.path, destination); assert.equal(loaded.missing, false);
});
test('deleting or replacing a bound note does not cause silent recreation or overwrite', async t => {
  const { store, target } = await fixture(t), n = await store.read(target), saved = await store.save(target, n.text, n.revision);
  await rm(n.path);
  const result = await store.save(target, saved.text + '\nDraft\n', saved.revision);
  assert.equal(result.conflict, true); assert.equal(result.missing, true); await assert.rejects(readFile(n.path));
  await writeFile(n.path, '# Unrelated note\n');
  const replaced = await store.save(target, saved.text, saved.revision);
  assert.equal(replaced.conflict, true); assert.equal(await readFile(n.path, 'utf8'), '# Unrelated note\n');
});
test('concurrent append is serialized, idempotent, and retains question, image and source links', async t => {
  const { store, target } = await fixture(t);
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2kAAAAASUVORK5CYII=';
  const entry = { id: 'message-a', question: 'What does the figure show?', answer: 'See [page](#source=zotero-ATTACH01&page=2).', attachments: [{ paperId: paper.id, title: paper.title, page: 2, image, text: 'Selected claim' }] };
  const [first, second, third] = await Promise.all([store.append(target, entry), store.append(target, entry), store.append(target, { ...entry, id: 'message-b', question: 'Follow-up?' })]);
  assert.equal(second.duplicate, true); assert.equal(third.conflict, false);
  const body = (await store.read(target)).text;
  assert.equal((body.match(/### What does the figure show/g) || []).length, 1); assert.match(body, /### Follow-up/); assert.match(body, /> Selected claim/); assert.match(body, /flow-paper:\/\/read\?paper=zotero-ATTACH01&page=2/); assert.doesNotMatch(body, /data:image|#source=/);
  const relative = /!\[论文截图\]\(([^)]+)\)/.exec(body)[1];
  assert.equal(await store.image(target, relative), image);
  const assets = path.resolve(path.dirname(first.path), decodeURIComponent(relative)); assert.ok((await readFile(assets)).length > 20);
});
test('two stale editor saves preserve both versions instead of last-writer-wins', async t => {
  const { store, target } = await fixture(t), n = await store.read(target), baseline = await store.save(target, n.text, n.revision);
  const a = baseline.text + '\nA\n', b = baseline.text + '\nB\n';
  const [left, right] = await Promise.all([store.save(target, a, baseline.revision), store.save(target, b, baseline.revision)]);
  assert.equal(left.conflict, false); assert.equal(right.conflict, true);
  assert.equal(await readFile(n.path, 'utf8'), a); assert.equal(await readFile(right.conflictPath, 'utf8'), b);
});
test('vault unavailability preserves a recoverable draft outside the vault', async t => {
  const { store, target, vault, recovery } = await fixture(t), n = await store.read(target);
  const saved = await store.save(target, n.text, n.revision), draft = saved.text + '\nOffline draft\n';
  await rename(vault, vault + '-offline'); await assert.rejects(store.save(target, draft, saved.revision));
  const revisions = await readdir(recovery, { recursive: true });
  const texts = await Promise.all(revisions.filter(p => p.endsWith('.md')).map(p => readFile(path.join(recovery, p), 'utf8')));
  assert.ok(texts.includes(draft));
});
test('paths cannot escape the vault through traversal or symlinks', async t => {
  const { store, target, config, root } = await fixture(t);
  await assert.rejects(NotesStore.validate({ ...config, folder: '../outside' }));
  await mkdir(path.join(root, 'outside')); await symlink(path.join(root, 'outside'), path.join(config.vault, 'escape'));
  await assert.rejects(NotesStore.validate({ ...config, folder: 'escape/notes' }));
  await assert.rejects(store.image(target, '../../../outside/secret.png'));
});
