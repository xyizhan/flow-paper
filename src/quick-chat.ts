import { positionMenuAtPointer } from '../vendor/llm-for-zotero/src/modules/contextPanel/menuPositioning';
import { resizeTextareaToContent } from '../vendor/llm-for-zotero/src/modules/contextPanel/textareaSizing';

// The upstream floating-menu geometry and composer sizing run unchanged. Electron
// IPC supplies an in-memory session; only the explicit Keep action persists it.
export function createQuickChat({ api, markdown, escape, ready, settings, toast }: any) {
  const $ = (id: string) => document.getElementById(id) as any;
  const menu = $('quick-menu'), panel = $('quick-panel'), answer = $('quick-answer');
  let attachment: any, session = '', busy = false, current: any, messages: any[] = [];
  let anchor = { x: 300, y: 220 }, paintTimer: any, drag: any;
  const bounds = () => document.querySelector('.reader-area')!;
  function place(element: any, x = anchor.x, y = anchor.y) {
    element.style.maxWidth = `${Math.max(200, bounds().getBoundingClientRect().width - 16)}px`;
    positionMenuAtPointer(bounds(), element, x, y);
  }
  function setBusy(value: boolean) {
    busy = value; $('quick-send').hidden = value; $('quick-stop').hidden = !value;
    $('quick-keep').disabled = value; $('quick-actions').hidden = !current?.content;
  }
  function paint() {
    const nearBottom = answer.scrollHeight - answer.scrollTop - answer.clientHeight < 70;
    answer.innerHTML = messages.map((m: any) => m.role === 'user'
      ? `<div class="quick-turn">${escape(m.content.startsWith('请将所选内容翻译') ? '译文' : m.content.startsWith('请用中文简洁解释所选内容') ? '解释' : m.content)}</div>`
      : `${markdown(m.content || (m.status === 'streaming' ? '…' : ''))}${m.error ? `<div class="quick-error">${escape(m.error)}</div>` : ''}`).join('');
    if (nearBottom) answer.scrollTop = answer.scrollHeight;
    $('quick-actions').hidden = !current?.content;
  }
  function close() {
    const previous = session; session = '';
    if (previous) void api.closeTemporary(previous);
    clearTimeout(paintTimer); paintTimer = null;
    menu.hidden = panel.hidden = true; attachment = null; current = null; messages = [];
    answer.replaceChildren(); $('quick-source').replaceChildren(); $('quick-prompt').value = ''; setBusy(false);
  }
  function show(a: any, point = anchor) {
    close(); attachment = a; anchor = point; session = crypto.randomUUID();
    menu.hidden = false; place(menu);
  }
  function expand() {
    if (!attachment) return;
    menu.hidden = true; panel.hidden = false;
    $('quick-source').innerHTML = attachment.image ? `<img src="${attachment.image}" alt="临时截图">` : escape(attachment.text);
    $('quick-source').title = `${attachment.title} · 第 ${attachment.page} 页`;
    $('quick-prompt').value = ''; resizeTextareaToContent($('quick-prompt'));
    place(panel); $('quick-prompt').focus();
  }
  // Streaming changes the popover height after its initial placement. Keep its
  // composer inside the viewport, including when selecting the bottom line.
  new ResizeObserver(() => {
    if (panel.hidden) return;
    const rect = panel.getBoundingClientRect();
    if (rect.bottom > innerHeight - 8 || rect.right > innerWidth - 8) place(panel, rect.x, rect.y);
  }).observe(panel);
  async function send(prompt: string) {
    if (busy || !attachment || !prompt.trim()) return;
    if (!ready()) { settings(); return; }
    const id = session; setBusy(true);
    try {
      await api.chat({ temporaryId: id, prompt, paperIds: [], attachments: messages.length ? [] : [attachment] });
      if (id === session) { $('quick-prompt').value = ''; resizeTextareaToContent($('quick-prompt')); }
    } catch (e: any) {
      if (id !== session) return;
      setBusy(false); answer.textContent = e.message; toast(e.message);
    }
  }
  $('quick-translate').onclick = () => { expand(); void send('请将所选内容翻译成自然、准确的中文。只给译文，保留公式和专业术语。'); };
  $('quick-explain').onclick = () => { expand(); void send('请用中文简洁解释所选内容，说明其中的概念和含义。'); };
  $('quick-ask').onclick = expand;
  $('quick-to-chat').onclick = async () => { const a = attachment; close(); await api.openResearch({ attachments: [a], tab: 'chat' }); };
  $('quick-close').onclick = close;
  $('quick-form').onsubmit = (e: Event) => { e.preventDefault(); void send($('quick-prompt').value); };
  $('quick-prompt').oninput = () => resizeTextareaToContent($('quick-prompt'));
  $('quick-prompt').onkeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void send($('quick-prompt').value); }
  };
  $('quick-stop').onclick = () => api.cancel(session);
  $('quick-copy').onclick = () => { if (current?.content) void navigator.clipboard.writeText(current.content).then(() => toast('已复制')); };
  $('quick-note').onclick = async () => {
    if (!current?.content || !attachment) return;
    const text = `${attachment.title} · [第 ${attachment.page} 页](#source=${encodeURIComponent(attachment.paperId)}&page=${attachment.page})\n\n${current.content}`;
    try { await api.appendNotes(text); toast('已加入笔记'); } catch (e: any) { toast(e.message); }
  };
  $('quick-keep').onclick = async () => {
    try { await api.keepTemporary(session); close(); } catch (e: any) { toast(e.message); }
  };
  api.onStream((event: any) => {
    if (!session || event.temporaryId !== session) return;
    if (event.type === 'start') { messages.push(event.user, event.assistant); current = event.assistant; paint(); }
    if (event.type === 'delta' && current) {
      current.content += event.delta;
      if (!paintTimer) paintTimer = setTimeout(() => { paintTimer = null; paint(); }, 90);
    }
    if (event.type === 'done') { clearTimeout(paintTimer); paintTimer = null; Object.assign(current, event.assistant); setBusy(false); paint(); }
  });
  document.addEventListener('pointerdown', (e: PointerEvent) => {
    if (menu.hidden && panel.hidden) return;
    if (e.composedPath().includes(menu) || e.composedPath().includes(panel) || e.composedPath().includes($('selection-button'))) return;
    if ($('settings-dialog').open) return;
    close();
  }, true);
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && (!menu.hidden || !panel.hidden) && !$('settings-dialog').open) { e.preventDefault(); close(); }
  });
  document.addEventListener('scroll', () => { menu.hidden = true; }, true);
  new ResizeObserver(() => { if (!menu.hidden) place(menu); if (!panel.hidden) { const b = panel.getBoundingClientRect(); place(panel, b.x, b.y); } }).observe(bounds());
  $('quick-handle').onpointerdown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const b = panel.getBoundingClientRect(); drag = { x: e.clientX - b.left, y: e.clientY - b.top };
    $('quick-handle').setPointerCapture(e.pointerId); e.preventDefault();
  };
  $('quick-handle').onpointermove = (e: PointerEvent) => { if (drag) place(panel, e.clientX - drag.x, e.clientY - drag.y); };
  $('quick-handle').onpointerup = $('quick-handle').onpointercancel = () => { drag = null; };
  return { show, expand, close };
}
