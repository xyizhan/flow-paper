import { _electron as electron } from 'playwright';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const output = path.resolve('test-output');
await mkdir(output, {recursive:true});
const dataDir = path.join(output, 'profile');
await rm(dataDir, {recursive:true, force:true});
const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let i=0; i<3; i++) {
  const page = pdf.addPage([612,792]);
  page.drawText(i === 0 ? 'Attention and Research' : `Evidence on page ${i+1}`, {x:50,y:710,size:24,font});
  const lines = ['A sample paper for integration testing.', 'The attention mechanism compares queries and keys.', 'This experiment demonstrates grounded paper reading.', 'Every conclusion must be linked to source evidence.'];
  lines.forEach((line,n)=>page.drawText(line,{x:50,y:650-n*25,size:13,font}));
  page.drawRectangle({x:60,y:230,width:430,height:180,color:rgb(.90,.94,.89)});
  page.drawText('Figure 1. Attention architecture',{x:90,y:310,size:17,font});
}
const pdfPath = path.join(output, 'research-fixture.pdf'); await writeFile(pdfPath,await pdf.save());
let capturedRequest; const modelRequests=[];
const server = http.createServer(async(req,res)=>{
  if(req.method==='GET'){res.setHeader('Content-Type','application/json');res.end('{"data":[]}');return;}
  const chunks=[];for await(const c of req)chunks.push(c);capturedRequest=JSON.parse(Buffer.concat(chunks));modelRequests.push(capturedRequest);
  const context=JSON.stringify(capturedRequest.messages);const id=context.match(/#source=([^&]+)&page=1/)?.[1] || 'unknown';
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const answer=`该论文讨论 **注意力机制**，通过查询与键的比较组织信息。\n\n公式示例：$A = QK^T$。\n\n[查看原文第 2 页](#source=${id}&page=2)`;
  for(const part of answer.match(/.{1,14}/gs)){res.write(`data: ${JSON.stringify({choices:[{delta:{content:part}}]})}\n\n`);await new Promise(r=>setTimeout(r,JSON.stringify(capturedRequest).includes('SLOW_STREAM') ? 180 : 12));}
  res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const zoteroServer=http.createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url.includes('/file/view/url')){res.setHeader('Content-Type','text/plain');res.end(pathToFileURL(pdfPath).href);return;}
  if(req.url.includes('/collections')){res.end(JSON.stringify([{key:'COLLECT1',data:{name:'测试分类'}}]));return;}
  if(req.url.includes('/items?')){res.end(JSON.stringify([
    {key:'PARENT01',data:{itemType:'journalArticle',title:'Zotero fixture paper',date:'2026',creators:[{lastName:'Researcher'}],collections:['COLLECT1']}},
    {key:'ATTACH01',data:{itemType:'attachment',contentType:'application/pdf',parentItem:'PARENT01',filename:'fixture.pdf'}}
  ]));return;}
  res.writeHead(404);res.end('{}');
});
const zoteroAvailable=await new Promise(resolve=>{zoteroServer.once('error',()=>resolve(false));zoteroServer.listen(23119,'127.0.0.1',()=>resolve(true));});
const executable=process.env.FLOW_PAPER_EXECUTABLE || process.env.SU_PAPER_EXECUTABLE;
const launchOptions=executable?{executablePath:executable,args:[]}:{args:['.']};
const errors=[];
let desktop;
try {
  desktop=await electron.launch({...launchOptions,env:{...process.env,FLOW_PAPER_DATA_DIR:dataDir},timeout:60000});
  const page=await desktop.firstWindow();
  const observe=p=>{p.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});p.on('console',m=>{if(m.type()==='error')console.log('renderer:',m.text());});};observe(page);
  await page.waitForFunction(()=>!!window.__suPaper,{timeout:60000});
  assert.equal(await page.locator('.research').isVisible(),false);
  assert.equal((await page.evaluate(()=>window.paper.load())).conversations.length,0);
  await page.screenshot({path:path.join(output,'empty.png')});
  await page.evaluate(p=>window.__suPaper.importFiles([p]),pdfPath);
  await page.waitForFunction(()=>window.__suPaper.getState().papers[0]?.indexed);
  await page.locator('#settings-button').click();
  await page.locator('#api-base').fill(`http://127.0.0.1:${server.address().port}/v1`);
  await page.locator('#model-name').fill('gpt-4o-mini');
  await page.locator('#settings-form button[type=submit]').click();
  const selectText = async(y=160)=>{
    await page.getByRole('button',{name:'阅读',exact:true}).click();
    await page.evaluate(()=>window.__suPaper.capability('interaction-manager').activate('pointerMode'));
    await page.evaluate(()=>window.__suPaper.capability('scroll').scrollToPage({pageNumber:1,behavior:'instant'}));
    await page.waitForTimeout(200); // Let the annotation toolbar collapse before measuring page coordinates.
    await page.waitForFunction(()=>{const root=document.querySelector('#pdf-viewer embedpdf-container')?.shadowRoot;return [...(root?.querySelectorAll('img,canvas')||[])].some(img=>{const b=img.getBoundingClientRect();return b.width>300&&b.y<300;});});
    const images=await page.locator('#pdf-viewer canvas, #pdf-viewer img').evaluateAll(images=>images.map(img=>{const b=img.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};}).filter(b=>b.width>300&&b.y<300).sort((a,b)=>b.width-a.width));
    const box=images[0];assert.ok(box,'rendered PDF');const scale=box.width/612;
    await page.mouse.move(box.x+51*scale,box.y+y*scale);await page.mouse.down();await page.mouse.move(box.x+300*scale,box.y+y*scale,{steps:15});await page.mouse.up();
    await page.locator('#quick-menu').waitFor({state:'visible'});
  };
  await selectText(135);
  const originalZoom=await page.evaluate(()=>window.__suPaper.capability('zoom').getState().currentZoomLevel);
  await page.getByRole('button',{name:'高亮',exact:true}).click();
  await page.waitForFunction(()=>window.__suPaper.capability('annotation').getAnnotations().length===1);
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  await page.waitForFunction(()=>window.__suPaper.capability('annotation').getAnnotations().length===0);
  await page.getByRole('button',{name:'恢复',exact:true}).click();
  await page.waitForFunction(()=>window.__suPaper.capability('annotation').getAnnotations().length===1);
  assert.ok(Math.abs(originalZoom-await page.evaluate(()=>window.__suPaper.capability('zoom').getState().currentZoomLevel))<.01);
  console.log('PASS PDF, mouse selection, highlight, undo/redo; zoom stable');
  await selectText();await page.locator('#quick-translate').click();
  await page.waitForFunction(()=>!document.getElementById('quick-send').hidden&&document.getElementById('quick-answer').textContent.includes('注意力机制'));
  assert.match(JSON.stringify(capturedRequest),/attention mechanism/);
  assert.equal((await page.evaluate(()=>window.paper.load())).conversations.length,0);
  const old=await page.locator('#quick-panel').boundingBox(),handle=await page.locator('#quick-handle').boundingBox();
  await page.locator('#toast').waitFor({state:'hidden'});
  await page.screenshot({path:path.join(output,'preview-quick-chat.png')});
  await page.mouse.move(handle.x+50,handle.y+12);await page.mouse.down();await page.mouse.move(handle.x+120,handle.y+52,{steps:10});await page.mouse.up();
  const moved=await page.locator('#quick-panel').boundingBox();assert.ok(Math.abs(moved.x-old.x)>20);
  await page.locator('#quick-prompt').fill('TEMP_PRIVATE_SENTINEL：再解释一句');await page.locator('#quick-send').click();
  await page.waitForFunction(()=>!document.getElementById('quick-send').hidden);
  assert.ok(capturedRequest.messages.some(m=>m.role==='assistant'),'temporary follow-up carries its own history');
  await page.waitForTimeout(150);
  const quickBounds=await page.locator('#quick-panel').boundingBox();const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
  assert.ok(quickBounds.y+quickBounds.height<=viewport.height-4,'growing popup stays on screen');
  assert.ok(await page.locator('#quick-prompt').isVisible(),'temporary composer remains visible');
  await page.screenshot({path:path.join(output,'quick-chat.png')});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#quick-panel').isVisible(),false);
  let stored=JSON.parse(await readFile(path.join(dataDir,'workspace.json'),'utf8'));
  assert.equal(stored.conversations.length,0);assert.equal(JSON.stringify(stored).includes('TEMP_PRIVATE_SENTINEL'),false);
  console.log('PASS floating translation, dragging, follow-up, Escape; no temporary history on disk');
  await selectText();await page.locator('#quick-ask').click();await page.locator('#quick-prompt').fill('SLOW_STREAM');await page.locator('#quick-send').click();
  await page.locator('#quick-stop').waitFor({state:'visible'});await page.keyboard.press('Escape');
  await selectText();await page.locator('#quick-explain').click();
  await page.waitForFunction(()=>!document.getElementById('quick-send').hidden&&document.getElementById('quick-answer').textContent.includes('注意力机制'));
  assert.equal((await page.locator('#quick-answer').textContent()).includes('SLOW_STREAM'),false);
  await page.locator('#quick-close').click();
  console.log('PASS dismissing an active stream cancels it; next selection isolated');
  const researchPromise=desktop.waitForEvent('window');await page.locator('#open-chat').click();const chat=await researchPromise;observe(chat);
  await chat.waitForFunction(()=>!!window.__suPaper);
  assert.equal(await chat.locator('.research').isVisible(),true);
  assert.equal(await chat.locator('#pdf-viewer').isVisible(),false);
  assert.equal((await page.evaluate(()=>window.paper.load())).conversations.length,0);
  await page.waitForFunction(()=>document.body.classList.contains('chat-docked'));
  const chatOwner=await chat.evaluate(()=>performance.timeOrigin);
  await chat.locator('#prompt').fill('DOCK_DRAFT');
  const separator=page.locator('#research-divider');await separator.focus();await separator.press('ArrowLeft');
  await page.waitForFunction(async()=> (await window.paper.researchLayout()).width===440);
  await chat.locator('#research-mode').click();
  await chat.waitForFunction(()=>document.body.classList.contains('chat-floating'));
  assert.equal(await chat.locator('#prompt').inputValue(),'DOCK_DRAFT');
  await desktop.evaluate(({BaseWindow})=>{const w=BaseWindow.getAllWindows().find(w=>w.getTitle()==='对话 — Flow Paper');w.setBounds({x:180,y:110,width:580,height:690});});
  assert.ok((await chat.locator('.composer').boundingBox()).width<600);
  // Keep the release point inside the native window, and exercise the actual
  // renderer pointer handlers plus the main-process snap hit test.
  await desktop.evaluate(({BaseWindow,BrowserWindow})=>{const b=BrowserWindow.getAllWindows()[0].getContentBounds();BaseWindow.getAllWindows().find(w=>w.getTitle()==='对话 — Flow Paper').setBounds({x:b.x+b.width-620,y:b.y,width:620,height:700});});
  const grip=await chat.locator('#research-drag').boundingBox();
  await chat.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await chat.mouse.down();
  await chat.mouse.move(585,100,{steps:12});
  await page.locator('#dock-preview').waitFor({state:'visible'});
  assert.equal((await page.evaluate(()=>window.paper.researchLayout())).mode,'floating');
  await chat.mouse.up();await page.waitForFunction(()=>document.body.classList.contains('chat-docked'));
  await page.locator('#dock-preview').waitFor({state:'hidden'});
  assert.equal(await chat.locator('#prompt').inputValue(),'DOCK_DRAFT');
  const dockGrip=await chat.locator('#research-drag').boundingBox();
  await chat.mouse.move(dockGrip.x+5,dockGrip.y+15);await chat.mouse.down();await chat.mouse.move(dockGrip.x+100,dockGrip.y+120,{steps:8});await chat.mouse.up();
  await chat.waitForFunction(()=>document.body.classList.contains('chat-floating'));
  console.log('PASS drag-out, docking preview before release and snapping on release');

  await page.bringToFront();await selectText();await page.locator('#quick-to-chat').click();
  await chat.locator('.attachment-chip').waitFor();assert.match(await chat.locator('#attachments').textContent(),/attention mechanism/);
  await chat.locator('#research-mode').click();await page.waitForFunction(()=>document.body.classList.contains('chat-docked'));
  assert.match(await chat.locator('#attachments').textContent(),/attention mechanism/);
  assert.equal(await chat.locator('#prompt').inputValue(),'DOCK_DRAFT');
  assert.equal(await chat.evaluate(()=>performance.timeOrigin),chatOwner);
  await chat.locator('#prompt').fill('SLOW_STREAM 解释论文的注意力机制，并引用原文。');await chat.locator('#send-button').click();
  await chat.waitForFunction(()=>document.getElementById('send-button').hidden);
  await chat.locator('#research-mode').click();await chat.waitForFunction(()=>document.body.classList.contains('chat-floating'));
  await chat.locator('#research-mode').click();await page.waitForFunction(()=>document.body.classList.contains('chat-docked'));
  assert.equal(await chat.evaluate(()=>performance.timeOrigin),chatOwner);
  await chat.waitForFunction(()=>!document.getElementById('send-button').hidden&&document.querySelector('.message.assistant')?.textContent.includes('注意力机制'));
  await chat.locator('.message-actions [data-note]').click();assert.match(await chat.locator('#notes-editor').inputValue(),/注意力机制/);
  await chat.locator('#chat-tab').click();await chat.locator('.message.assistant .bubble a[href^="#source="]').click();
  await page.waitForFunction(()=>window.__suPaper.capability('scroll').getCurrentPage()===2);
  console.log('PASS docking, resizing, popout and returning preserve the same renderer, draft, selection and active stream');
  await chat.locator('#research-mode').click();await chat.waitForFunction(()=>document.body.classList.contains('chat-floating'));
  // Screenshots are ephemeral first. Keeping is an explicit, separate action.
  await page.evaluate(()=>{const s=window.__suPaper,id=s.getState().papers[0].id;s.capability('capture').forDocument(id).captureArea(0,{origin:{x:50,y:380},size:{width:450,height:200}});});
  await page.locator('#quick-source img').waitFor();await page.getByAltText('Captured PDF area').waitFor({state:'hidden'});
  await page.locator('#quick-prompt').fill('解释图中的注意力机制');await page.locator('#quick-send').click();
  await page.waitForFunction(()=>!document.getElementById('quick-send').hidden&&document.getElementById('quick-answer').textContent.includes('注意力机制'));
  assert.match(JSON.stringify(capturedRequest),/image_url/);
  assert.equal((await page.evaluate(()=>window.paper.load())).conversations.length,1);
  await chat.locator('#notes-tab').click();await chat.locator('#notes-editor').fill('UNSAVED_NOTE_DRAFT');
  await page.locator('#quick-note').click();
  await chat.waitForFunction(()=>document.getElementById('notes-editor').value.includes('注意力机制'));
  assert.match(await chat.locator('#notes-editor').inputValue(),/UNSAVED_NOTE_DRAFT/);
  await page.locator('#quick-keep').click();
  await chat.waitForFunction(()=>document.querySelector('.message.user img'));
  assert.equal((await page.evaluate(()=>window.paper.load())).conversations.length,2);
  await chat.locator('#prompt').fill('继续解释刚才截图中的图示。');await chat.locator('#send-button').click();
  await chat.waitForFunction(()=>!document.getElementById('send-button').hidden);
  assert.ok(capturedRequest.messages.slice(0,-1).some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='image_url')));
  console.log('PASS real capture, vision payload, explicit Keep, image follow-up and concurrent notes preservation');
  const secondPdf=path.join(output,'second-paper.pdf');await writeFile(secondPdf,await pdf.save());
  await page.evaluate(p=>window.__suPaper.importFiles([p]),secondPdf);
  await page.locator('.paper-card input').nth(0).check();await page.locator('.paper-card input').nth(1).check();
  await chat.waitForFunction(()=>document.getElementById('scope-label').textContent.includes('2 篇'));
  await chat.locator('#prompt').fill('比较两篇论文。');await chat.locator('#send-button').click();
  await chat.waitForFunction(()=>!document.getElementById('send-button').hidden);
  assert.match(JSON.stringify(capturedRequest),/research-fixture/);assert.match(JSON.stringify(capturedRequest),/second-paper/);
  await chat.screenshot({path:path.join(output,'conversation-window.png')});
  await page.screenshot({path:path.join(output,'reader.png')});
  console.log('PASS multi-paper context across windows');
  if(zoteroAvailable){await page.locator('#zotero-button').click();await page.getByText('Zotero fixture paper',{exact:true}).click();await page.waitForFunction(()=>window.__suPaper.getState().papers.some(p=>p.source==='zotero'&&p.indexed));console.log('PASS Zotero metadata and local attachment resolution');}
  else console.log('SKIP fake Zotero: actual Zotero occupies port; existing service untouched');
  await page.evaluate(async()=>{const s=window.__suPaper,id=s.getState().papers[0].id;await s.openPaper(id);s.capability('annotation').forDocument(id).createAnnotation(1,{id:'quick-close-mark',type:5,pageIndex:1,rect:{origin:{x:30,y:30},size:{width:180,height:20}},color:'#fff19a',opacity:0.4,strokeWidth:1,strokeColor:'#e5b143',flags:[],created:new Date()});const lateUI=s.capability('ui').forDocument(id),lateZoom=s.capability('zoom').forDocument(id);await s.capability('document-manager').closeDocument(id).toPromise();if(!lateUI.getState()||!lateZoom.getState())throw new Error('Late toolbar effects lost state');await s.flush();await s.openPaper(id,2);});
  assert.ok(await page.evaluate(()=>{const s=window.__suPaper;return !!s.capability('annotation').forDocument(s.getState().papers[0].id).getAnnotationById('quick-close-mark')}));
  await chat.locator('#prompt').fill('SLOW_STREAM：保留已生成部分');await chat.locator('#send-button').click();
  await chat.waitForFunction(()=>{const c=window.__suPaper.getState().conversations.find(c=>c.id===document.getElementById('conversation-select').value);return c.messages.at(-1)?.status==='streaming'&&c.messages.at(-1)?.content.length>5;});
  await chat.locator('#prompt').fill('DRAFT_SURVIVES_CLOSE');
  await desktop.evaluate(({BaseWindow})=>BaseWindow.getAllWindows().find(w=>w.getTitle()==='对话 — Flow Paper').close());
  await page.waitForFunction(async()=>!(await window.paper.researchLayout()).visible);
  await chat.waitForFunction(()=>!document.getElementById('send-button').hidden);
  await chat.evaluate(()=>window.__suPaper.flush());
  const afterClose=JSON.parse(await readFile(path.join(dataDir,'workspace.json'),'utf8'));
  assert.equal(afterClose.conversations.at(-1).messages.at(-1).status,'cancelled');
  assert.ok(afterClose.conversations.at(-1).messages.at(-1).content.length>5);
  console.log('PASS closing a streaming chat saves its partial answer and cancels the request');
  await page.locator('#open-chat').click();const reopened=chat;
  await page.waitForFunction(async()=>(await window.paper.researchLayout()).visible);
  assert.equal(await reopened.locator('#prompt').inputValue(),'DRAFT_SURVIVES_CLOSE');
  await reopened.waitForFunction(()=>!!window.__suPaper);await reopened.locator('#notes-tab').click();
  assert.match(await reopened.locator('#notes-editor').inputValue(),/UNSAVED_NOTE_DRAFT/);
  assert.equal((await reopened.locator('#conversation-select option').count()),2);
  console.log('PASS chat reopen and immediate PDF tab close preserve notes, history and annotations');
  assert.deepEqual(errors,[]);
  await desktop.close();desktop=null;
  desktop=await electron.launch({...launchOptions,env:{...process.env,FLOW_PAPER_DATA_DIR:dataDir},timeout:60000});
  const restored=await desktop.firstWindow();
  await restored.waitForFunction(()=>{const s=window.__suPaper;if(!s)return false;try{return s.capability('annotation').forDocument(s.getState().papers[0].id).getAnnotationById('quick-close-mark');}catch{return false;}},undefined,{timeout:30000});
  stored=JSON.parse(await readFile(path.join(dataDir,'workspace.json'),'utf8'));
  assert.equal(stored.conversations.length,2);assert.match(stored.notes,/UNSAVED_NOTE_DRAFT/);assert.equal(JSON.stringify(stored).includes('TEMP_PRIVATE_SENTINEL'),false);
  console.log('PASS restart, annotation restoration, no ephemeral data persisted, no renderer errors');
} catch(e) {
  if(desktop) { const pages=desktop.windows(); for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:path.join(output,`failure-${i}.png`)}).catch(()=>{}); }
  throw e;
} finally {
  if(desktop)await desktop.close();
  await new Promise(r=>server.close(r));
  if(zoteroAvailable)await new Promise(r=>zoteroServer.close(r));
}
