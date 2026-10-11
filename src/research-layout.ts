// Presentation controls only. The Electron host keeps the same chat renderer.
export function installResearchLayout(api: any, researchMode: boolean) {
  const $ = (id: string) => document.getElementById(id)!;
  let layout = { mode: 'docked', visible: false, width: 420, preview: false };
  const apply = (next: typeof layout) => {
    layout = next;
    document.body.classList.toggle('chat-docked', !researchMode && next.visible && next.mode === 'docked');
    const libraryWidth = parseFloat(getComputedStyle(document.querySelector('.workspace')!).getPropertyValue('--llm-standalone-sidebar-panel-width')) || 260;
    document.body.classList.toggle('library-auto-hidden', !researchMode && next.visible && next.mode === 'docked' && innerWidth - next.width - libraryWidth < 470);
    document.body.classList.toggle('chat-floating', researchMode && next.mode === 'floating');
    document.documentElement.style.setProperty('--research-width', `${next.width}px`);
    $('research-divider').hidden = $('research-slot').hidden = !(next.visible && next.mode === 'docked') || researchMode;
    $('dock-preview').hidden = !next.preview || researchMode;
    $('open-chat').setAttribute('aria-pressed', String(next.visible));
    $('research-divider').setAttribute('aria-valuenow', String(next.width));
    $('research-divider').setAttribute('aria-valuemin', '340'); $('research-divider').setAttribute('aria-valuemax', '700');
    if (researchMode) {
      const floating = next.mode === 'floating';
      const label = floating ? '停靠到右侧' : '弹出独立窗口';
      $('research-mode').title = label; $('research-mode').setAttribute('aria-label', label);
      $('research-mode').innerHTML = floating
        ? '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16m-8-8h5m-2-2 2 2-2 2"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M14 3h7v7m0-7L11 13M10 5H4v15h15v-6"/></svg>';
      $('research-drag').title = floating ? '拖到阅读器右边缘可停靠' : '拖动弹出对话';
    }
  };
  api.onResearchLayout(apply);
  void api.researchLayout().then(apply);
  if (researchMode) {
    $('research-tools').prepend($('settings-button'));
    $('research-mode').onclick = () => api.setResearchMode(layout.mode === 'floating' ? 'docked' : 'floating');
    $('research-close').onclick = () => api.hideResearch();
    const grip = $('research-drag');
    grip.onpointerdown = event => {
      if (event.button !== 0) return;
      const floating = layout.mode === 'floating';
      const start = { x: event.screenX, y: event.screenY };
      grip.setPointerCapture(event.pointerId);
      if (floating) void api.dragResearch('start', start);
      const moved = (e: PointerEvent) => Math.hypot(e.screenX - start.x, e.screenY - start.y) > 40;
      grip.onpointermove = e => {
        if (floating) void api.dragResearch('move', { x: e.screenX, y: e.screenY });
        else grip.classList.toggle('dragging-out', moved(e));
      };
      const cancelOnEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { e.preventDefault(); finish({ type: 'pointercancel', pointerId: event.pointerId, screenX: start.x, screenY: start.y } as PointerEvent); }
      };
      const finish = (e: PointerEvent) => {
        document.removeEventListener('keydown', cancelOnEscape);
        grip.classList.remove('dragging-out'); grip.onpointermove = grip.onpointerup = grip.onpointercancel = grip.onlostpointercapture = null;
        if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);
        const point = { x: e.screenX, y: e.screenY };
        if (floating) void api.dragResearch(e.type === 'pointerup' ? 'end' : 'cancel', point);
        else if (e.type === 'pointerup' && moved(e)) void api.setResearchMode('floating', point);
      };
      grip.onpointerup = grip.onpointercancel = grip.onlostpointercapture = finish;
      document.addEventListener('keydown', cancelOnEscape);
    };
  } else {
    const divider = $('research-divider');
    divider.onpointerdown = event => {
      if (event.button !== 0) return;
      const startX = event.clientX, width = layout.width;
      divider.setPointerCapture(event.pointerId); document.body.classList.add('research-resizing');
      let frame = 0, requested = width;
      divider.onpointermove = e => {
        requested = width + startX - e.clientX;
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; void api.resizeResearch(requested, false); });
      };
      const finish = (e: PointerEvent) => {
        cancelAnimationFrame(frame); divider.onpointermove = divider.onpointerup = divider.onpointercancel = null;
        if (divider.hasPointerCapture(e.pointerId)) divider.releasePointerCapture(e.pointerId);
        document.body.classList.remove('research-resizing');
        void api.resizeResearch(e.type === 'pointercancel' ? width : requested, true);
      };
      divider.onpointerup = divider.onpointercancel = finish;
    };
    divider.onkeydown = e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault(); void api.resizeResearch(layout.width + (e.key === 'ArrowLeft' ? 20 : -20), true);
      }
    };
  }
}
