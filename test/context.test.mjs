import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareContext, historyMessage } from '../dist/test/context.js';
import { callLLMStream } from '../dist/test/ai.js';
import http from 'node:http';

test('multi-paper context preserves paper identity and page links', () => {
  const result = prepareContext([
    { id: 'a', title: 'Alpha', indexed: true, pages: ['alpha abstract', 'alpha experiment'] },
    { id: 'b', title: 'Beta', indexed: true, pages: ['beta method'] },
  ], 'compare methods');
  assert.equal(result.partial, false);
  assert.equal(result.evidence.length, 3);
  assert.match(result.context, /#source=a&page=2/);
  assert.match(result.context, /beta method/);
});
test('bounded retrieval uses upstream BM25 and reports partial coverage', () => {
  const result = prepareContext([{ id: 'a', title: 'Paper', indexed: true,
    pages: ['irrelevant material '.repeat(200), 'attention transformer mechanism '.repeat(60)] }], 'attention transformer', 1500);
  assert.equal(result.partial, true);
  assert.equal(result.evidence[0].page, 2);
  assert.match(result.context, /PARTIAL/);
});
test('missing or scanned PDFs are not reported as read', () => {
  const result = prepareContext([{id: 'a', indexed: false}, {id: 'b', indexed: true, pages: ['', '']}], 'summarize');
  assert.equal(result.indexed, 0);
  assert.equal(result.partial, true);
});
test('follow-up questions retain earlier screenshots and selected source text', () => {
  const history = historyMessage({ role: 'user', content: '解释所选内容', attachments: [
    {paperId:'paper-a',title:'Paper A',page:2,text:'A particular claim'},
    {paperId:'paper-a',title:'Paper A',page:3,image:'data:image/png;base64,TEST_IMAGE'},
  ] });
  assert.match(history.content[0].text, /A particular claim/);
  assert.match(history.content[0].text, /#source=paper-a&page=3/);
  assert.equal(history.content[1].image_url.url, 'data:image/png;base64,TEST_IMAGE');
});
test('unmodified upstream client sends multimodal context and parses streamed response', async () => {
  let request;
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({data: []})); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    request = JSON.parse(Buffer.concat(chunks).toString());
    res.writeHead(200, {'Content-Type': 'text/event-stream'});
    for (const text of ['A grounded ', 'answer.']) res.write(`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:null}]})}\n\n`);
    res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    let streamed = '';
    const outcome = await callLLMStream({ prompt: 'Explain this figure', context: 'Paper A, page 2: verified evidence', model: 'gpt-4o-mini',
      apiBase: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'test-only', authMode: 'api_key',
      providerProtocol: 'openai_chat_compat', inputMode: 'vision_allowed', images: ['data:image/png;base64,aGVsbG8='],
    }, delta => streamed += delta);
    assert.equal(outcome.text, 'A grounded answer.');
    assert.equal(streamed, outcome.text);
    assert.equal(outcome.completion.status, 'complete');
    assert.match(JSON.stringify(request.messages), /verified evidence/);
    assert.match(JSON.stringify(request.messages), /image_url/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
