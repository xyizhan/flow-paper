# Third-party code

Flow Paper is an AGPL-3.0-or-later integration of existing projects.

- **llm-for-zotero**, Yile Wang and contributors, AGPL-3.0-or-later.
  Complete source: `vendor/llm-for-zotero`; upstream: https://github.com/yilewang/llm-for-zotero.
  Directly imported: LLM client, provider protocols, model capabilities, token
  budgets, system instructions, streaming parsers, Markdown/KaTeX renderer and
  retrieval tokenizer and existing Codex authentication/refresh. The build extracts the original `buildChunkIndex`,
  `scoreChunkBM25` and `tokenizeText` functions using the TypeScript parser.
  UI helpers are also imported unchanged: `menuPositioning.ts`, `textareaSizing.ts`,
  and `installStandaloneSidebarResizeBehavior` / `computeStandaloneSidebarWidthLayout`
  from `standaloneWindowSizing.ts`.
  The independent Electron window follows the lifecycle in `standaloneWindow.ts`;
  temporary conversation persistence is implemented in the desktop adapter.
  Zotero's application UI and agent tools are retained in source but are not
  yet hosted by this independent reader.
- **EmbedPDF 2.15.1**, CloudPDF and contributors, MIT.
  Reference source: `vendor/embedpdf`; runtime: `@embedpdf/snippet`.
  Upstream: https://github.com/embedpdf/embed-pdf-viewer/tree/v2.
  The complete viewer supplies PDFium rendering, selection, search, tabs,
  screenshots, annotations, export and navigation. PDFium and its bundled
  dependencies retain their own notices.
  Local glue batches command-state notifications once per animation frame and
  closes the SDK capture preview through its own handler after adding the image
  to chat. Read-only UI/zoom snapshots let pending toolbar effects finish after
  a PDF tab closes; late scroll subscriptions for fully closed documents become inert. Reopened documents subscribe normally. Neither upstream source checkout is modified.
- **DOMPurify**, Apache-2.0 OR MPL-2.0. Sanitizes rendered model output.
- **Electron**, MIT. Desktop host and operating-system integration.
- Upstream Markdown rendering uses marked (MIT), KaTeX (MIT), and
  highlight.js (BSD-3-Clause).

Dependency versions are recorded in `package-lock.json`; source commits are
recorded in `dist/upstream.json` at build time. Preserve corresponding source
and applicable copyright/license notices when distributing.
