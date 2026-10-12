import EmbedPDF from '@embedpdf/snippet';
import DOMPurify from 'dompurify';
import { renderMarkdown } from '../vendor/llm-for-zotero/src/utils/markdown';
import { createQuickChat } from './quick-chat';
import { createNotesEditor } from './notes-editor';
import { installResearchLayout } from './research-layout';
import { installStandaloneSidebarResizeBehavior } from '../vendor/llm-for-zotero/src/modules/contextPanel/standaloneWindowSizing';
import { resizeTextareaToContent } from '../vendor/llm-for-zotero/src/modules/contextPanel/textareaSizing';
import { coalesceCommandUpdates, preserveClosingViewState } from './viewer-adapter';
declare global { interface Window { paper: any; __suPaper?: any } }
const api = window.paper;
const researchMode = new URLSearchParams(location.search).get('view') === 'research';
document.body.classList.toggle('research-mode', researchMode);
const $ = (id: string) => document.getElementById(id) as any;
const escape = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
const markdown = (s: string) => DOMPurify.sanitize(renderMarkdown(s), { ADD_TAGS: ['annotation'], ADD_ATTR: ['xmlns', 'encoding'], ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|flow-paper|zotero):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i });
let state: any, registry: any, docs: any, engine: any;
let activeId = '', conversationId = '', streaming = false, selection: any = null;
const selected = new Set<string>();
let attachments: any[] = [];
const annotationTimers = new Map<string, any>();
const annotationSnapshots = new Map<string, Promise<any>>();
const annotationSubscriptions = new Map<string, () => void>();
const positions = new Map<string, number>();
let positionTimer: any;
const opening = new Map<string, Promise<any>>();
let indexing = false, toastTimer: any;
let activationRequest = 0, selectionGeneration = 0;
let quick: ReturnType<typeof createQuickChat>, selectionAnchor = { x: 350, y: 200 };
let notes: ReturnType<typeof createNotesEditor>;
let pendingConversation = '';

function toast(message: string) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6000); }
async function safe(task: () => any) { try { return await task(); } catch (e: any) { console.error(e); toast(e.message || String(e)); } }
const getPaper = (id = activeId) => state.papers.find((p: any) => p.id === id);
const capability = (name: string) => registry.getPlugin(name)?.provides();
const activeConversation = () => state.conversations.find((c: any) => c.id === conversationId);
const sourceLink = (id: string, page: number) => `#source=${encodeURIComponent(id)}&page=${page}`;

