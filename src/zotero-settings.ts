import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const prefix = 'extensions.zotero.llmforzotero.';
const protocols = new Set(['openai_chat_compat', 'responses_api', 'anthropic_messages', 'gemini_native', 'ollama_native', 'codex_responses']);

// Parse only these two JSON values. Never execute prefs.js or expose credentials to the renderer.
export function parseZoteroModels(source: string) {
  const prefs: Record<string, any> = {};
  for (const line of source.split('\n')) {
    const match = line.match(/^user_pref\("(extensions\.zotero\.llmforzotero\.(?:modelProviderGroups|lastUsedModelEntryId))", (.*)\);$/);
    if (match) prefs[match[1]] = JSON.parse(match[2]);
  }
  const groups = JSON.parse(prefs[prefix + 'modelProviderGroups'] || '[]');
  const active = prefs[prefix + 'lastUsedModelEntryId'];
  return groups.flatMap((g: any) => {
    if (!protocols.has(g.providerProtocol) || !['api_key', 'codex_auth'].includes(g.authMode || 'api_key')) return [];
    return (g.models || []).map((m: any) => ({ id: m.id, model: m.model, apiBase: g.apiBase, apiKey: g.apiKey || '', protocol: g.providerProtocol,
      authMode: g.authMode || 'api_key', preferred: m.id === active }));
  });
}

export async function zoteroModels() {
  let profile = process.env.FLOW_PAPER_ZOTERO_PROFILE_DIR || process.env.SU_PAPER_ZOTERO_PROFILE_DIR;
  if (!profile) {
    const root = process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/Zotero')
      : process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'Zotero/Zotero') : path.join(os.homedir(), '.zotero/zotero');
    const ini = await readFile(path.join(root, 'profiles.ini'), 'utf8');
    const profiles = ini.split(/\r?\n\[/).filter(s => /^\[?Profile/.test(s)).map(s => Object.fromEntries(s.split(/\r?\n/).flatMap(l => { const m = l.match(/^([^=]+)=(.*)$/); return m ? [[m[1], m[2]]] : []; })));
    const chosen = profiles.find(p => p.Default === '1') || (profiles.length === 1 ? profiles[0] : undefined);
    if (!chosen?.Path) throw new Error('未找到唯一的 Zotero 默认配置，请手动填写模型设置。');
    profile = chosen.IsRelative === '1' ? path.join(root, chosen.Path) : chosen.Path;
  }
  return parseZoteroModels(await readFile(path.join(profile, 'prefs.js'), 'utf8'));
}

export const publicZoteroModels = (models: any[]) => models.map(({ id, model, apiBase, protocol, authMode, preferred }) => ({ id, model, apiBase, protocol, authMode, preferred }));
