import './host';
// Intentionally import upstream source directly. Request building, protocols,
// streaming, multimodal messages, token budgeting and prompts remain upstream.
export { callLLMStream } from '../vendor/llm-for-zotero/src/utils/llmClient';
export { DEFAULT_SYSTEM_PROMPT } from '../vendor/llm-for-zotero/src/utils/llmDefaults';
