import {_electron as electron} from 'playwright';
import {writeFile} from 'node:fs/promises';import path from 'node:path';
const profile=path.resolve('test-output/real/profile');const app=await electron.launch({args:['.'],env:{...process.env,SU_PAPER_DATA_DIR:profile}});const page=await app.firstWindow();
const results=[];
try{
 await page.waitForFunction(()=>!!window.__suPaper);
 const ids=process.env.FLOW_PAPER_PERF_IDS ? JSON.parse(process.env.FLOW_PAPER_PERF_IDS) : await page.evaluate(()=>window.__suPaper.getState().papers.filter(p=>p.indexed&&p.pageCount>=6).slice(0,4).map(p=>p.id));
 if(!ids.length) throw new Error('No indexed papers with 6+ pages in the opt-in test profile. Run the real-library fixture first.');
 for(const id of ids){
  const t=Date.now();await page.evaluate(id=>window.__suPaper.openPaper(id),id);
  const info=await page.evaluate(id=>{const s=window.__suPaper,p=s.getState().papers.find(p=>p.id===id);return {id,title:p.title,pages:p.pageCount,zoom:s.capability('zoom').getState().currentZoomLevel}},id);
  info.openMs=Date.now()-t;
  await page.evaluate(()=>{window.__perf={longTasks:[],frames:[],running:true};const p=window.__perf;new PerformanceObserver(l=>p.longTasks.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask'});let last=performance.now();const frame=t=>{p.frames.push(t-last);last=t;if(p.running)requestAnimationFrame(frame)};requestAnimationFrame(frame);});
  await page.evaluate(id=>window.__suPaper.openPaper(id,Math.min(5,window.__suPaper.getState().papers.find(p=>p.id===id).pageCount)),id);
  await page.waitForTimeout(650);
  info.jumpPage=await page.evaluate(id=>window.__suPaper.capability('scroll').forDocument(id).getCurrentPage(),id);
  const box=await page.locator('#pdf-viewer').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  for(let i=0;i<30;i++){await page.mouse.wheel(0,280);await page.waitForTimeout(45);}
  info.performance=await page.evaluate(()=>{const p=window.__perf;p.running=false;const f=p.frames.sort((a,b)=>a-b);return {frames:f.length,p50:f[Math.floor(f.length*.5)],p95:f[Math.floor(f.length*.95)],max:Math.max(...f),longTasks:p.longTasks}});
  console.log(JSON.stringify(info));results.push(info);
 }
 // Source link must work when opening a previously closed document, not only an existing tab.
 await page.evaluate(async id=>{const s=window.__suPaper;await s.capability('document-manager').closeDocument(id).toPromise();await s.openPaper(id,6)},ids[0]);
 await page.waitForTimeout(700);
 const reopen=await page.evaluate(()=>window.__suPaper.capability('scroll').getCurrentPage());console.log('REOPEN_AT_PAGE_6',reopen);results.push({reopenTarget:6,actual:reopen});
 await page.screenshot({path:path.resolve('test-output/real/large-paper.png')});
}finally{await writeFile('test-output/real/performance.json',JSON.stringify(results,null,2));await app.close();}