function renderLibrary() {
  const query = $('library-search').value.toLowerCase();
  const collection = $('collection-filter').value;
  $('paper-count').textContent = state.papers.length;
  const collectionNames = [...new Set(state.papers.flatMap((p: any) => p.collections || []))] as string[];
  $('collection-filter').innerHTML = '<option value="">全部分类</option>' + collectionNames.map(n => `<option ${n === collection ? 'selected' : ''} value="${escape(n)}">${escape(n)}</option>`).join('');
  const papers = state.papers.filter((p: any) => `${p.title} ${p.authors || ''}`.toLowerCase().includes(query) && (!collection || p.collections?.includes(collection)));
  $('library-list').innerHTML = papers.length ? papers.map((p: any) => `<div class="paper-card ${p.id === activeId ? 'active' : ''}" data-id="${escape(p.id)}" title="${escape(p.title)}"><input type="checkbox" aria-label="将 ${escape(p.title)} 加入比较" ${selected.has(p.id) ? 'checked' : ''}><div><div class="paper-name">${escape(p.title)}</div><div class="paper-meta" title="${escape(p.indexError || '')}">${[p.year, p.pageCount ? p.pageCount + ' 页' : '', p.indexError ? '附件不可用' : p.indexed ? '已索引' : p.source === 'zotero' ? 'Zotero' : 'PDF'].filter(Boolean).map(escape).join(' · ')}</div></div></div>`).join('') : '<div class="empty-library">暂无论文</div>';
  $('index-status').textContent = `${state.papers.filter((p: any) => p.indexed).length} / ${state.papers.length} 篇已索引`;
  updateScope();
  if (!researchMode) void api.updateContext({ activeId, selectedIds: [...selected] });
}
function updateScope() {
  const scope = $('chat-scope').value;
  $('scope-label').textContent = scope === 'library' ? `文献库 · ${state.papers.filter((p: any) => p.indexed).length} 篇` : scope === 'selected' ? `已勾选 ${selected.size} 篇论文` : getPaper()?.title || '未选择论文';
}
function renderConversations() {
  $('conversation-select').innerHTML = (!state.conversations.length ? '<option value="">新对话</option>' : '') + [...state.conversations].reverse().map((c: any) => `<option value="${escape(c.id)}" ${c.id === conversationId ? 'selected' : ''}>${escape(c.title)}</option>`).join('');
}
function renderMessages() {
  const messages = activeConversation()?.messages || [];
  $('messages').innerHTML = messages.length ? messages.map((m: any) => `<article class="message ${m.role}" data-message="${m.id}"><div class="message-label">${m.role === 'user' ? '你' : '回答'}${m.status === 'streaming' ? '<span>生成中…</span>' : ''}</div>${m.attachments?.map((a: any) => a.image ? `<img alt="论文截图" src="${a.image}">` : `<div class="coverage">选区 · ${escape(a.title)}，第 ${a.page} 页</div>`).join('') || ''}<div class="bubble ${m.role === 'assistant' ? 'markdown' : ''}">${m.role === 'assistant' ? markdown(m.content || '…') : escape(m.content)}</div>${m.error ? `<div class="message-error">${escape(m.error)}</div>` : ''}${m.status === 'incomplete' ? '<div class="message-error">模型未完整生成回答，可继续追问。</div>' : ''}${m.evidence?.length ? `<details class="evidence"><summary>本次提供 ${m.evidence.length} 个页面的证据${m.coverage?.partial ? ' · 部分检索' : ''}</summary>${m.evidence.map((e: any) => `<a href="${sourceLink(e.paperId, e.page)}">${escape(e.title)} · 第 ${e.page} 页</a>`).join('')}</details>` : ''}${m.role === 'assistant' && m.content ? `<div class="message-actions"><button class="quiet" data-note="${m.id}">＋ 加入笔记</button><button class="quiet" data-copy="${m.id}">复制</button></div>` : ''}</article>`).join('') : '<div class="chat-empty">输入问题，或从论文中添加选区</div>' ;
  $('messages').scrollTop = $('messages').scrollHeight;
}
let renderTimer: any;
function scheduleMessages() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    const message = activeConversation()?.messages.at(-1);
    const bubble = message && document.querySelector(`[data-message="${message.id}"] .bubble`);
    if (!bubble || message.status !== 'streaming') return;
    const bottom = $('messages').scrollHeight - $('messages').scrollTop - $('messages').clientHeight < 100;
    bubble.innerHTML = markdown(message.content || '…');
    if (bottom) $('messages').scrollTop = $('messages').scrollHeight;
  }, 120);
}
function renderAttachments() {
  $('attachments').innerHTML = attachments.map((a, i) => `<div class="attachment-chip">${a.image ? `<img alt="选区" src="${a.image}">` : '❝'}<span>${escape(a.image ? `${a.title} · p.${a.page}` : a.text)}</span><button data-remove="${i}" aria-label="移除附件">×</button></div>`).join('');
}
function setStreaming(value: boolean) { streaming = value; $('send-button').hidden = value; $('stop-button').hidden = !value; $('new-chat').disabled = value; $('conversation-select').disabled = value; }
async function reload() { state = await api.load(); renderLibrary(); renderConversations(); }

