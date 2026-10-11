import { contextBridge, ipcRenderer, webUtils } from 'electron';
const invoke = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
const listen = (channel: string) => (callback: (value: any) => void) => {
  const listener = (_event: unknown, value: unknown) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('paper', {
  load: invoke('state:load'), importFiles: invoke('paper:import'), readPdf: invoke('paper:read'),
  index: invoke('paper:index'), saveAnnotations: invoke('paper:annotations'), savePosition: invoke('paper:position'),
  connectZotero: invoke('zotero:connect'), saveSettings: invoke('settings:save'),
  zoteroModels: invoke('settings:zotero-models'), importZoteroModel: invoke('settings:import-zotero'),
  chat: invoke('chat:start'), cancel: invoke('chat:cancel'), saveNotes: invoke('notes:save'),
  exportNotes: invoke('notes:export'), newChat: invoke('chat:new'), openExternal: invoke('external:open'),
  openResearch: invoke('research:open'), updateContext: invoke('research:context'), takeResearch: invoke('research:take'),
  prepare: invoke('research:prepare'), prepared: invoke('research:prepared'), openSource: invoke('paper:open-source'),
  closeTemporary: invoke('temporary:close'), keepTemporary: invoke('temporary:keep'), appendNotes: invoke('notes:append'),
  occludeResearch: invoke('research:occlude'), researchLayout: invoke('research:layout'), setResearchMode: invoke('research:mode'), hideResearch: invoke('research:hide'),
  dragResearch: invoke('research:drag'), resizeResearch: invoke('research:resize'), onResearchLayout: listen('research:layout'),
  onResearch: listen('research:changed'), onPrepare: listen('paper:prepare'), onSource: listen('paper:open-source'),
  onSettings: listen('settings:changed'), onNotes: listen('notes:changed'),
  filePath: (file: File) => webUtils.getPathForFile(file),
  onStream: (callback: (event: unknown) => void) => {
    const listener = (_event: unknown, value: unknown) => callback(value);
    ipcRenderer.on('chat:event', listener);
    return () => ipcRenderer.removeListener('chat:event', listener);
  },
  onImported: (callback: () => void) => {
    ipcRenderer.on('paper:imported', callback);
    return () => ipcRenderer.removeListener('paper:imported', callback);
  },
});
