// Opt-in: actual Zotero and actual model calls. Never writes the user's main
// workspace or prints keys; this profile is separate from the running app.
import { _electron as electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const titles=JSON.parse(process.env.FLOW_PAPER_REAL_TITLES || '[]');
assert.equal(titles.length,2,'Set FLOW_PAPER_REAL_TITLES to two paper title prefixes; this opt-in test sends real paper content to your model.');
const output=path.resolve('test-output/real');await mkdir(output,{recursive:true});
const report={started:new Date().toISOString(),steps:[],errors:[]};
const record=(name,details={})=>{report.steps.push({name,...details});console.log(name,JSON.stringify(details));};
let desktop;
try{
 desktop=await electron.launch({args:['.'],env:{...process.env,SU_PAPER_DATA_DIR:path.join(output,'profile')},timeout:60000});
 const page=await desktop.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));
 await page.waitForFunction(()=>!!window.__suPaper);
 await page.locator('#zotero-button').click();
 await page.waitForFunction(()=>window.__suPaper.getState().papers.length>10&&!document.getElementById('zotero-button').disabled);
 record('Connected real Zotero',{papers:await page.locator('#paper-count').textContent()});
 const papers=await page.evaluate(titles=>titles.map(t=>window.__suPaper.getState().papers.find(p=>p.title.includes(t))),titles);assert.ok(papers.every(Boolean));
 for(const p of papers){const started=Date.now();await page.evaluate(id=>window.__suPaper.openPaper(id),p.id);record('Opened real PDF',{title:p.title,milliseconds:Date.now()-started});}
 await page.evaluate(id=>window.__suPaper.openPaper(id,1),papers[0].id);
 const models=await page.evaluate(()=>window.paper.zoteroModels());
 await page.locator('#settings-button').click();await page.locator('#load-zotero-models').click();await page.locator('#import-zotero-model').click();
 const model=models.find(m=>m.preferred)||models[0];record('Imported Zotero model',{model:model.model});
 await page.waitForTimeout(500);
 const box=await page.locator('#pdf-viewer img').evaluateAll(images=>images.map(img=>{const b=img.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height}}).filter(b=>b.width>250&&b.y>=50&&b.y<500).sort((a,b)=>b.width-a.width)[0]);
 assert.ok(box,'paper rendered');const scale=box.width/612;
 await page.screenshot({path:path.join(output,'before-selection.png')});
 record('Selection geometry',{box,pdf:await page.evaluate(id=>window.__suPaper.capability('document-manager').getDocument(id).pages[0],papers[0].id)});
 await page.mouse.move(box.x+145*scale,box.y+296*scale);await page.mouse.down();await page.mouse.move(box.x+468*scale,box.y+309*scale,{steps:12});await page.mouse.up();
 await page.locator('#quick-menu').waitFor({state:'visible'});record('Selected real abstract');
 const before=(await page.evaluate(()=>window.paper.load())).conversations.length;
 await page.locator('#quick-ask').click();
 async function temporary(prompt,label){const started=Date.now();await page.locator('#quick-prompt').fill(prompt);await page.locator('#quick-send').click();await page.waitForFunction(()=>!document.getElementById('quick-send').hidden&&document.getElementById('quick-answer').textContent.length>40,undefined,{timeout:120000});assert.equal(await page.locator('.quick-error').count(),0);const answer=await page.locator('#quick-answer').textContent();record(label,{milliseconds:Date.now()-started,answer});}
 await temporary('请简要翻译所选摘要为中文，保留关键术语。100字以内。','Real temporary selection translation');
 assert.equal((await page.evaluate(()=>window.paper.load())).conversations.length,before);
 await page.screenshot({path:path.join(output,'temporary-selection.png')});
 await page.keyboard.press('Escape');
 assert.equal((await page.evaluate(()=>window.paper.load())).conversations.length,before);
 const cp=desktop.waitForEvent('window');await page.locator('#open-chat').click();const chat=await cp;chat.on('pageerror',e=>report.errors.push(e.message));await chat.waitForFunction(()=>!!window.__suPaper);
 await chat.locator('#new-chat').click();
 await page.locator('#library-search').fill('Credit Assignment');for(const p of papers)await page.locator(`[data-id="${p.id}"] input`).check();
 await chat.waitForFunction(()=>document.getElementById('scope-label').textContent.includes('2 篇'));
 const started=Date.now();await chat.locator('#prompt').fill('比较这两篇论文怎样解决强化学习的信用分配：共同点和关键差异各一点。150字以内，分别给出原文页码链接。');await chat.locator('#send-button').click();
 await chat.waitForFunction(()=>document.querySelector('.message.assistant')&&!document.getElementById('send-button').hidden,undefined,{timeout:120000});
 const answer=await chat.evaluate(()=>window.__suPaper.getState().conversations.find(c=>c.id===document.getElementById('conversation-select').value).messages.at(-1));
 assert.equal(answer.status,'complete');assert.equal(answer.coverage.total,2);record('Real independent multi-paper conversation',{milliseconds:Date.now()-started,answer:answer.content});
 await chat.screenshot({path:path.join(output,'independent-conversation.png')});
 const vision=models.find(m=>m.protocol==='codex_responses')||model;
 await page.evaluate(id=>window.paper.importZoteroModel(id),vision.id);record('Vision model',{model:vision.model});
 await page.bringToFront();await page.evaluate(id=>window.__suPaper.openPaper(id,2),papers[0].id);
 await page.evaluate(id=>window.__suPaper.capability('capture').forDocument(id).captureArea(1,{origin:{x:60,y:15},size:{width:490,height:320}}),papers[0].id);
 await page.locator('#quick-source img').waitFor();await page.getByAltText('Captured PDF area').waitFor({state:'hidden'});
 await temporary('只根据截图，用中文简要解释这张图。看不清请说明。100字以内。','Real temporary figure question');
 await page.screenshot({path:path.join(output,'temporary-figure.png')});
 await page.keyboard.press('Escape');
 await page.evaluate(()=>window.__suPaper.flush());assert.deepEqual(report.errors,[]);
 record('Real redesigned workflow passed');
}catch(e){if(desktop)await desktop.windows()[0].screenshot({path:path.join(output,'ui-failure.png')}).catch(()=>{});report.failure=e.message;console.error('REAL_TEST_FAILED',e.message);process.exitCode=1;}
finally{await writeFile(path.join(output,'ui-report.json'),JSON.stringify(report,null,2));if(desktop)await desktop.close();}
