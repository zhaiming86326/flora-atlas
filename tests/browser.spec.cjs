const {chromium}=require('playwright'),http=require('http'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../public'),out=path.resolve(__dirname,'../../qa');fs.mkdirSync(out,{recursive:true});
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml','.otf':'font/otf','.sql':'text/plain','.md':'text/plain'};
const server=http.createServer((req,res)=>{const uri=decodeURIComponent(req.url.split('?')[0]);const f=path.join(root,uri==='/'?'index.html':uri);if(!f.startsWith(root+path.sep)){res.writeHead(403).end();return}try{res.setHeader('Content-Type',MIME[path.extname(f)]||'text/plain');res.end(fs.readFileSync(f))}catch{res.writeHead(404).end()}});
(async()=>{
 await new Promise(r=>server.listen(4173,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.FLORA_QA_CHROMIUM||'/workspace/scratch/abff4305c075/browser-bin/chromium',headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-zygote']});
 const context=await browser.newContext({viewport:{width:1920,height:1080},permissions:['clipboard-read','clipboard-write']});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base='http://127.0.0.1:4173/';const check=async(test,fn)=>{await fn();console.log('PASS',test)};
 try{
 await page.goto(base,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);
 await check('initial data, photos and primary action visible',async()=>{assert.equal(await page.locator('.plant-card').count(),6);assert.match(await page.locator('#result-count').innerText(),/12/);assert.equal(await page.locator('#search-form button').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(41, 78, 62)');assert(await page.locator('img').evaluateAll(els=>els.every(i=>i.complete&&i.naturalWidth>0)));});
 await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
 const settled=async target=>{
   await target.evaluate(()=>new Promise(resolve=>{let last=scrollY,stable=0;function tick(){if(Math.abs(last-scrollY)<1)stable++;else stable=0;last=scrollY;if(stable>=8)resolve();else requestAnimationFrame(tick)}requestAnimationFrame(tick)}));
 };
 const active=async(target,view)=>{
   await target.waitForFunction(v=>document.querySelector('[data-nav].active')?.dataset.nav===v,view);
   assert.equal(await target.locator('[data-nav].active').count(),1);
   assert.equal(await target.locator(`[data-nav="${view}"]`).getAttribute('aria-current'),'location');
 };
 await check('1920×1080 readable typography and no overflow',async()=>{
   const sizes=await page.evaluate(()=>Object.fromEntries(['body','#search','.site-header nav a','.card-heading h3','.sources-intro p:not(.eyebrow)'].map(s=>[s,parseFloat(getComputedStyle(document.querySelector(s)).fontSize)])));
   assert(sizes.body>=16&&sizes['#search']>=16&&sizes['.site-header nav a']>=16&&sizes['.card-heading h3']>=24&&sizes['.sources-intro p:not(.eyebrow)']>=16);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(out,'desktop-1920.png')});
 });
 await check('navigation underline follows clicks, reload, history and keyboard',async()=>{
   await page.locator('[data-nav="taxonomy"]').click();await active(page,'taxonomy');await settled(page);await active(page,'taxonomy');
   assert.equal(new URL(page.url()).hash,'#taxonomy');await page.screenshot({path:path.join(out,'desktop-taxonomy.png')});
   await page.reload({waitUntil:'networkidle'});await settled(page);await active(page,'taxonomy');
   await page.locator('[data-nav="sources"]').click();await active(page,'sources');await settled(page);await active(page,'sources');
   await page.screenshot({path:path.join(out,'desktop-sources.png')});
   await page.goBack();await settled(page);await active(page,'taxonomy');
   await page.goForward();await settled(page);await active(page,'sources');
   await page.locator('[data-nav="explore"]').focus();await page.keyboard.press('Enter');await settled(page);await active(page,'explore');
 });
 await check('manual scroll follows sources and remembers taxonomy choice',async()=>{
   await page.locator('[data-nav="taxonomy"]').click();await settled(page);await active(page,'taxonomy');
   await page.mouse.wheel(0,10000);await settled(page);await active(page,'sources');
   await page.evaluate(()=>window.scrollTo({top:document.querySelector('#taxonomy').getBoundingClientRect().top+scrollY-128,behavior:'instant'}));
   await settled(page);await active(page,'taxonomy');
 });
 await page.goto(base,{waitUntil:'networkidle'});

 await check('Chinese, Latin and historical synonym search',async()=>{for(const q of ['银杏','GINKGO BILOBA','  Ginkgo    biloba ']){await page.locator('#search').fill(q);assert.equal(await page.locator('.plant-card').count(),1);assert(await page.locator('[data-slug="ginkgo-biloba"]').count())}await page.locator('#search').fill('Rosmarinus officinalis');assert(await page.locator('[data-slug="salvia-rosmarinus"]').count());await page.locator('#search').press('Enter');});
 await check('empty state and reset',async()=>{await page.locator('#search').fill('不存在的植物XYZ');assert.equal(await page.locator('.plant-card').count(),0);assert.equal(await page.locator('.empty-state').count(),1);await page.locator('.empty-state button').click();assert.equal(await page.locator('.plant-card').count(),6)});
 await check('family + use + genus intersection',async()=>{await page.locator('[data-family="Lamiaceae"]').click();assert.equal(await page.locator('.plant-card').count(),4);await page.locator('button[data-use="食用"]').click();assert.equal(await page.locator('.plant-card').count(),3);await page.locator('#genus-filter').selectOption('Mentha');assert.equal(await page.locator('.plant-card').count(),1);assert(await page.locator('[data-slug="mentha-spicata"]').count());await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('.plant-card').count(),1);});
 await check('detail, provenance and direct URL reload',async()=>{await page.locator('.card-heading').click();await page.locator('#detail-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#dialog-title').innerText(),'留兰香');await page.locator('[data-tab="provenance"]').click();assert.match(await page.locator('#detail-panel').innerText(),/CC BY 2.0/);assert.match(await page.locator('#detail-panel').innerText(),/Wikidata/);await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('#dialog-title').innerText(),'留兰香');await page.locator('[data-action="copy-name"]').click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/Mentha spicata/);await page.locator('[data-tab="uses"]').click();assert.match(await page.locator('#detail-panel').innerText(),/调味/);await page.screenshot({path:path.join(out,'detail.png')});await page.keyboard.press('Escape');assert.equal(await page.locator('#detail-dialog').isVisible(),false)});
 await check('pagination, sorting and list view',async()=>{await page.locator('.aside-title [data-action="reset"]').click();await page.locator('[aria-label="第 2 页"]').click();assert.equal(await page.locator('.plant-card').count(),6);assert(await page.locator('[data-slug="adiantum-capillus-veneris"]').count());await page.locator('[data-view="list"]').click();assert(await page.locator('#results').evaluate(el=>el.classList.contains('list-view')));await page.locator('#sort').selectOption('latin');assert.equal(await page.locator('.plant-card').first().getAttribute('data-slug'),'adiantum-capillus-veneris')});
 await check('source credits, schema and data download',async()=>{await page.locator('[data-action="credits"]').click();assert.equal(await page.locator('.credit-item').count(),12);await page.locator('[data-action="close"]').click();await page.locator('[data-action="architecture"]').click();assert.equal(await page.locator('.schema-list article').count(),4);await page.locator('[data-action="close"]').click();const download=page.waitForEvent('download');await page.locator('a[download="flora-demo.json"]').click();const d=await download;assert.equal(d.suggestedFilename(),'flora-demo.json');const p=await d.path();assert.equal(JSON.parse(fs.readFileSync(p)).plants.length,12)});
 await check('invalid record and untrusted query are safe',async()=>{await page.goto(base+'?q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E#plant/missing',{waitUntil:'networkidle'});assert.match(await page.locator('#dialog-title').innerText(),/尚未收录/);await page.keyboard.press('Escape');assert.equal(await page.locator('.plant-card').count(),0)});
 await check('1440px and 1280px desktop layouts stay within viewport',async()=>{
   for(const width of [1440,1280]){await page.setViewportSize({width,height:1000});await page.goto(base,{waitUntil:'networkidle'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 });
 const mobile=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});const m=await mobile.newPage();m.on('pageerror',e=>errors.push(e.message));await m.goto(base,{waitUntil:'networkidle'});await m.evaluate(()=>document.fonts.ready);
 await check('mobile layout, filter and detail interaction',async()=>{assert(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await m.screenshot({path:path.join(out,'mobile.png'),fullPage:true});await m.locator('[data-nav="taxonomy"]').click();await settled(m);await active(m,'taxonomy');assert.equal(await m.locator('[data-action="filters"]').getAttribute('aria-expanded'),'true');await m.locator('[data-group="ferns"]').click();assert.equal(await m.locator('.plant-card').count(),1);await m.locator('.card-heading').click();assert.equal(await m.locator('#dialog-title').innerText(),'铁线蕨');await m.locator('[data-tab="provenance"]').click();assert.match(await m.locator('#detail-panel').innerText(),/CC0/);await m.screenshot({path:path.join(out,'mobile-detail.png')});await m.locator('[data-action="close"]').click();});
 await check('narrow phone has no horizontal overflow',async()=>{await m.setViewportSize({width:320,height:740});await m.goto(base,{waitUntil:'networkidle'});assert(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));});
 assert.deepEqual(errors,[]);console.log('PASS no browser runtime errors');fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({status:'passed',browser:'Chromium',desktop:['1920x1080','1440x1000','1280x1000'],mobile:['390x844','320x740'],browserErrors:errors,date:'2026-09-04'},null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exit(1)});
