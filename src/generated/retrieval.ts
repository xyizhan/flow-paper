// Generated from llm-for-zotero (AGPL-3.0-or-later). Do not edit.
import { tokenizeRetrievalText } from '../../vendor/llm-for-zotero/src/services/retrieval/retrievalTokenizer';
import type { ChunkStat } from '../../vendor/llm-for-zotero/src/services/paperContent/types';
function tokenizeText(text: string): string[] {
  return tokenizeRetrievalText(text);
}

export function buildChunkIndex(chunks: string[]): {
  chunkStats: ChunkStat[];
  docFreq: Record<string, number>;
  avgChunkLength: number;
} {
  // Prototype-less records: tokens like "constructor" must hit own
  // properties, not Object.prototype, or term counts turn into NaN.
  const docFreq: Record<string, number> = Object.create(null);
  const chunkStats: ChunkStat[] = [];
  let totalLength = 0;

  chunks.forEach((chunk, index) => {
    const tokens = tokenizeText(chunk);
    const tf: Record<string, number> = Object.create(null);
    for (const term of tokens) {
      tf[term] = (tf[term] || 0) + 1;
    }
    const uniqueTerms = Object.keys(tf);
    for (const term of uniqueTerms) {
      docFreq[term] = (docFreq[term] || 0) + 1;
    }
    const length = tokens.length;
    totalLength += length;
    chunkStats.push({ index, length, tf, uniqueTerms });
  });

  const avgChunkLength = chunks.length ? totalLength / chunks.length : 0;
  return { chunkStats, docFreq, avgChunkLength };
}

export function scoreChunkBM25(
  chunk: ChunkStat,
  terms: string[],
  docFreq: Record<string, number>,
  totalChunks: number,
  avgChunkLength: number,
): number {
  if (!terms.length || !chunk.length) return 0;
  const k1 = 1.2;
  const b = 0.75;
  let score = 0;

  for (const term of terms) {
    const tf = chunk.tf[term] || 0;
    if (!tf) continue;
    const df = docFreq[term] || 0;
    const idf = Math.log(1 + (totalChunks - df + 0.5) / (df + 0.5));
    const norm =
      (tf * (k1 + 1)) /
      (tf + k1 * (1 - b + (b * chunk.length) / avgChunkLength));
    score += idf * norm;
  }

  return score;
}
