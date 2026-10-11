import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseZoteroModels, publicZoteroModels } from '../dist/test/zotero-settings.js';

test('Zotero configuration import only parses known preferences and never returns secrets to the UI', () => {
  const groups = [{apiBase:'https://example.test/v1',apiKey:'PRIVATE_FIXTURE_KEY',providerProtocol:'openai_chat_compat',authMode:'api_key',models:[{id:'chosen',model:'vision-model'}]}];
  const text = 'throw new Error("must never execute prefs.js");\n' +
    `user_pref("extensions.zotero.llmforzotero.modelProviderGroups", ${JSON.stringify(JSON.stringify(groups))});\n` +
    'user_pref("extensions.zotero.llmforzotero.lastUsedModelEntryId", "chosen");';
  const models = parseZoteroModels(text);
  assert.equal(models[0].apiKey, 'PRIVATE_FIXTURE_KEY');
  assert.equal(models[0].preferred, true);
  assert.equal(publicZoteroModels(models)[0].model, 'vision-model');
  assert.doesNotMatch(JSON.stringify(publicZoteroModels(models)), /PRIVATE_FIXTURE_KEY|apiKey/);
});