function encodeBinary(value: any): any {
  if (value instanceof Date) return { __suDate: value.toISOString() };
  if (value instanceof ArrayBuffer) return { __suBytes: Array.from(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) return { __suBytes: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  if (Array.isArray(value)) return value.map(encodeBinary);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k, encodeBinary(v)]));
  return value;
}
function decodeBinary(value: any): any {
  if (value?.__suDate) return new Date(value.__suDate);
  if (value?.__suBytes) return new Uint8Array(value.__suBytes).buffer;
  if (Array.isArray(value)) return value.map(decodeBinary);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, decodeBinary(v)]));
  return value;
}
async function indexDocument(id: string) {
  const doc = docs.getDocument(id);
  if (!doc || getPaper(id)?.indexed) return;
  const pages = [];
  try {
    for (const page of doc.pages) {
      pages.push(await engine.extractText(doc, [page.index]).toPromise());
      $('index-status').textContent = `提取文字 ${pages.length} / ${doc.pages.length} 页`;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    state = await api.index(id, pages); renderLibrary();
  } catch (e: any) { state = await api.index(id, pages, '文字提取失败：' + e.message); renderLibrary(); }
}
async function openPaper(id: string, pageNumber?: number, activate = true) {
  if (researchMode) return api.openSource(id, pageNumber);
  const request = activate ? ++activationRequest : 0;
  const shouldActivate = () => activate && request === activationRequest;
  if (opening.has(id)) await opening.get(id);
  if (!docs.isDocumentOpen(id)) {
    const promise = (async () => {
      const p = getPaper(id); const data = await api.readPdf(id);
      p.indexed = data.indexed;
      const bytes = new Uint8Array(data.bytes);
      const response = await docs.openDocumentBuffer({ buffer: bytes.buffer, documentId: id, name: p.title, autoActivate: shouldActivate() }).toPromise();
      await response.task.toPromise();
      const annotationApi = capability('annotation').forDocument(id);
      // Wait for the viewer's initial annotation load before restoring a snapshot.
      await engine.getAllAnnotations(docs.getDocument(id)).toPromise();
      if (data.hasAnnotationSnapshot) {
        const saved = decodeBinary(data.annotations);
        const savedIds = new Set(saved.map((x: any) => x.annotation.id));
        const existing = annotationApi.getAnnotations();
        for (const item of existing) {
          if (!savedIds.has(item.object.id)) annotationApi.deleteAnnotation(item.object.pageIndex, item.object.id);
        }
        const fresh = [];
        for (const item of saved) {
          const current = annotationApi.getAnnotationById(item.annotation.id);
          if (!current) fresh.push(item);
          else if (JSON.stringify(encodeBinary(current.object)) !== JSON.stringify(encodeBinary(item.annotation))) {
            annotationApi.updateAnnotation(item.annotation.pageIndex, item.annotation.id, item.annotation);
          }
        }
        if (fresh.length) annotationApi.importAnnotations(fresh);
      }
      annotationSubscriptions.set(id, annotationApi.onAnnotationEvent((event: any) => {
        if (event.type === 'loaded' || event.committed === false) return;
        // Snapshot while the document still exists; closing its tab must not lose a recent mark.
        annotationSnapshots.set(id, annotationApi.exportAnnotations().toPromise().then(encodeBinary));
        clearTimeout(annotationTimers.get(id));
        annotationTimers.set(id, setTimeout(() => safe(async () => {
          await api.saveAnnotations(id, await annotationSnapshots.get(id));
          annotationTimers.delete(id);
        }), 350));
      }));
      if (shouldActivate()) capability('scroll').forDocument(id).scrollToPage({ pageNumber: pageNumber || data.lastPage, behavior: 'instant' });
      await indexDocument(id);
    })();
    opening.set(id, promise);
    try { await promise; } finally { opening.delete(id); }
  }
  if (shouldActivate()) {
    docs.setActiveDocument(id); activeId = id;
    if (pageNumber) capability('scroll').forDocument(id).scrollToPage({ pageNumber, behavior: 'smooth' });
    updateActive();
  }
}
function updateActive() {
  activeId = docs.getActiveDocumentId() || '';
  $('reader-empty').hidden = !!activeId;
  $('paper-title').textContent = getPaper()?.title || '文献库';
  $('capture-button').disabled = !activeId;
  selectionGeneration++; selection = null; $('selection-button').disabled = true; quick?.close();
  renderLibrary();
}
async function importFiles(paths?: string[]) {
  const result = await api.importFiles(paths); state = result.state; renderLibrary();
  if (result.imported.length) await openPaper(result.imported[0]);
  if (result.imported.length > 1) toast(`已添加 ${result.imported.length} 篇论文。可点击“索引文献”建立多篇检索。`);
}
async function setupReader() {
  const viewer = EmbedPDF.init({ type: 'container', target: $('pdf-viewer'), wasmUrl: 'su-app://local/pdfium.wasm', worker: true, fontFallback: null,
    theme: { preference: 'light' }, tabBar: 'multiple', annotations: { author: 'Flow Paper' },
    zoom: { defaultZoomLevel: 'fit-width' as any },
    fonts: { ui: null, signature: null }, stamp: { defaultLibrary: false, libraries: [], manifests: [] },
    disabledCategories: ['document-open', 'redaction', 'annotation-stamp', 'signature'],
    capture: { scale: 2, withAnnotations: false }, i18n: { defaultLocale: 'zh-CN' },
  });
  registry = await viewer!.registry; engine = registry.getEngine(); docs = capability('document-manager');
  coalesceCommandUpdates(registry); preserveClosingViewState(registry);
  docs.onActiveDocumentChanged(updateActive);
  docs.onDocumentClosed((id: string) => { annotationSubscriptions.get(id)?.(); annotationSubscriptions.delete(id); });
  docs.onDocumentError((e: any) => toast(`PDF 打开失败：${e.message}`));
  capability('scroll').onPageChange((e: any) => {
    if (!getPaper(e.documentId)) return;
    positions.set(e.documentId, e.pageNumber);
    clearTimeout(positionTimer); positionTimer = setTimeout(() => safe(savePositions), 750);
  });
  capability('selection').onEndSelection(async (event: any) => {
    if (event.modeId !== 'pointerMode') return;
    const generation = ++selectionGeneration;
    await safe(async () => {
      const scope = capability('selection').forDocument(event.documentId);
      const ranges = scope.getFormattedSelection();
      if (!ranges.length) return;
      const text = (await scope.getSelectedText().toPromise()).join('\n').trim();
      if (text && generation === selectionGeneration && event.documentId === activeId) {
        selection = { kind: 'text', paperId: event.documentId, title: getPaper(event.documentId)?.title, page: (ranges[0]?.pageIndex || 0) + 1, text, ranges };
        $('selection-button').disabled = false;
        quick.show(selection, selectionAnchor);
      }
    });
  });
  capability('capture').onCaptureArea(async (event: any) => {
    dismissCapturePreview();
    const image = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(event.blob); });
    const captured = { kind: 'image', paperId: event.documentId, title: getPaper(event.documentId)?.title, page: event.pageIndex + 1, image, rect: event.rect };
    quick.show(captured, selectionAnchor); quick.expand();
    capability('capture').forDocument(event.documentId).disableMarqueeCapture();

  });
}

