import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, safeStorage, shell } from 'electron';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { callLLMStream } from './ai';
import { prepareContext, historyMessage, type Paper } from './context';
import { zoteroModels, publicZoteroModels } from './zotero-settings';
import { ResearchHost } from './research-host';
import { NotesStore, paperTarget, paperIdentity, type NoteTarget } from './notes-store';

protocol.registerSchemesAsPrivileged([{ scheme: 'su-app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
// Existing prototypes keep both their workspace and Chromium keychain identity.
// A fresh installation gets a clean Flow Paper profile. Explicit test profiles
// never discover or import a personal workspace.
const legacyProfile = path.join(app.getPath('appData'), 'Su Paper');
const currentProfile = path.join(app.getPath('appData'), 'Flow Paper');
const overrideProfile = process.env.FLOW_PAPER_DATA_DIR || process.env.SU_PAPER_DATA_DIR;
const useLegacy = overrideProfile ? !process.env.FLOW_PAPER_DATA_DIR
  : !existsSync(path.join(currentProfile, 'workspace.json')) && existsSync(path.join(legacyProfile, 'workspace.json'));
app.setName(useLegacy ? 'Su Paper' : 'Flow Paper');
app.setPath('userData', overrideProfile || (useLegacy ? legacyProfile : currentProfile));
app.setAboutPanelOptions({ applicationName: 'Flow Paper', applicationVersion: app.getVersion(), copyright: 'AGPL-3.0-or-later · LLM for Zotero / EmbedPDF' });
if (!app.requestSingleInstanceLock()) app.exit(0);
let window: BrowserWindow;
let statePath: string;
let pendingSave = Promise.resolve();
let research: ResearchHost;
let notesStore: NotesStore;
let notesError = '';
let readerReady = false;
const pendingLinks: string[] = [];
const noteJobs = new Set<Promise<any>>();
function trackNote<T>(job: Promise<T>) { noteJobs.add(job); void job.finally(() => noteJobs.delete(job)).catch(() => {}); return job; }
const requests = new Map<string, AbortController>();
const requestJobs = new Map<string, Promise<void>>();
const temporary = new Map<string, any>();
let researchContext: any = { activeId: '', selectedIds: [] };
let researchPending: any = { attachments: [] };
const preparations = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: any }>();
function broadcast(channel: string, value?: any) {
  window?.webContents.send(channel, value);
  research?.webContents?.send(channel, value);
}
function cancelOwner(owner: number) {
  for (const [key, controller] of requests) if (key.startsWith(`${owner}:`)) controller.abort();
  for (const key of temporary.keys()) if (key.startsWith(`${owner}:`)) temporary.delete(key);
}
function secureContents(contents: Electron.WebContents) {
  contents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  contents.on('will-navigate', (event, url) => { if (!url.startsWith('su-app://local/')) event.preventDefault(); });
  const owner = contents.id;
  contents.once('destroyed', () => cancelOwner(owner));
}
async function stopOwner(owner: number) {
  cancelOwner(owner);
  await Promise.allSettled([...requestJobs].filter(([key]) => key.startsWith(`${owner}:`)).map(([, job]) => job));
  await pendingSave;
  await Promise.allSettled([...noteJobs]);
}
function secureWindow(target: BrowserWindow) {
  secureContents(target.webContents);
  let closing = false, saving = false;
  target.on('close', event => {
    if (closing) return;
    event.preventDefault();
    if (saving) return;
    saving = true;
    void (async () => {
      try {
        await target.webContents.executeJavaScript('window.__suPaper?.flush?.()');
        await Promise.allSettled([...noteJobs]);
        await research?.destroy();
        await stopOwner(target.webContents.id);
        closing = true; target.close();
      } catch (e: any) { saving = false; dialog.showErrorBox('保存未完成', e.message); }
    })();
  });
}
async function openResearch(options: any = {}) {
  researchPending.attachments.push(...(options.attachments || []));
  if (options.tab) researchPending.tab = options.tab;
  if (options.conversationId) researchPending.conversationId = options.conversationId;
  if (options.noteTarget) researchPending.noteTarget = options.noteTarget;
  await research.open();
}
const state: any = {
  papers: [], notes: '', conversations: [], activeConversation: '',
  noteTargets: [],
  settings: { apiBase: 'https://api.openai.com/v1', model: '', protocol: 'openai_chat_compat', encryptedKey: '' },
};
const publicState = () => ({ ...state, papers: state.papers.map(({ pages, annotations, ...p }: Paper) => p), settings: { apiBase: state.settings.apiBase, model: state.settings.model, protocol: state.settings.protocol, hasKey: !!state.settings.encryptedKey } });
function save() {
  const data = JSON.stringify(state);
  pendingSave = pendingSave.catch(() => {}).then(async () => {
    await writeFile(`${statePath}.tmp`, data, { mode: 0o600 });
    await rename(`${statePath}.tmp`, statePath);
  });
  return pendingSave;
}
function paper(id: string): Paper {
  const p = state.papers.find((p: Paper) => p.id === id);
  if (!p) throw new Error('找不到这篇论文，请重新导入。');
  return p;
}
function noteTarget(ref: any): NoteTarget {
  if (ref?.paperId) return paperTarget(paper(ref.paperId));
  if (ref?.id === 'legacy') return { id: 'legacy', title: '以前的研究笔记', papers: [], kind: 'legacy' };
  const saved = state.noteTargets.find((t: any) => t.id === ref?.id);
  if (!saved) {
    const related = state.papers.find((p: Paper) => paperIdentity(p) === ref?.id);
    if (related) return paperTarget(related);
    throw new Error('请先打开一篇论文。');
  }
  return { ...saved, papers: saved.paperIds.map((id: string) => paper(id)) };
}
async function rememberTarget(target: NoteTarget) {
  if (!state.noteTargets.some((t: any) => t.id === target.id)) {
    state.noteTargets.push({ id: target.id, title: target.title, kind: target.kind, paperIds: target.papers.map(p => p.id) }); await save();
  }
}
function getNotes() { if (notesError) throw new Error(notesError); return notesStore; }
async function loadNote(ref: any) {
  const target = noteTarget(ref); await rememberTarget(target);
  let note = await getNotes().read(target);
  if (target.kind === 'legacy' && !note.exists && !note.missing && state.notes) note = await getNotes().save(target, note.text + '\n' + state.notes, note.revision);
  return note;
}
function openPaperLink(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'flow-paper:' || url.hostname !== 'read') throw new Error('不支持的论文链接。');
  const id = url.searchParams.get('paper') || '', page = Number(url.searchParams.get('page') || 1);
  paper(id); if (!Number.isInteger(page) || page < 1 || page > 100000) throw new Error('页码无效。');
  if (!readerReady) pendingLinks.push(raw);
  else { window.webContents.send('paper:open-source', { id, page }); window.show(); window.focus(); }
}
async function saveAnswer(event: Electron.IpcMainInvokeEvent, request: any) {
  const conversation = request.temporaryId ? temporary.get(`${event.sender.id}:temporary:${request.temporaryId}`)
    : state.conversations.find((c: any) => c.id === request.conversationId);
  const index = conversation?.messages.findIndex((m: any) => m.id === request.messageId && m.role === 'assistant');
  const answer = index >= 0 && conversation.messages[index], question = conversation?.messages[index - 1];
  if (!answer?.content || answer.status !== 'complete' || question?.role !== 'user') throw new Error('请等待回答完整生成后再加入笔记。');
  const attachments = conversation.messages.slice(0, index).filter((m: any) => m.role === 'user').flatMap((m: any) => m.attachments || []);
  const uniqueAttachments = [...new Map(attachments.map((a: any) => [createHash('sha256').update(JSON.stringify(a)).digest('hex'), a])).values()] as any[];
  const ids = [...new Set([...(answer.paperIds || question.paperIds || answer.evidence?.map((e: any) => e.paperId) || []), ...uniqueAttachments.map(a => a.paperId)])] as string[];
  const docs = ids.map(paper);
  const identities = new Set(docs.map(paperIdentity));
  const target: NoteTarget = identities.size === 1 ? paperTarget(docs[0]) : { id: `topic:${conversation.id}`, title: conversation.title || '论文讨论', papers: docs, kind: 'topic' };
  // Flush the editor before appending, so its current draft joins the same file.
  if (research?.webContents && !research.webContents.isDestroyed()) await research.webContents.executeJavaScript('window.__suPaper?.flush?.()');
  await rememberTarget(target);
  const result = await getNotes().append(target, { id: answer.id, question: question.content, answer: answer.content, attachments: uniqueAttachments });
  broadcast('notes:changed', { id: target.id });
  return { ...result, target: target.kind === 'paper' ? { paperId: docs[0].id } : { id: target.id } };
}
async function importPaths(paths: string[]) {
  if (paths.length > 200) throw new Error('请每次导入不超过 200 份 PDF。');
  const imported = [];
  for (const filename of paths) {
    const absolute = path.resolve(filename);
    if (!absolute.toLowerCase().endsWith('.pdf')) continue;
    const info = await stat(absolute);
    if (!info.isFile() || info.size > 250 * 1024 * 1024) throw new Error('基础版支持 250 MB 以内的 PDF。');
    let p = state.papers.find((p: Paper) => p.path === absolute);
    if (!p) {
      p = { id: randomUUID(), title: path.basename(absolute, path.extname(absolute)), path: absolute, source: 'local' };
      state.papers.push(p);
    }
    imported.push(p.id);
  }
  await save();
  return { state: publicState(), imported };
}
async function zotero(endpoint: string) {
  const port = process.env.FLOW_PAPER_TEST_ZOTERO_PORT || '23119';
  if (!/^\d+$/.test(port) || +port < 1 || +port > 65535) throw new Error('Invalid Zotero port');
  const response = await fetch(`http://127.0.0.1:${port}/api/${endpoint}`, { signal: AbortSignal.timeout(12000), headers: { 'Zotero-API-Version': '3' } });
  if (!response.ok) throw new Error(response.status === 403 ? '请在 Zotero → 设置 → 高级中允许本机其他应用通信。' : `Zotero 返回 ${response.status}`);
  return response;
}
async function connectZotero() {
  let items: any[] = [];
  for (let start = 0; ; start += 100) {
    const batch = await (await zotero(`users/0/items?format=json&limit=100&start=${start}`)).json();
    if (!Array.isArray(batch)) throw new Error('Zotero 文献库响应无效。');
    items.push(...batch);
    if (batch.length < 100) break;
  }
  const collections = await (await zotero('users/0/collections?format=json')).json();
  const names = new Map(collections.map((c: any) => [c.key, c.data.name]));
  const byKey = new Map(items.map(i => [i.key, i]));
  for (const item of items) {
    if (item.data.itemType !== 'attachment' || item.data.contentType !== 'application/pdf') continue;
    const parent: any = byKey.get(item.data.parentItem) || item;
    const id = `zotero-${item.key}`;
    const old = state.papers.find((p: Paper) => p.id === id);
    const fields = { id, source: 'zotero', zoteroKey: item.key, parentKey: item.data.parentItem,
      title: parent.data.title || item.data.title || item.data.filename,
      authors: (parent.data.creators || []).map((c: any) => c.lastName || c.name).join(', '),
      year: (parent.data.date || '').match(/\d{4}/)?.[0] || '',
      collections: (parent.data.collections || []).map((k: string) => names.get(k)).filter(Boolean) };
    if (old) Object.assign(old, fields); else state.papers.push(fields);
  }
  await save(); return publicState();
}

function registerHandlers() {
  ipcMain.handle('reader:ready', () => { readerReady = true; for (const url of pendingLinks.splice(0)) { try { openPaperLink(url); } catch (e: any) { dialog.showErrorBox('无法打开论文', e.message); } } });
  ipcMain.handle('notes:config', () => ({ ...(state.notesIntegration || {}), connected: !!state.notesIntegration, error: notesError, targets: state.noteTargets, hasLegacy: !!state.notes }));
  ipcMain.handle('notes:choose-vault', async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择 Obsidian 库目录', properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('notes:configure', async (_event, config) => {
    if (research?.webContents && !research.webContents.isDestroyed()) await research.webContents.executeJavaScript('window.__suPaper?.flush?.()');
    const next = await new NotesStore(config, path.join(app.getPath('userData'), 'note-recovery')).init();
    notesStore = next; notesError = ''; state.notesIntegration = next.config; await save();
    broadcast('notes:changed', { configuration: true }); return next.config;
  });
  ipcMain.handle('notes:load', (_event, ref) => loadNote(ref));
  ipcMain.handle('notes:write', (_event, request) => trackNote((async () => {
    const result = await getNotes().save(noteTarget(request.target), request.text, request.revision);
    broadcast('notes:changed', { id: result.id }); return result;
  })()));
  ipcMain.handle('notes:acknowledge', (_event, ref) => getNotes().acknowledge(noteTarget(ref)));
  ipcMain.handle('notes:answer', (event, request) => trackNote(saveAnswer(event, request)));
  ipcMain.handle('notes:image', (_event, ref, relative) => getNotes().image(noteTarget(ref), relative));
  ipcMain.handle('notes:open-relative', async (_event, ref, relative) => {
    const file = await getNotes().linkedFile(noteTarget(ref), relative);
    if (state.notesIntegration) await shell.openExternal(`obsidian://open?path=${encodeURIComponent(file)}`);
    else { const error = await shell.openPath(file); if (error) throw new Error(error); }
  });
  ipcMain.handle('notes:open', async (_event, ref, conflict = false) => {
    const target = noteTarget(ref); let note = await loadNote(ref);
    if (!note.exists && !note.missing) note = await getNotes().save(target, note.text, note.revision);
    const file = conflict ? note.conflictPath : note.path;
    if (!file) throw new Error('没有可打开的笔记文件。');
    if (state.notesIntegration) await shell.openExternal(`obsidian://open?path=${encodeURIComponent(file)}`);
    else { const error = await shell.openPath(file); if (error) throw new Error(error); }
  });
  ipcMain.handle('state:load', () => publicState());
  ipcMain.handle('research:open', (_e, options) => openResearch(options));
  ipcMain.handle('research:layout', () => research.status);
  ipcMain.handle('research:occlude', (event, value) => { if (event.sender === window.webContents) research.occlude(!!value); });
  ipcMain.handle('research:mode', (_e, mode, point) => research.setMode(mode, point));
  ipcMain.handle('research:hide', () => research.hide());
  ipcMain.handle('research:drag', (event, phase, point) => {
    if (event.sender === research.webContents) return research.dragFloating(phase, point);
  });
  ipcMain.handle('research:resize', (event, width, commit) => {
    if (event.sender === window.webContents) return research.resize(width, commit);
  });
  ipcMain.handle('research:context', (event, context) => {
    if (event.sender !== window.webContents) return;
    researchContext = { activeId: context.activeId || '', selectedIds: context.selectedIds || [] };
    research?.webContents?.send('research:changed');
  });
  ipcMain.handle('research:take', () => {
    const result = { ...researchContext, ...researchPending };
    researchPending = { attachments: [] }; return result;
  });
  ipcMain.handle('paper:open-source', (_e, id, page) => {
    paper(id); window.webContents.send('paper:open-source', { id, page }); window.show(); window.focus();
  });
  ipcMain.handle('research:prepare', async (_e, ids: string[]) => {
    const missing = ids.filter(id => !paper(id).indexed);
    if (!missing.length) return;
    await new Promise<void>((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => { preparations.delete(id); reject(new Error('论文索引超时，请在阅读器中打开后重试。')); }, 120000);
      preparations.set(id, { resolve, reject, timer });
      window.webContents.send('paper:prepare', { id, paperIds: missing });
    });
  });
  ipcMain.handle('research:prepared', (event, id, error) => {
    if (event.sender !== window.webContents) return;
    const pending = preparations.get(id); if (!pending) return;
    clearTimeout(pending.timer); preparations.delete(id);
    error ? pending.reject(new Error(error)) : pending.resolve();
  });
  ipcMain.handle('temporary:close', (event, id: string) => {
    const key = `${event.sender.id}:temporary:${id}`;
    requests.get(key)?.abort(); temporary.delete(key);
  });
  ipcMain.handle('temporary:keep', async (event, id: string) => {
    const key = `${event.sender.id}:temporary:${id}`;
    const session = temporary.get(key);
    if (!session || requests.has(key)) throw new Error('请等待回答结束后再保存。');
    const conversation = { ...session, id: randomUUID(), createdAt: Date.now() };
    state.conversations.push(conversation); state.activeConversation = conversation.id;
    temporary.delete(key); await save(); await openResearch({ conversationId: conversation.id, tab: 'chat' });
  });
  ipcMain.handle('paper:import', async (_e, paths?: string[]) => {
    if (!paths) {
      const result = await dialog.showOpenDialog(window, { title: '添加论文', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF 论文', extensions: ['pdf'] }] });
      paths = result.canceled ? [] : result.filePaths;
    }
    return importPaths(paths);
  });
  ipcMain.handle('paper:read', async (_e, id: string) => {
    const p = paper(id);
    if (p.source === 'zotero') {
      try {
        const url = (await (await zotero(`users/0/items/${p.zoteroKey}/file/view/url`)).text()).trim();
        if (!url.startsWith('file://')) throw new Error('附件尚未下载到本机，请先在 Zotero 中下载。');
        p.path = fileURLToPath(url);
      } catch (e) { if (!p.path) throw e; }
    }
    if (!p.path) throw new Error('附件没有可读取的本地路径。');
    let bytes: Buffer;
    try { bytes = await readFile(p.path); }
    catch (e: any) {
      if (e.code === 'ENOENT') throw new Error(p.source === 'zotero'
        ? '这份 PDF 附件尚未下载到本机，或 Zotero 中的附件路径已失效。请先在 Zotero 中打开并下载它。'
        : '原 PDF 已移动或删除，请从它的新位置重新导入。');
      throw e;
    }
    const fingerprint = createHash('sha256').update(bytes).digest('hex');
    if (p.fingerprint && p.fingerprint !== fingerprint) {
      // A revised PDF must never silently reuse stale text, coordinates or highlights.
      delete p.pages; p.indexed = false; p.annotations = []; p.lastPage = 1;
    }
    p.fingerprint = fingerprint; await save();
    return { bytes: new Uint8Array(bytes), annotations: p.annotations || [], hasAnnotationSnapshot: Array.isArray(p.annotations), lastPage: p.lastPage || 1, indexed: p.indexed };
  });
  ipcMain.handle('paper:index', async (_e, id: string, pages: string[], error?: string) => {
    const p = paper(id); p.pages = pages; p.pageCount = pages.length;
    p.indexed = !error; p.indexError = error || (pages.some(t => t.trim()) ? undefined : '未提取到文字，可能需要 OCR；仍可截图提问。');
    await save(); return publicState();
  });
  ipcMain.handle('paper:annotations', async (_e, id: string, annotations: any[]) => { paper(id).annotations = annotations; await save(); });
  ipcMain.handle('paper:position', async (_e, id: string, pageNumber: number) => { paper(id).lastPage = pageNumber; await save(); });
  ipcMain.handle('zotero:connect', () => connectZotero().catch(e => { throw new Error(`无法连接 Zotero：${e.message}。请保持 Zotero 运行。`); }));
  ipcMain.handle('settings:zotero-models', async () => publicZoteroModels(await zoteroModels()));
  ipcMain.handle('settings:import-zotero', async (_e, id: string) => {
    const model = (await zoteroModels()).find((m: any) => m.id === id);
    if (!model) throw new Error('Zotero 中已找不到所选模型。');
    if (model.protocol === 'codex_responses' && new URL(model.apiBase).origin !== 'https://chatgpt.com') throw new Error('Codex 登录凭证仅可用于 chatgpt.com。');
    if (model.apiKey && !safeStorage.isEncryptionAvailable()) throw new Error('系统钥匙串不可用，无法安全导入 API Key。');
    state.settings = { apiBase: model.apiBase, model: model.model, protocol: model.protocol,
      encryptedKey: model.apiKey ? safeStorage.encryptString(model.apiKey).toString('base64') : '' };
    await save(); broadcast('settings:changed', publicState().settings); return publicState().settings;
  });
  ipcMain.handle('settings:save', async (_e, values: any) => {
    const url = new URL(values.apiBase);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('API 地址必须是 HTTP 或 HTTPS。');
    if (!['openai_chat_compat', 'responses_api', 'anthropic_messages', 'gemini_native', 'ollama_native', 'codex_responses'].includes(values.protocol)) throw new Error('不支持的模型协议。');
    if (values.protocol === 'codex_responses' && url.origin !== 'https://chatgpt.com') throw new Error('Codex 登录凭证仅可用于 chatgpt.com。');
    if (values.apiKey) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统钥匙串不可用，无法安全保存 API Key。');
      state.settings.encryptedKey = safeStorage.encryptString(values.apiKey).toString('base64');
    }
    if (values.clearKey) state.settings.encryptedKey = '';
    Object.assign(state.settings, { apiBase: values.apiBase.trim(), model: values.model.trim(), protocol: values.protocol });
    await save(); broadcast('settings:changed', publicState().settings); return publicState().settings;
  });
  ipcMain.handle('notes:export', async (_e, notes: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog(window, { defaultPath: '研究笔记.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (!canceled && filePath) { await writeFile(filePath, notes); return filePath; }
    return null;
  });
  ipcMain.handle('chat:new', async () => {
    const conversation = { id: randomUUID(), title: '新对话', messages: [], createdAt: Date.now() };
    state.conversations.push(conversation); state.activeConversation = conversation.id; await save(); return publicState();
  });
  ipcMain.handle('chat:cancel', (event, sessionId?: string) => {
    const key = `${event.sender.id}:${sessionId ? `temporary:${sessionId}` : 'chat'}`;
    requests.get(key)?.abort();
  });
  ipcMain.handle('chat:start', async (event, request: any) => {
    const ephemeral = !!request.temporaryId;
    const key = `${event.sender.id}:${ephemeral ? `temporary:${request.temporaryId}` : 'chat'}`;
    if (requests.has(key)) throw new Error('上一条回答还在生成。');
    if (!state.settings.model) throw new Error('请先在模型设置中填写 API 地址和模型名称。');
    let conversation = ephemeral ? temporary.get(key) : state.conversations.find((c: any) => c.id === request.conversationId);
    if (ephemeral && !conversation) {
      conversation = { id: request.temporaryId, title: '新对话', messages: [] };
      temporary.set(key, conversation);
    }
    if (!conversation) throw new Error('请先创建对话。');
    const docs = (request.paperIds || []).map((id: string) => paper(id));
    const sources = prepareContext(docs, request.prompt);
    const attachments = request.attachments || [];
    const selectionContext = attachments.map((a: any) => `\nSelected ${a.kind} from ${a.title}, PDF page ${a.page}. Source link: #source=${a.paperId}&page=${a.page}\n${a.text || ''}`).join('\n');
    const prompt = String(request.prompt).trim();
    if (!prompt && !attachments.length) throw new Error('请输入问题或添加选区。');
    const history = conversation.messages.filter((m: any) => m.status === 'complete').map(historyMessage);
    const paperIds = [...new Set([...docs.map((p: Paper) => p.id), ...attachments.map((a: any) => a.paperId)])];
    const user = { id: randomUUID(), role: 'user', content: prompt || '请解释所选内容。', attachments, paperIds, status: 'complete' };
    const assistant = { id: randomUUID(), role: 'assistant', content: '', paperIds, status: 'streaming', evidence: sources.evidence, coverage: { partial: sources.partial, indexed: sources.indexed, total: sources.total } };
    conversation.messages.push(user, assistant);
    if (conversation.title === '新对话') conversation.title = user.content.slice(0, 30);
    if (!ephemeral) { state.activeConversation = conversation.id; await save(); }
    const controller = new AbortController(); requests.set(key, controller);
    const send = (value: any) => { if (!event.sender.isDestroyed()) event.sender.send('chat:event', { conversationId: conversation.id, temporaryId: ephemeral ? request.temporaryId : undefined, messageId: assistant.id, ...value }); };
    send({ type: 'start', user, assistant });
    const job = (async () => {
      try {
        const apiKey = state.settings.encryptedKey ? safeStorage.decryptString(Buffer.from(state.settings.encryptedKey, 'base64')) : '';
        const outcome = await callLLMStream({ prompt: user.content, context: `${sources.context}\n${selectionContext}`, history,
          apiBase: state.settings.apiBase, apiKey, model: state.settings.model, authMode: state.settings.protocol === 'codex_responses' ? 'codex_auth' : 'api_key',
          providerProtocol: state.settings.protocol, images: attachments.filter((a: any) => a.image).map((a: any) => a.image),
          inputMode: 'vision_allowed', inputTokenCap: 64000, signal: controller.signal,
          requestScope: { conversationKey: ephemeral ? `temporary-${conversation.id}` : conversation.id },
        }, delta => { assistant.content += delta; send({ type: 'delta', delta }); });
        assistant.content = outcome.text || assistant.content;
        assistant.status = controller.signal.aborted ? 'cancelled' : outcome.completion.status === 'complete' ? 'complete' : 'incomplete';
        if (controller.signal.aborted) (assistant as any).error = '已停止生成。';
        send({ type: 'done', assistant });
      } catch (e: any) {
        assistant.status = controller.signal.aborted ? 'cancelled' : 'error';
        (assistant as any).error = assistant.status === 'cancelled' ? '已停止生成。' : e.message;
        send({ type: 'done', assistant });
      } finally { requests.delete(key); if (!ephemeral) await save(); }
    })();
    requestJobs.set(key, job);
    void job.finally(() => requestJobs.delete(key)).catch(() => {});
    return { messageId: assistant.id };
  });
  ipcMain.handle('external:open', (_e, url: string) => {
    if (url.startsWith('flow-paper://')) return openPaperLink(url);
    if (/^https?:\/\//i.test(url) || /^zotero:\/\/(select|open-pdf)\/library\/items\/[A-Z0-9]+(?:\?page=\d+)?$/.test(url)) return shell.openExternal(url);
  });
}

const openFiles: string[] = [];
let readyForFiles = false;
app.on('second-instance', (_event, argv) => {
  window?.show(); window?.focus();
  const files = argv.filter(filename => filename.toLowerCase().endsWith('.pdf'));
  if (files.length && readyForFiles) void importPaths(files).then(() => window.webContents.send('paper:imported'));
  else openFiles.push(...files);
  for (const url of argv.filter(a => a.startsWith('flow-paper://'))) { try { if (readerReady) openPaperLink(url); else pendingLinks.push(url); } catch (e: any) { dialog.showErrorBox('无法打开论文', e.message); } }
});
app.on('open-url', (event, url) => { event.preventDefault(); if (!readerReady) pendingLinks.push(url); else { try { openPaperLink(url); } catch (e: any) { dialog.showErrorBox('无法打开论文', e.message); } } });
app.on('open-file', (event, filename) => {
  event.preventDefault();
  if (readyForFiles) void importPaths([filename]).then(() => window.webContents.send('paper:imported'));
  else openFiles.push(filename);
});
app.whenReady().then(async () => {
  statePath = path.join(app.getPath('userData'), 'workspace.json');
  await mkdir(path.dirname(statePath), { recursive: true });
  try { Object.assign(state, JSON.parse(await readFile(statePath, 'utf8'))); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  if (app.isPackaged && !overrideProfile) app.setAsDefaultProtocolClient('flow-paper');
  try {
    let config = state.notesIntegration;
    if (!config) {
      const vault = path.join(app.getPath('userData'), 'notes');
      await mkdir(path.join(vault, '.obsidian'), { recursive: true });
      const template = path.join(vault, 'paper.md');
      if (!existsSync(template)) await writeFile(template, '---\ntype: paper\nstatus: 在读\ndate: "{{date}}"\n---\n# {{title}}\n\n## 阅读笔记\n');
      config = { vault, folder: '论文', template: 'paper.md' };
    }
    notesStore = await new NotesStore(config, path.join(app.getPath('userData'), 'note-recovery')).init();
  } catch (e: any) { notesError = `无法连接笔记目录：${e.message}`; }
  for (const c of state.conversations) for (const m of c.messages) if (m.status === 'streaming') { m.status = 'cancelled'; m.error = '上次生成被中断。'; }
  const root = __dirname;
  protocol.handle('su-app', request => {
    const url = new URL(request.url);
    const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (url.host !== 'local' || !file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
  registerHandlers();
  window = new BrowserWindow({ width: 1500, height: 980, minWidth: 820, minHeight: 560, title: 'Flow Paper', backgroundColor: '#ffffff',
    webPreferences: { preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  research = new ResearchHost(window, path.join(root, 'preload.cjs'), state.researchLayout, secureContents,
    async layout => { state.researchLayout = layout; await save(); }, stopOwner);
  secureWindow(window);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Flow Paper', submenu: [{ label: '关于 Flow Paper', click: () => app.showAboutPanel() }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit', label: '退出 Flow Paper' }] },
    { role: 'editMenu' }, { role: 'viewMenu' },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { label: '对话与笔记', accelerator: 'CmdOrCtrl+Shift+J', click: () => { void openResearch(); } }] },
    { label: '帮助', submenu: [
      { label: '使用说明', click: () => { void shell.openExternal('https://github.com/xyizhan/flow-paper#readme'); } },
      { label: '项目源码与许可证', click: () => { void shell.openExternal('https://github.com/xyizhan/flow-paper'); } },
    ] },
  ]));
  const files = [...openFiles.splice(0), ...process.argv.filter(a => a.toLowerCase().endsWith('.pdf'))];
  if (files.length) await importPaths(files);
  await window.loadURL('su-app://local/index.html');
  readyForFiles = true;
  if (openFiles.length) { await importPaths(openFiles.splice(0)); window.webContents.send('paper:imported'); }
});
app.on('window-all-closed', () => { for (const controller of requests.values()) controller.abort(); void pendingSave.finally(() => app.quit()); });
