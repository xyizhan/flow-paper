/** Shared file-backed editor. Drafts stay bound to their original paper even
 * when a save, file refresh or reader-tab change finishes asynchronously. */
export function createNotesEditor({ api, markdown, escape, toast, currentPaper }: any) {
  const $ = (id: string) => document.getElementById(id) as any;
  let snapshot: any, ref: any, config: any, metadata = '', dirty = false, edits = 0;
  let timer: any, saving: Promise<any> | undefined, switching = Promise.resolve(), refreshing = false, conflict = false;
  let mode = 'current';
  const text = () => metadata + $('notes-editor').value;
  const status = (s: string) => { $('notes-status').textContent = s; };
  function choices() {
    const p = currentPaper();
    $('note-target').innerHTML = `<option value="current">${escape(p ? p.title : '请打开论文')}</option>` +
      (config?.targets || []).map((t: any) => `<option value="${escape(t.id)}">${escape(t.kind === 'topic' ? '专题 · ' + t.title : t.title)}</option>`).join('') +
      (config?.hasLegacy ? '<option value="legacy">以前的研究笔记</option>' : '');
    if (![...$('note-target').options].some((o: any) => o.value === mode)) mode = 'current';
    $('note-target').value = mode;
    $('notes-open').textContent = config?.connected ? 'Obsidian ↗' : '打开文件 ↗';
  }
  async function preview() {
    const id = snapshot?.id;
    // Adapt portable note links to the upstream renderer's supported local links.
    const body = $('notes-editor').value
      .replace(/<!-- flow-paper-entry:[a-f0-9]{64} -->\s*/g, '')
      .replace(/\]\(flow-paper:\/\/read\?paper=([^)&\s]+)&page=(\d+)\)/g, '](#source=$1&page=$2)');
    const template = document.createElement('template'); template.innerHTML = markdown(body);
    for (const img of template.content.querySelectorAll('img')) {
      img.dataset.noteSource = img.getAttribute('src') || ''; img.removeAttribute('src');
    }
    $('notes-rendered').replaceChildren(template.content);
    for (const img of $('notes-rendered').querySelectorAll('img')) {
      const src = img.dataset.noteSource;
      if (!src || /^(?:[a-z]+:|\/)/i.test(src)) { img.remove(); continue; }
      try { const data = await api.noteImage(ref, src); if (id === snapshot?.id && img.isConnected) img.src = data; } catch { img.alt = '图片暂不可用'; }
    }
  }
  function showConflict(path?: string) {
    $('note-conflict').hidden = !path;
    $('note-conflict-text').textContent = path ? '外部版本已保留；Flow Paper 草稿另存在：' + path.split('/').slice(-2).join('/') : '';
  }
  function apply(note: any) {
    snapshot = note;
    const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(note.text);
    metadata = match?.[0] || '';
    $('notes-editor').value = note.text.slice(metadata.length);
    $('notes-editor').disabled = false; $('notes-open').disabled = false;
    $('note-path').textContent = note.path; $('note-path').title = note.path;
    dirty = false; conflict = false; showConflict(note.conflictPath);
    status(note.missing ? '文件已移动出目录或被删除' : note.exists ? '已保存' : '写入时创建');
    if (!$('notes-rendered').hidden) void preview();
  }
  async function flush(): Promise<void> {
    clearTimeout(timer);
    if (saving) { await saving; if (dirty) return flush(); return; }
    if (!dirty || !snapshot) return;
    const generation = edits, content = text(), captured = ref, expected = snapshot.revision;
    status('保存中…');
    saving = (async () => {
      const result = await api.writeNote({ target: captured, text: content, revision: expected });
      if (result.conflict) {
        conflict = true; snapshot.conflictPath = result.conflictPath; showConflict(result.conflictPath);
        status('有冲突 · 草稿已另存');
        if (edits === generation) dirty = false;
      } else {
        snapshot = result;
        if (edits === generation) { dirty = false; status('已保存'); }
      }
    })().catch(e => { status('保存失败 · 点击重试'); throw e; }).finally(() => { saving = undefined; });
    await saving;
    if (dirty) return flush();
  }
  function choose(next: any, nextMode = mode) {
    const job = switching.catch(() => {}).then(async () => {
      await flush();
      if (conflict) { toast('草稿已另存。请先载入外部版本，再切换笔记。'); $('note-target').value = mode; return; }
      if (!next) { snapshot = undefined; ref = undefined; $('notes-editor').value = ''; $('notes-editor').disabled = true; $('notes-open').disabled = true; $('note-path').textContent = ''; status('请打开论文'); return; }
      const note = await api.loadNote(next);
      ref = next; mode = nextMode; config = await api.notesConfig(); choices(); apply(note);
    });
    switching = job; return job;
  }
  async function refresh() {
    if (refreshing || saving || !ref || !snapshot) return;
    refreshing = true;
    const id = snapshot.id, generation = edits, selectedRef = ref;
    try {
      const note = await api.loadNote(selectedRef);
      if (id !== snapshot?.id || ref !== selectedRef || generation !== edits || saving) return;
      if (note.revision !== snapshot.revision || note.path !== snapshot.path || note.missing !== snapshot.missing) {
        if (dirty || conflict) { status('外部已有修改 · 保存时核对'); return; }
        apply(note); status(note.missing ? '文件已移动出目录或被删除' : '已读入外部修改');
      }
    } catch (e: any) { status('目录不可用 · 草稿保留'); }
    finally { refreshing = false; }
  }
  async function contextChanged(force = false) {
    choices();
    const p = currentPaper();
    if (mode === 'current' && (force || !ref || ref.paperId !== p?.id)) await choose(p ? { paperId: p.id } : null, 'current');
  }
  $('notes-editor').oninput = () => { dirty = true; edits++; status('保存中…'); clearTimeout(timer); timer = setTimeout(() => flush().catch((e: any) => toast(e.message)), 650); };
  $('notes-rendered').onclick = (event: any) => {
    const anchor = event.target.closest('a'), href = anchor?.getAttribute('href');
    if (!href || /^(?:[a-z]+:|#)/i.test(href)) return;
    event.preventDefault(); event.stopPropagation();
    void api.openNoteLink(ref, href).catch((e: any) => toast(e.message));
  };
  $('note-target').onchange = () => {
    const choice = $('note-target').value;
    void choose(choice === 'current' ? currentPaper() ? { paperId: currentPaper().id } : null : { id: choice }, choice).catch((e: any) => toast(e.message));
  };
  $('notes-retry').onclick = () => flush().catch((e: any) => toast(e.message));
  $('notes-preview').onclick = () => { const showing = $('notes-rendered').hidden; $('notes-rendered').hidden = !showing; $('notes-editor').hidden = showing; $('notes-preview').textContent = showing ? '编辑' : '预览'; if (showing) void preview(); };
  $('notes-open').onclick = () => void flush().then(() => api.openNote(ref)).catch((e: any) => toast(e.message));
  $('note-conflict-open').onclick = () => void api.openNote(ref, true).catch((e: any) => toast(e.message));
  $('note-load-external').onclick = () => void flush().then(() => api.acknowledgeNote(ref)).then(apply).catch((e: any) => toast(e.message));
  $('export-notes').onclick = () => void flush().then(() => api.exportNotes(text())).then((file: any) => { if (file) toast('笔记已导出。'); }).catch((e: any) => toast(e.message));
  $('notes-connect').onclick = async () => {
    config = await api.notesConfig();
    $('notes-vault').value = config.vault || ''; $('notes-folder').value = config.folder || 'research/论文'; $('notes-template').value = config.template || 'templates/paper.md';
    $('notes-config-dialog').showModal();
  };
  $('notes-pick-vault').onclick = async () => { const folder = await api.chooseNotesVault(); if (folder) $('notes-vault').value = folder; };
  $('notes-config-close').onclick = () => $('notes-config-dialog').close();
  $('notes-config-form').onsubmit = (event: Event) => {
    event.preventDefault();
    void flush().then(() => api.configureNotes({ vault: $('notes-vault').value, folder: $('notes-folder').value, template: $('notes-template').value }))
      .then(() => { $('notes-config-dialog').close(); toast('已连接 Obsidian 笔记目录。'); }).catch((e: any) => toast(e.message));
  };
  api.onNotes(async (change: any) => {
    try {
      if (change.configuration) { await flush(); config = await api.notesConfig(); snapshot = undefined; await choose(ref || (currentPaper() ? { paperId: currentPaper().id } : null)); }
      else if (change.id === snapshot?.id) await refresh();
    } catch (e: any) { toast(e.message); }
  });
  const poll = setInterval(() => { if (!$('notes-panel').hidden) void refresh(); }, 1200);
  window.addEventListener('beforeunload', () => clearInterval(poll));
  return {
    flush, contextChanged,
    init: async () => { config = await api.notesConfig(); choices(); await contextChanged(); },
    showSaved: async (result: any) => { config = await api.notesConfig(); await choose(result.target, result.target.paperId === currentPaper()?.id ? 'current' : result.id); if (result.conflict) { showConflict(result.conflictPath); toast('外部笔记已有修改，问答已另存到冲突副本。'); } },
  };
}