async function savePositions() {
  const changed = [...positions]; positions.clear();
  await Promise.all(changed.map(([id, page]) => api.savePosition(id, page)));
}

function dismissCapturePreview() {
  // EmbedPDF 2.15.1 opens a download preview for every capture. Invoke its own close
  // handler after mount so it releases Blob URLs; the chat already provides a preview.
  const root = $('pdf-viewer').querySelector('embedpdf-container')?.shadowRoot;
  if (!root) return;
  const close = () => root.querySelectorAll('img[alt="Captured PDF area"]').forEach((img: Element) => {
    (img.closest('.fixed')?.querySelector('button') as HTMLButtonElement | null)?.click();
  });
  const observer = new MutationObserver(close); observer.observe(root, { childList: true, subtree: true });
  close(); setTimeout(() => observer.disconnect(), 1500);
}

async function send() {
  if (streaming) return;
  const prompt = $('prompt').value.trim();
  if (!prompt && !attachments.length) return;
  if (!state.settings.model) { showSettings(); return; }
  const scope = $('chat-scope').value;
  const ids = scope === 'library' ? state.papers.filter((p: any) => p.indexed).map((p: any) => p.id) : scope === 'selected' ? [...selected] : activeId ? [activeId] : [];
  if (!ids.length && !attachments.length && !activeConversation()?.messages.some((m: any) => m.role === 'user' && m.status === 'complete')) { toast('请先打开或勾选论文。'); return; }
  setStreaming(true);
  try {
    await api.prepare(ids);
    if (!conversationId) { state = await api.newChat(); conversationId = state.activeConversation; renderConversations(); }
    await api.chat({ conversationId, prompt, paperIds: ids, attachments });
    $('prompt').value = ''; resizeTextareaToContent($('prompt')); attachments = []; renderAttachments();
  } catch (e) { setStreaming(false); throw e; }
}
function showSettings() {
  $('api-base').value = state.settings.apiBase; $('model-name').value = state.settings.model; $('protocol').value = state.settings.protocol; $('api-key').value = '';
  $('key-status').textContent = state.settings.protocol === 'codex_responses' ? '使用本机已有 Codex 登录，无需填写 API Key。' : state.settings.hasKey ? '已保存 API Key。留空表示继续使用。' : '本地 Ollama 可不填写 Key；截图问答需要支持图像的模型。';
  if (!researchMode) void api.occludeResearch(true);
  $('settings-dialog').showModal();
}
function switchTab(notes: boolean) {
  $('chat-panel').hidden = notes; $('notes-panel').hidden = !notes;
  $('notes-tab').classList.toggle('active', notes); $('chat-tab').classList.toggle('active', !notes);
}
async function addNote(messageId: string) {
  const result = await api.saveAnswer({ conversationId, messageId });
  await notes.showSaved(result); switchTab(true); toast(result.duplicate ? '这条问答已保存。' : result.conflict ? '问答已另存到冲突副本。' : '问答已保存到论文笔记。');
}

