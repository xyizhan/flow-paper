import { BaseWindow, BrowserWindow, screen, WebContentsView, type WebContents } from 'electron';
import { computeStandaloneSidebarWidthLayout } from '../vendor/llm-for-zotero/src/modules/contextPanel/standaloneWindowSizing';

type Mode = 'docked' | 'floating';
type Layout = { mode: Mode; width: number };

// One renderer is reparented, never reloaded: drafts, attachments, scroll and
// in-flight model requests keep their original owner in either presentation.
export class ResearchHost {
  private view?: WebContentsView;
  private floating?: BaseWindow;
  private parent?: BaseWindow;
  private ready?: Promise<void>;
  private hiding?: Promise<void>;
  private visible = false;
  private mode: Mode;
  private preferredWidth: number;
  private preview = false;
  private occluded = false;
  private shuttingDown = false;
  private drag?: { point: { x: number; y: number }; bounds: Electron.Rectangle };
  private floatBounds?: Electron.Rectangle;
  constructor(private main: BrowserWindow, private preload: string, layout: Partial<Layout>,
    private secure: (contents: WebContents) => void,
    private persist: (layout: Layout) => Promise<void>,
    private stop: (owner: number) => Promise<void>) {
    this.mode = layout?.mode === 'floating' ? 'floating' : 'docked';
    this.preferredWidth = Number(layout?.width) || 420;
    main.on('resize', () => this.layout());
    main.on('move', () => this.showPreview(false));
  }
  get webContents() { return this.view?.webContents; }
  get status() { return { mode: this.mode, visible: this.visible, width: this.width, preview: this.preview }; }
  private get width() {
    return computeStandaloneSidebarWidthLayout({ requestedWidth: this.preferredWidth,
      containerWidth: this.main.getContentBounds().width, minWidth: 340, maxWidth: 700, minContentWidth: 470 }).renderedWidth;
  }
  private publish() {
    if (!this.main.isDestroyed()) this.main.webContents.send('research:layout', this.status);
    this.webContents?.send('research:layout', this.status);
  }
  private layout() {
    if (this.visible && this.view) {
      const bounds = (this.mode === 'floating' ? this.floating! : this.main).getContentBounds();
      this.view.setBounds(this.mode === 'floating' ? { x: 0, y: 0, width: bounds.width, height: bounds.height }
        : { x: bounds.width - this.width, y: 46, width: this.width, height: Math.max(0, bounds.height - 46) });
    }
    this.publish();
  }
  private showPreview(value: boolean) { if (value !== this.preview) { this.preview = value; this.publish(); } }
  private canSnap(point: { x: number; y: number }) {
    if (this.main.isMinimized() || !this.main.isVisible()) return false;
    const bounds = this.main.getContentBounds();
    return point.x >= bounds.x + bounds.width - 100 && point.x <= bounds.x + bounds.width + 32
      && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
  }
  private detach() {
    if (this.parent && !this.parent.isDestroyed() && this.view) this.parent.contentView.removeChildView(this.view);
    this.parent = undefined;
  }
  private closeFloating() {
    const target = this.floating; this.floating = undefined;
    if (target && !target.isDestroyed()) { this.floatBounds = target.getBounds(); target.destroy(); }
    this.drag = undefined;
  }
  async open() {
    await this.hiding;
    if (!this.view) {
      this.view = new WebContentsView({ webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
      this.secure(this.view.webContents);
      this.ready = this.view.webContents.loadURL('su-app://local/index.html?view=research');
    }
    await this.ready;
    if (this.shuttingDown) return;
    this.present(this.mode);
    this.webContents!.send('research:changed');
  }
  private present(mode: Mode, point?: { x: number; y: number }) {
    this.detach(); this.mode = mode; this.visible = true;
    this.showPreview(false);
    if (mode === 'floating') {
      if (!this.floating) {
        const mainBounds = this.main.getBounds();
        const bounds = this.floatBounds || { x: mainBounds.x + mainBounds.width - 620, y: mainBounds.y, width: 620, height: Math.min(800, mainBounds.height) };
        const target = this.floating = new BaseWindow({ ...bounds, minWidth: 380, minHeight: 420,
          title: '对话 — Flow Paper', backgroundColor: '#fff', show: false });
        target.on('resize', () => this.layout());
        target.on('close', event => { event.preventDefault(); void this.hide(); });
      }
      this.parent = this.floating;
      if (point) {
        const area = screen.getDisplayNearestPoint(point).workArea;
        const b = this.floating.getBounds();
        this.floating.setPosition(Math.round(Math.max(area.x, Math.min(point.x - 120, area.x + area.width - b.width))),
          Math.round(Math.max(area.y, Math.min(point.y - 35, area.y + area.height - b.height))));
      }
    } else { this.closeFloating(); this.parent = this.main; }
    this.parent.contentView.addChildView(this.view!);
    this.view!.setVisible(!(this.occluded && mode === 'docked')); this.layout();
    this.parent.show(); this.parent.focus(); this.webContents!.focus();
  }
  async setMode(mode: Mode, point?: { x: number; y: number }) {
    if (mode !== 'docked' && mode !== 'floating') return;
    if (!this.view) await this.open();
    this.present(mode, point);
    await this.persist({ mode: this.mode, width: this.preferredWidth });
  }
  occlude(value: boolean) {
    this.occluded = value;
    this.view?.setVisible(this.visible && !(value && this.mode === 'docked'));
  }
  async dragFloating(phase: string, point: { x: number; y: number }) {
    if (!this.floating || this.mode !== 'floating' || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
    if (phase === 'start') { this.drag = { point, bounds: this.floating.getBounds() }; return; }
    if (!this.drag) return;
    if (phase === 'move') {
      // Keep the input surface still while dragging. The dock preview follows
      // the pointer; commit the native move on release so capture cannot be lost.
      this.showPreview(this.canSnap(point));
    } else {
      const snap = phase === 'end' && this.preview && this.canSnap(point);
      if (phase === 'end' && !snap) {
        const { bounds, point: start } = this.drag;
        this.floating.setPosition(Math.round(bounds.x + point.x - start.x), Math.round(bounds.y + point.y - start.y));
      }
      this.drag = undefined; this.showPreview(false);
      if (snap) await this.setMode('docked');
    }
  }
  async resize(width: number, commit: boolean) {
    if (!Number.isFinite(width)) return;
    this.preferredWidth = Math.max(340, Math.min(700, Math.round(width))); this.layout();
    if (commit) await this.persist({ mode: this.mode, width: this.preferredWidth });
  }
  async hide() {
    if (this.hiding) return this.hiding;
    if (!this.visible) return;
    // Hide immediately, then flush without disposing the user's draft.
    this.visible = false; this.detach(); this.view?.setVisible(false); this.closeFloating(); this.showPreview(false); this.publish();
    this.hiding = (async () => {
      await this.webContents?.executeJavaScript('window.__suPaper?.flush?.()');
      if (this.webContents) await this.stop(this.webContents.id);
    })();
    try { await this.hiding; } finally { this.hiding = undefined; }
  }
  async destroy() {
    this.shuttingDown = true;
    await this.hide(); this.detach(); this.closeFloating();
    this.webContents?.close(); this.view = undefined;
  }
}
