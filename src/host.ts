/** Minimal host for unmodified llm-for-zotero modules. No Zotero database emulation. */
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const preferences = new Map<string, unknown>();
const host = globalThis as any;
host.Zotero = {
  Prefs: {
    get: (key: string) => preferences.get(key),
    set: (key: string, value: unknown) => preferences.set(key, value),
    clear: (key: string) => preferences.delete(key),
  },
  getMainWindow: () => globalThis,
  debug: () => {},
};
host.ztoolkit = { getGlobal: (key: string) => host[key] };
// Reuse upstream Codex auth/refresh, with file access limited to its existing auth file.
const authPath = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json');
const checked = (filename: string) => { if (path.resolve(filename) !== authPath) throw new Error('Unsupported host file'); return authPath; };
host.IOUtils = {
  read: (filename: string) => readFile(checked(filename)),
  write: async (filename: string, bytes: Uint8Array) => {
    const target = checked(filename), temp = `${target}.su-paper-${process.pid}.tmp`;
    await writeFile(temp, bytes, { mode: 0o600 }); await rename(temp, target);
  },
};