async function init() {
  state = await api.load(); conversationId = state.activeConversation;
  installResearchLayout(api, researchMode);

  $('model-indicator').classList.toggle('ready', !!state.settings.model);
  if (researchMode) { notes = createNotesEditor({ api, markdown, escape, toast, currentPaper: () => getPaper() }); await notes.init(); }
  renderLibrary(); renderConversations(); renderMessages();
  if (researchMode) { $('paper-title').textContent = '对话与笔记'; document.title = '对话 — Flow Paper'; }
  else {
    quick = createQuickChat({ api, markdown, escape, ready: () => !!state.settings.model, settings: showSettings, toast });
    installStandaloneSidebarResizeBehavior(window, document.querySelector('.workspace')!, document.querySelector('.library')!, $('library-divider'), {
      initialWidth: Number(localStorage.getItem('libraryWidth')) || 260, minWidth: 210, maxWidth: 400, minContentWidth: 550,
      onWidthCommit: width => localStorage.setItem('libraryWidth', String(width)),
    });
    for (const type of ['pointermove', 'pointerup']) $('pdf-viewer').addEventListener(type, (e: PointerEvent) => { selectionAnchor = { x: e.clientX - 70, y: e.clientY + 45 }; }, true);
  }
  $('toggle-library').onclick = () => { quick?.close(); document.body.classList.toggle('library-hidden'); };
  $('open-chat').onclick = () => safe(() => api.openResearch({ tab: 'chat' }));
  $('open-notes').onclick = () => safe(() => api.openResearch({ tab: 'notes' }));
  $('import-button').onclick = $('empty-import').onclick = () => safe(() => importFiles());
  $('zotero-button').onclick = () => safe(async () => { $('zotero-button').disabled = true; try { state = await api.connectZotero(); renderLibrary(); toast(`已连接 Zotero，读取 ${state.papers.filter((p: any) => p.source === 'zotero').length} 份 PDF 附件。`); } finally { $('zotero-button').disabled = false; } });
  $('library-search').oninput = renderLibrary; $('collection-filter').onchange = renderLibrary;
  $('library-list').onclick = (event: any) => { const card = event.target.closest('[data-id]'); if (!card) return; if (event.target.type === 'checkbox') { event.target.checked ? selected.add(card.dataset.id) : selected.delete(card.dataset.id); if (selected.size) $('chat-scope').value = 'selected'; updateScope(); void api.updateContext({ activeId, selectedIds: [...selected] }); } else void safe(() => openPaper(card.dataset.id)); };
  $('chat-scope').onchange = updateScope;
  $('selection-button').onclick = () => { if (selection) { quick.show(selection, selectionAnchor); quick.expand(); } };
  $('capture-button').onclick = () => { quick.close(); capability('capture').forDocument(activeId).toggleMarqueeCapture(); toast('在论文页面上拖动框选图表或公式。'); };
  $('attachments').onclick = (e: any) => { const b = e.target.closest('[data-remove]'); if (b) { attachments.splice(Number(b.dataset.remove), 1); renderAttachments(); } };
  $('send-button').onclick = () => safe(send); $('stop-button').onclick = () => api.cancel();
  $('prompt').oninput = () => resizeTextareaToContent($('prompt'));
  $('prompt').onkeydown = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void safe(send); } };
  $('messages').onclick = (event: any) => { const button = event.target.closest('button'); if (!button) return; if (button.dataset.prompt) { $('prompt').value = button.dataset.prompt; $('prompt').focus(); } if (button.dataset.note) void safe(() => addNote(button.dataset.note)); if (button.dataset.copy) void navigator.clipboard.writeText(activeConversation().messages.find((m: any) => m.id === button.dataset.copy).content).then(() => toast('已复制。')); };
  $('conversation-select').onchange = () => { conversationId = $('conversation-select').value; renderMessages(); };
  $('new-chat').onclick = () => safe(async () => { state = await api.newChat(); conversationId = state.activeConversation; attachments = []; renderConversations(); renderMessages(); renderAttachments(); });
  $('settings-dialog').addEventListener('close', () => { if (!researchMode) void api.occludeResearch(false); });
  $('settings-button').onclick = showSettings; $('close-settings').onclick = () => $('settings-dialog').close();
  $('load-zotero-models').onclick = () => safe(async () => {
    const models = await api.zoteroModels();
    if (!models.length) throw new Error('Zotero 插件中没有可导入的模型。');
    $('zotero-models').innerHTML = models.map((m: any) => `<option value="${escape(m.id)}" ${m.preferred ? 'selected' : ''}>${escape(m.model)} · ${escape(new URL(m.apiBase).hostname)}</option>`).join('');
    $('zotero-model-import').hidden = false;
  });
  $('import-zotero-model').onclick = () => safe(async () => {
    state.settings = await api.importZoteroModel($('zotero-models').value);
    $('settings-dialog').close(); $('model-indicator').classList.add('ready'); toast(`已导入 ${state.settings.model}${state.settings.protocol === 'codex_responses' ? '，使用本机已有 Codex 登录。' : '，API Key 已加密保存。'}`);
  });
  $('settings-form').onsubmit = (e: Event) => { e.preventDefault(); void safe(async () => { state.settings = await api.saveSettings({ apiBase: $('api-base').value, model: $('model-name').value, protocol: $('protocol').value, apiKey: $('api-key').value }); $('settings-dialog').close(); $('model-indicator').classList.add('ready'); toast('模型设置已保存。'); }); };
  $('protocol').onchange = () => { if ($('protocol').value === 'ollama_native') $('api-base').value = 'http://127.0.0.1:11434'; };
  $('clear-key').onclick = () => safe(async () => { state.settings = await api.saveSettings({ ...state.settings, clearKey: true }); $('key-status').textContent = '已清除 API Key。'; });
  $('notes-tab').onclick = () => switchTab(true); $('chat-tab').onclick = () => switchTab(false);
  $('index-all').onclick = () => safe(async () => {
    if (indexing) return; indexing = true; $('index-all').disabled = true;
    const previous = activeId; let skipped = 0;
    try {
      for (const p of state.papers.filter((p: any) => !p.indexed)) {
        try { await openPaper(p.id, undefined, false); }
        catch (e: any) { skipped++; state = await api.index(p.id, [], e.message); renderLibrary(); }
        finally { if (p.id !== previous && docs.isDocumentOpen(p.id)) await docs.closeDocument(p.id).toPromise(); }
      }
      toast(`文献索引完成${skipped ? `，${skipped} 份不可读取的附件已跳过。` : '。'}`);
    } finally { indexing = false; $('index-all').disabled = false; if (previous) await openPaper(previous); }
  });
  document.addEventListener('click', (event: any) => { const a = event.composedPath().find((n: any) => n?.tagName === 'A'); if (!a) return; const href = a.getAttribute('href') || ''; if (href.startsWith('#source=')) { event.preventDefault(); const query = new URLSearchParams(href.slice(1)); void safe(() => openPaper(query.get('source')!, Number(query.get('page')) || 1)); } else if (/^(https?|flow-paper|zotero):\/\//i.test(href)) { event.preventDefault(); void api.openExternal(href); } });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { e.preventDefault(); const paths = Array.from(e.dataTransfer?.files || []).map(f => api.filePath(f)); if (paths.length) void safe(() => importFiles(paths)); });
  api.onStream((event: any) => {
    if (event.temporaryId || !researchMode) return;
    const c = state.conversations.find((c: any) => c.id === event.conversationId); if (!c) return;
    if (event.type === 'start') { c.messages.push(event.user, event.assistant); if (c.title === '新对话') c.title = event.user.content.slice(0, 30); renderConversations(); renderMessages(); }
    const m = c.messages.find((m: any) => m.id === event.messageId);
    if (event.type === 'delta' && m) m.content += event.delta;
    if (event.type === 'done' && m) {
      Object.assign(m, event.assistant); setStreaming(false); renderMessages();
      if (pendingConversation) void safe(async () => {
        const id = pendingConversation; pendingConversation = '';
        const loaded = await api.load(); state.conversations = loaded.conversations; conversationId = id;
        renderConversations(); renderMessages();
      });
    }
    if (conversationId === event.conversationId) scheduleMessages();
  });
  api.onImported(() => safe(reload));
  api.onSettings((settings: any) => { state.settings = settings; $('model-indicator').classList.toggle('ready', !!settings.model); });
  if (researchMode) {
    const receive = async () => {
      const next = await api.takeResearch(); const loaded = await api.load();
      state.papers = loaded.papers; state.settings = loaded.settings;
      activeId = next.activeId;
      await notes.contextChanged();
      const selectionChanged = JSON.stringify([...selected]) !== JSON.stringify(next.selectedIds);
      selected.clear(); next.selectedIds.forEach((id: string) => selected.add(id));
      if (selectionChanged && selected.size) $('chat-scope').value = 'selected';
      if (next.attachments.length) { attachments.push(...next.attachments); renderAttachments(); }
      if (next.conversationId && !streaming) {
        state.conversations = loaded.conversations; conversationId = next.conversationId;
        renderConversations(); renderMessages();
      }
      else if (next.conversationId) { pendingConversation = next.conversationId; toast('已保存；当前回答结束后打开'); }
      if (next.tab) switchTab(next.tab === 'notes');
      if (next.noteTarget) await notes.showSaved(await api.loadNote(next.noteTarget).then((note: any) => ({ ...note, target: next.noteTarget })));
      updateScope();
    };
    api.onResearch(() => safe(receive)); await receive();
  } else {
    api.onSource(({ id, page }: any) => safe(() => openPaper(id, page)));
    api.onPrepare(async ({ id, paperIds }: any) => {
      try { for (const paperId of paperIds) await openPaper(paperId, undefined, false); await api.prepared(id); }
      catch (e: any) { await api.prepared(id, e.message); }
    });
    await setupReader();
  }
  const flush = async () => {
    clearTimeout(positionTimer); if (!researchMode) await savePositions();
    if (researchMode) await notes.flush();
    for (const [id, timer] of annotationTimers) {
      clearTimeout(timer);
      await api.saveAnnotations(id, await annotationSnapshots.get(id));
    }
  };
  window.__suPaper = { openPaper, importFiles, registry, capability, flush, getState: () => state };
  if (!researchMode && state.papers.length) await safe(() => openPaper(state.papers[0].id));
  if (!researchMode) await api.readerReady();
}
void init().catch(e => { console.error(e); toast(`启动失败：${e.message}`); });
