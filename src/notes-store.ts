import { readFile, writeFile, mkdir, rename, readdir, realpath, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import YAML from 'yaml';
import type { Paper } from './context';

export type NotesConfig = { vault: string; folder: string; template: string };
export type NoteTarget = { id: string; title: string; papers: Paper[]; kind: 'paper' | 'topic' | 'legacy' };
export type NoteSnapshot = { id: string; title: string; text: string; revision: string; path: string; exists: boolean; missing: boolean; conflictPath?: string };
type Binding = { path: string; created: boolean; conflictPath?: string };
const digest = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
function cleanName(s: string) {
  const normalized = s.normalize('NFC').replace(/[\x00-\x1f/\\:*?"<>|#\[\]^]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '');
  let name = '';
  // Leave room for collision suffixes and atomic-write temporary filenames.
  for (const char of normalized) {
    if (name.length >= 130 || Buffer.byteLength(name + char, 'utf8') > 180) break;
    name += char;
  }
  return name.trim() || '未命名论文';
}
const within = (root: string, file: string) => file === root || file.startsWith(root + path.sep);
const readText = async (file: string) => { try { return await readFile(file, 'utf8'); } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; } };
function noteID(text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  try { return match ? YAML.parse(match[1], { maxAliasCount: 20 })?.flow_paper_id : undefined; } catch { return undefined; }
}
export function paperIdentity(p: Paper) {
  return p.source === 'zotero' ? `zotero:library:${p.parentKey || p.zoteroKey}` : `local:${p.fingerprint || p.id}`;
}
export function paperTarget(p: Paper): NoteTarget { return { id: paperIdentity(p), title: p.title, papers: [p], kind: 'paper' }; }
export function sourceURL(paperId: string, page = 1) { return `flow-paper://read?paper=${encodeURIComponent(paperId)}&page=${Math.max(1, Math.floor(page))}`; }

/** Markdown files are authoritative. The profile contains bindings and recovery
 * revisions, never a second mutable copy that can overwrite Obsidian on startup. */
export class NotesStore {
  private bindings: Record<string, Binding> = {};
  private queue: Promise<unknown> = Promise.resolve();
  private indexFile: string;
  constructor(public config: NotesConfig, private recovery: string) {
    this.indexFile = path.join(recovery, `bindings-${digest(config.vault + '/' + config.folder).slice(0, 16)}.json`);
  }
  async init() {
    this.config = await NotesStore.validate(this.config);
    await mkdir(this.recovery, { recursive: true, mode: 0o700 });
    const saved = await readText(this.indexFile);
    if (saved) this.bindings = JSON.parse(saved);
    return this;
  }
  static async validate(config: NotesConfig) {
    if (!config || !path.isAbsolute(config.vault)) throw new Error('请选择 Obsidian 库目录。');
    const vault = await realpath(config.vault);
    if (!(await stat(path.join(vault, '.obsidian'))).isDirectory()) throw new Error('所选目录不是 Obsidian 库（缺少 .obsidian）。');
    for (const name of ['folder', 'template'] as const) {
      const value = config[name];
      if (typeof value !== 'string' || !value.trim() || path.isAbsolute(value) || value.split(/[\\/]/).some(s => s === '..' || s.startsWith('.'))) throw new Error('笔记目录和模板必须是库内的普通相对路径。');
      const file = path.resolve(vault, value);
      if (!within(vault, file)) throw new Error('路径超出 Obsidian 库。');
      let ancestor = file;
      while (true) { try { if (!within(vault, await realpath(ancestor))) throw new Error('路径不能指向库外的符号链接。'); break; } catch (e: any) { if (e.code !== 'ENOENT') throw e; ancestor = path.dirname(ancestor); } }
    }
    await readFile(path.resolve(vault, config.template), 'utf8');
    return { vault, folder: config.folder.trim(), template: config.template.trim() };
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> { const task = this.queue.then(fn); this.queue = task.catch(() => {}); return task; }
  private get root() { return path.resolve(this.config.vault, this.config.folder); }
  private async checked(file: string, createParent = false) {
    file = path.resolve(file);
    if (!within(this.root, file)) throw new Error('笔记路径超出配置目录。');
    let ancestor = file;
    while (true) { try { if (!within(this.config.vault, await realpath(ancestor))) throw new Error('笔记路径指向库外。'); break; } catch (e: any) { if (e.code !== 'ENOENT') throw e; ancestor = path.dirname(ancestor); } }
    if (createParent) await mkdir(path.dirname(file), { recursive: true });
    return file;
  }
  private async index() {
    const tmp = `${this.indexFile}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(this.bindings), { mode: 0o600 }); await rename(tmp, this.indexFile);
  }
  private async find(id: string, dir = this.root): Promise<string[]> {
    let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch (e: any) { if (e.code === 'ENOENT') return []; throw e; }
    const found: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') || ['assets', '_conflicts'].includes(entry.name) || entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...await this.find(id, file));
      else if (entry.isFile() && entry.name.endsWith('.md') && noteID(await readFile(file, 'utf8')) === id) found.push(file);
    }
    return found;
  }
  private async resolve(target: NoteTarget) {
    let binding = this.bindings[target.id];
    if (binding) {
      const current = await readText(await this.checked(binding.path));
      if (current !== null && noteID(current) === target.id) return binding;
    }
    const matches = await this.find(target.id);
    if (matches.length > 1) throw new Error('发现两份相同论文标识的笔记，请在 Obsidian 中保留一份后重试。');
    if (matches.length) binding = { ...binding, path: matches[0], created: true };
    else if (!binding) {
      const p = target.papers[0];
      const name = cleanName(target.kind === 'paper' ? [p?.year, p?.authors?.split(',')[0], target.title].filter(Boolean).join(' - ') : target.title);
      let file = path.join(this.root, target.kind === 'topic' ? '专题' : '', `${name}.md`);
      if (await readText(await this.checked(file)) !== null || Object.values(this.bindings).some(b => b.path === file)) file = path.join(path.dirname(file), `${name} - ${digest(target.id).slice(0, 8)}.md`);
      if (await readText(await this.checked(file)) !== null) throw new Error('目标文件已经存在，请检查重名笔记。');
      binding = { path: file, created: false };
    }
    this.bindings[target.id] = binding!; await this.index(); return binding!;
  }
  private async template(target: NoteTarget) {
    let text = target.kind === 'paper' ? await readFile(path.resolve(this.config.vault, this.config.template), 'utf8') : `---\ntype: ${target.kind}\n---\n# {{title}}\n`;
    text = text.replaceAll('{{title}}', target.title.replace(/[\r\n]/g, ' ')).replaceAll('{{date}}', new Date().toLocaleDateString('en-CA'));
    const fields = YAML.stringify({ flow_paper_id: target.id, title: target.title, ...(target.kind === 'paper' ? { authors: target.papers[0]?.authors || '', year: target.papers[0]?.year || '', zotero_collections: target.papers[0]?.collections || [] } : {}) }).trim();
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    text = match ? `---\n${match[1]}\n${fields}\n---\n${text.slice(match[0].length)}` : `---\n${fields}\n---\n${text}`;
    if (target.papers.length) {
      const links = [];
      for (const p of target.papers) {
        let link = `- [${p.title.replace(/[\[\]\r\n]/g, ' ')}](${sourceURL(p.id)})${p.source === 'zotero' ? ` · [Zotero](zotero://select/library/items/${encodeURIComponent(p.parentKey || p.zoteroKey!)})` : ''}`;
        if (target.kind === 'topic') {
          const b = await this.resolve(paperTarget(p));
          link += ` · [论文笔记](${path.relative(path.join(this.root, '专题'), b.path).split(path.sep).map(encodeURIComponent).join('/')})`;
        }
        links.push(link);
      }
      text += '\n## 文献来源\n\n' + links.join('\n') + '\n';
    }
    return text;
  }
  private async readNow(target: NoteTarget): Promise<NoteSnapshot> {
    const b = await this.resolve(target), text = await readText(await this.checked(b.path));
    // A replaced file whose identity disappeared must never be overwritten.
    const missing = b.created && (text === null || noteID(text) !== target.id);
    return { id: target.id, title: target.title, path: b.path, exists: text !== null, missing, text: text ?? await this.template(target), revision: text === null ? '' : digest(text), conflictPath: b.conflictPath };
  }
  read(target: NoteTarget) { return this.serial(() => this.readNow(target)); }
  private async recover(id: string, text: string) {
    const dir = path.join(this.recovery, digest(id).slice(0, 20)); await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${digest(text)}.md`);
    await writeFile(file, text, { mode: 0o600 }); return file;
  }
  private async conflict(target: NoteTarget, text: string, current: NoteSnapshot) {
    const file = path.join(this.root, '_conflicts', `${cleanName(target.title).slice(0, 70)} - ${digest(target.id + text).slice(0, 12)}.md`);
    await this.checked(file, true);
    // Immutable draft copies: never replace a file subsequently edited in Obsidian.
    try { await writeFile(file, text, { flag: 'wx', mode: 0o600 }); } catch (e: any) { if (e.code !== 'EEXIST') throw e; if (await readText(file) !== text) return this.conflict(target, text + '\n', current); }
    this.bindings[target.id].conflictPath = file; await this.index();
    return { ...current, conflict: true, conflictPath: file };
  }
  private async saveNow(target: NoteTarget, text: string, expected: string) {
    if (typeof text !== 'string' || text.length > 8_000_000) throw new Error('笔记内容过大。');
    await this.recover(target.id, text);
    const current = await this.readNow(target);
    if (noteID(text) !== target.id) throw new Error('请保留笔记顶部的 flow_paper_id，草稿已保存在本机恢复目录。');
    if (current.missing || current.revision !== expected) return this.conflict(target, text, current);
    if (current.exists && text === current.text) return { ...current, conflict: false };
    if (current.exists) await this.recover(target.id, current.text);
    await this.checked(current.path, true);
    const tmp = `${current.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, text, { flag: 'wx', mode: 0o600 });
      const latest = await readText(current.path);
      if ((latest === null ? '' : digest(latest)) !== expected) return this.conflict(target, text, await this.readNow(target));
      await rename(tmp, current.path);
    } finally { await unlink(tmp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
    this.bindings[target.id].created = true; await this.index();
    const result = await this.readNow(target);
    if (result.text !== text) return this.conflict(target, text, result);
    return { ...result, conflict: false };
  }
  save(target: NoteTarget, text: string, expected: string) { return this.serial(() => this.saveNow(target, text, expected)); }
  async acknowledge(target: NoteTarget) { return this.serial(async () => { const b = await this.resolve(target); delete b.conflictPath; await this.index(); return this.readNow(target); }); }
  append(target: NoteTarget, entry: { id: string; question: string; answer: string; attachments: any[] }) {
    return this.serial(async () => {
      if (target.kind === 'topic') for (const p of target.papers) {
        const related = paperTarget(p), note = await this.readNow(related);
        if (!note.exists && !note.missing) await this.saveNow(related, note.text, note.revision);
      }
      const current = await this.readNow(target), marker = `<!-- flow-paper-entry:${digest(entry.id)} -->`;
      if (current.text.includes(marker)) return { ...current, duplicate: true };
      const heading = entry.question.replace(/[\r\n]/g, ' ').slice(0, 160);
      const fragments = [marker, `### ${heading}`];
      if (heading !== entry.question) fragments.push(`**问题**\n\n${entry.question}`);
      for (const a of entry.attachments) {
        if (a.text) fragments.push(a.text.split('\n').map((line: string) => `> ${line}`).join('\n'));
        if (a.image) {
          const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(a.image);
          if (!match) throw new Error('截图格式不受支持。');
          const bytes = Buffer.from(match[2], 'base64'); if (bytes.length > 20 * 1024 * 1024) throw new Error('截图超过 20 MB。');
          const file = await this.checked(path.join(this.root, 'assets', digest(target.id).slice(0, 16), `${digest(bytes).slice(0, 24)}.${match[1]}`), true);
          try { await writeFile(file, bytes, { flag: 'wx' }); } catch (e: any) { if (e.code !== 'EEXIST') throw e; }
          const relative = path.relative(path.dirname(current.path), file).split(path.sep).map(encodeURIComponent).join('/');
          fragments.push(`![论文截图](${relative})`);
        }
        fragments.push(`[${String(a.title || '原文').replace(/[\[\]\r\n]/g, ' ')} · 第 ${Number(a.page) || 1} 页](${sourceURL(a.paperId, a.page)})`);
      }
      fragments.push(entry.answer.replace(/#source=([^\s)&]+)&page=(\d+)/g, (_m, id, page) => sourceURL(decodeURIComponent(id), +page)));
      const section = current.text.includes('## 阅读摘录与问答') ? '' : '\n## 阅读摘录与问答\n';
      return this.saveNow(target, `${current.text.trimEnd()}\n${section}\n${fragments.join('\n\n')}\n`, current.revision);
    });
  }
  async image(target: NoteTarget, relative: string) {
    const note = await this.read(target);
    const file = path.resolve(path.dirname(note.path), decodeURIComponent(relative));
    if (!within(this.config.vault, file) || !/\.(png|jpe?g|webp|gif)$/i.test(file) || !within(this.config.vault, await realpath(file))) throw new Error('图片必须位于 Obsidian 库内。');
    if ((await stat(file)).size > 20 * 1024 * 1024) throw new Error('图片过大。');
    return `data:image/${path.extname(file).slice(1).replace('jpg', 'jpeg')};base64,${(await readFile(file)).toString('base64')}`;
  }
  async linkedFile(target: NoteTarget, relative: string) {
    const note = await this.read(target), file = await this.checked(path.resolve(path.dirname(note.path), decodeURIComponent(relative)));
    if (!file.endsWith('.md')) throw new Error('仅支持打开论文目录内的 Markdown 笔记。');
    await stat(file); return file;
  }
}
