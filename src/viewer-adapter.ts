/** Compatibility adapter for the pinned EmbedPDF 2.15.1 viewer. */
export function coalesceCommandUpdates(registry: any) {
  const plugin = registry.getPlugin('commands');
  if (typeof plugin?.onGlobalStoreChange !== 'function') return;
  const update = plugin.onGlobalStoreChange.bind(plugin);
  let scheduled = false;
  // Upstream scans every toolbar command for every open document on each store
  // mutation. Loading 77 PDF annotations caused hundreds of redundant scans and
  // a 150–180 ms main-thread task. Batch these UI notifications to one per frame.
  // Command execution still resolves against the current state synchronously.
  plugin.onGlobalStoreChange = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      update(registry.getStore().getState());
    });
  };
}

export function preserveClosingViewState(registry: any) {
  // Preact can finish a toolbar's pending effect after the PDF close action has
  // removed plugin state. Keep only the read-only UI snapshot during unmount;
  // live/reopened documents and every mutation still use the upstream APIs.
  for (const [id, scopeMethod] of [['ui', 'createUIScope'], ['zoom', 'createZoomScope']]) {
    const plugin = registry.getPlugin(id);
    if (!plugin?.[scopeMethod] || !plugin.onDocumentClosed) continue;
    const closed = new Map<string, any>();
    const close = plugin.onDocumentClosed.bind(plugin);
    const loading = plugin.onDocumentLoadingStarted.bind(plugin);
    plugin.onDocumentClosed = (documentId: string) => {
      const snapshot = plugin.state.documents[documentId];
      if (snapshot) closed.set(documentId, snapshot);
      if (closed.size > 200) closed.delete(closed.keys().next().value!);
      close(documentId);
    };
    plugin.onDocumentLoadingStarted = (documentId: string) => { closed.delete(documentId); loading(documentId); };
    const create = plugin[scopeMethod].bind(plugin);
    plugin[scopeMethod] = (documentId: string) => {
      const scope = create(documentId), read = scope.getState;
      return { ...scope, getState: () => {
        if (!registry.getStore().getState().core.documents[documentId] && closed.has(documentId)) return closed.get(documentId);
        return read();
      } };
    };
  }
}
