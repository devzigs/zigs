// Preview-only browser acceptance tests. Use existing Playwright/pngjs QA installations.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium, webkit, firefox } = await import(process.env.ORB_PLAYWRIGHT_MODULE || 'playwright');
const { PNG } = await import(process.env.ORB_PNG_MODULE || 'pngjs');
const base = new URL('flow.html', process.env.ORB_PREVIEW_URL || 'http://127.0.0.1:8796/dev/metal-orbs/').href;
const output = resolve(process.env.ORB_ARTIFACT_DIR || '/tmp/zigs-orb-reveal-qa');
await mkdir(output, { recursive: true });
const reports = [], comparisons = [];
const engines = [['chromium', chromium, { channel: 'chrome' }], ['webkit', webkit, {}],
  ...(process.env.ORB_FIREFOX_EXECUTABLE ? [['firefox', firefox, { executablePath:process.env.ORB_FIREFOX_EXECUTABLE }]] : [])];
async function loaded(page) {
  await page.waitForFunction(() => window.orbFlow?.descriptor && [...document.querySelectorAll('#flow-page img')]
    .every(i => !['loading','unavailable'].includes(i.dataset.state)));
}
const overflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
for (const [name, engine, options] of engines) {
  const browser = await engine.launch({ headless:true, ...options });
  try {
    const context = await browser.newContext({ viewport:{width:1440,height:1100} });
    const page = await context.newPage(), errors = [], external = [];
    page.on('pageerror', e=>errors.push(e.message));
    page.on('request', r=>{ if (!r.url().startsWith(new URL(base).origin) && !r.url().startsWith('data:')) external.push(r.url()); });
    await page.goto(base); await loaded(page);
    await page.waitForFunction(()=>document.querySelector('[data-reveal]')?.dataset.reveal==='first');
    const ordinary = await page.evaluate(()=>({digest:window.orbFlow.descriptor.digest, traits:window.orbFlow.descriptor.traits}));
    assert.equal(ordinary.traits.rare,false);
    assert.equal(await page.locator('.rare-detail').count(),0);
    assert.ok(!/common/i.test(await page.locator('#flow-page').innerText()));
    assert.equal(await page.locator('[data-surface=setup] img').getAttribute('width'),'96');
    await overflow(page);
    await page.screenshot({path:`${output}/${name}-setup-standard.png`,fullPage:true,animations:'disabled'});
    await page.locator('#example-ember').click(); await loaded(page);
    await page.waitForFunction(()=>document.querySelector('[data-reveal]')?.dataset.reveal==='first');
    const rare = await page.evaluate(()=>({digest:window.orbFlow.descriptor.digest, traits:window.orbFlow.descriptor.traits}));
    assert.equal(rare.traits.rare,true); assert.notEqual(rare.digest,ordinary.digest);
    assert.equal(await page.locator('.rare-detail').innerText(),'Ember inlay · Rare finish');
    assert.equal(await page.locator('.rare-find').innerText(),'A rare find.');
    await page.locator('.how-made summary').click();
    assert.match(await page.locator('.how-made').innerText(),/approximately 5%/);
    assert.match(await page.locator('.how-made').innerText(),/SHA-256/);
    await page.locator('.how-made summary').click();
    await page.screenshot({path:`${output}/${name}-setup-rare.png`,fullPage:true,animations:'disabled'});
    await page.locator('#open-overview').click(); await loaded(page);
    assert.equal(await page.locator('[data-surface=heading] img').getAttribute('width'),'48');
    assert.equal(await page.locator('[data-surface=identity-card] img').getAttribute('width'),'64');
    assert.deepEqual(await page.locator('.device-initials').allTextContents(),['TB','SD','RD']);
    assert.equal(await page.locator('#flow-page').getAttribute('data-identity'),rare.digest);
    await page.screenshot({path:`${output}/${name}-overview.png`,fullPage:true,animations:'disabled'});
    await page.locator('#switcher-toggle').click();
    assert.equal(await page.locator('#switcher-toggle').getAttribute('aria-expanded'),'true');
    assert.ok((await page.locator('#switcher-options img').evaluateAll(images=>images.every(i=>i.width===32))));
    assert.equal(await page.locator('#wallet-switcher .rare-detail').count(),0);
    await page.screenshot({path:`${output}/${name}-switcher.png`,fullPage:true,animations:'disabled'});
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#switcher-toggle').getAttribute('aria-expanded'),'false');
    assert.ok(await page.locator('#switcher-toggle').evaluate(n=>n===document.activeElement));
    await page.locator('#overview-receive').click(); await loaded(page);
    assert.equal(await page.locator('[data-surface=receive] img').getAttribute('width'),'96');
    assert.equal(await page.locator('[data-receive-network]').getAttribute('data-receive-network'),'zcash:testnet');
    assert.equal(await page.locator('.receive-card .rare-detail').count(),0);
    await page.screenshot({path:`${output}/${name}-receive-zec.png`,fullPage:true,animations:'disabled'});
    await page.locator('#receive-sol').click(); await loaded(page);
    assert.equal(await page.locator('[data-receive-network]').getAttribute('data-receive-network'),'solana:devnet');
    assert.equal(await page.locator('#flow-page').getAttribute('data-identity'),rare.digest);
    assert.match(await page.locator('.destination-label').innerText(),/Shielded protocol/);
    await page.screenshot({path:`${output}/${name}-receive-sol.png`,fullPage:true,animations:'disabled'});
    await page.locator('#preview-controls summary').click();
    await page.locator('#flow-name').fill('Renamed studio'); await page.locator('#flow-name').press('Tab');
    assert.equal(await page.locator('.receive-wallet-name').innerText(),'Renamed studio');
    await page.locator('#flow-device').selectOption('Second device');
    await page.locator('#flow-solana').uncheck();
    assert.equal(await page.locator('#receive-sol').count(),0);
    assert.equal(await page.locator('#flow-page').getAttribute('data-identity'),rare.digest);
    await page.locator('#flow-solana').check();
    await page.locator('#view-setup').click(); await loaded(page);
    await page.waitForFunction(()=>document.querySelector('[data-reveal]')?.dataset.reveal==='settled');
    assert.equal(await page.locator('.identity-reveal').count(),0,'navigation/rename/device/Solana must not replay reveal');
    await page.locator('#flow-verified').uncheck();
    assert.equal(await page.locator('#flow-page').getAttribute('data-identity'),'');
    assert.equal(await page.locator('#flow-page img').count(),0,'no orb before verified public address');
    assert.ok(await page.locator('#view-overview').isDisabled());
    await page.locator('#flow-verified').check(); await loaded(page);
    assert.equal(await page.locator('#flow-page').getAttribute('data-identity'),rare.digest);
    await page.waitForFunction(()=>document.querySelector('[data-reveal]')?.dataset.reveal==='settled');
    await page.locator('#view-overview').click(); await loaded(page);
    await page.locator('#switcher-toggle').click(); await page.locator('[data-wallet-id=travel]').click(); await loaded(page);
    assert.notEqual(await page.locator('#flow-page').getAttribute('data-identity'),rare.digest);
    await page.locator('#example-ember').click(); await loaded(page);
    await page.locator('#view-setup').click(); await loaded(page);
    // Compare fresh PNGs, and rare vs ordinary treatment with identical geometry parameters.
    const rendering = await page.evaluate(async()=>{
      const { releaseStudio }=await import('./avatar.js');releaseStudio();
      const { createStudio }=await import('./renderer.js');
      const { fallbackSvg }=await import('./fallback.js');
      const { describeWalletIdentity }=await import('./wallet-identity.js');
      const ps=await Promise.all(Object.values(window.orbFlow.fixtures).map(describeWalletIdentity));
      const passes=[];let studio;
      try {for(let j=0;j<2;j++){studio=createStudio();passes.push(ps.map(p=>studio.render(p)));studio.dispose();studio=null;}
        studio=createStudio();const rare=ps.find(p=>p.traits.rare);
        const untreated=studio.render({...rare,traits:{...rare.traits,rare:false,inlay:null}});
        return {passes,untreated,descriptors:ps,svg:ps.map(fallbackSvg)};
      } finally {studio?.dispose();}
    });
    assert.deepEqual(rendering.passes[0],rendering.passes[1],`${name}: exact PNG repeats`);
    const rareIndex=rendering.descriptors.findIndex(p=>p.traits.rare);
    assert.notEqual(rendering.passes[0][rareIndex],rendering.untreated,'Ember inlay changes rendered pixels, not just metadata');
    const decode=(url)=>PNG.sync.read(Buffer.from(url.split(',')[1],'base64')).data;
    const treated=decode(rendering.passes[0][rareIndex]), untreated=decode(rendering.untreated);
    let changed=0;for(let i=0;i<treated.length;i+=4)if(treated.slice(i,i+4).some((v,k)=>v!==untreated[i+k]))changed++;
    assert.ok(changed>30,`${name}: inlay must visibly affect pixels`);
    comparisons.push({name,...rendering});
    await page.locator('#flow-svg').click(); await loaded(page);
    assert.ok(await page.locator('#flow-page img').evaluateAll(images=>images.every(i=>i.dataset.state==='svg')));
    await page.screenshot({path:`${output}/${name}-svg.png`,fullPage:true,animations:'disabled'});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await context.close();
    // Fresh contexts avoid viewport-resize compositor artifacts in mobile screenshots.
    for (const width of [390,320]) {
      const mobile=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'});
      const phone=await mobile.newPage();await phone.goto(base);await loaded(phone);
      await phone.locator('#example-ember').click();await loaded(phone);
      await phone.waitForFunction(()=>document.querySelector('[data-reveal]')?.dataset.reveal==='first');
      assert.equal(await phone.locator('.identity-reveal').count(),0);
      assert.equal(await phone.locator('.reveal-sculpture').evaluate(n=>getComputedStyle(n).animationName),'none');
      await overflow(phone);
      await phone.screenshot({path:`${output}/${name}-setup-${width}.png`,fullPage:true,animations:'disabled'});
      for(const view of ['overview','receive']){await phone.locator(`#view-${view}`).click();await loaded(phone);await overflow(phone);}
      await phone.screenshot({path:`${output}/${name}-receive-${width}.png`,fullPage:true,animations:'disabled'});
      await mobile.close();
    }
    const fallback=await browser.newContext();
    await fallback.addInitScript(()=>{
      const get=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl2'?null:get.call(this,type,...args);};
      Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('Blocked for QA','SecurityError');}});
    });
    const fallbackPage=await fallback.newPage();await fallbackPage.goto(base);await loaded(fallbackPage);
    await fallbackPage.locator('#example-ember').click();await loaded(fallbackPage);
    assert.ok(await fallbackPage.locator('#flow-page img').evaluateAll(images=>images.every(i=>i.dataset.state==='svg')));
    assert.equal(await fallbackPage.evaluate(()=>window.orbFlow.metrics.activeContexts),0);
    assert.equal(await fallbackPage.locator('.rare-detail').innerText(),'Ember inlay · Rare finish');
    assert.ok(await fallbackPage.locator('#open-overview').isEnabled());
    await fallback.close();
    // A delayed renderer must not delay the setup CTA or navigation.
    const loading=await browser.newContext();const waiting=await loading.newPage();
    let unblock;const barrier=new Promise(resolve=>{unblock=resolve;});
    await waiting.route('**/renderer.js',async route=>{await barrier;await route.continue();});
    try {await waiting.goto(base,{waitUntil:'domcontentloaded'});
      await waiting.waitForFunction(()=>window.orbFlow?.descriptor);
      assert.ok(await waiting.locator('#open-overview').isEnabled());
      await waiting.locator('#open-overview').click();
      assert.ok(await waiting.locator('[data-surface=identity-card]').isVisible());
      assert.ok(await waiting.evaluate(()=>window.orbFlow.metrics.renders===0));
    }finally{unblock();await loading.close();}
    reports.push({engine:name,version:browser.version(),identity:'stable across rename/device/Solana; changes with wallet',
      reveal:'once per identity per document',rarity:'real suffix threshold; visible inlay; contextual copy only',
      pngRepeat:'3/3 exact across fresh studios',inlayChangedPixels:changed,surfaces:'32/48/64/96px',
      mobile:'390/320px; reduced motion; no overflow',fallback:'SVG with WebGL and storage unavailable',
      loading:'navigation available before rendering',externalRequests:external.length,pageErrors:errors.length});
  } finally {await browser.close();}
}
for(const b of comparisons.slice(1)){
  const a=comparisons[0];assert.deepEqual(a.descriptors,b.descriptors);assert.deepEqual(a.svg,b.svg);
  const means=[];
  for(let i=0;i<a.passes[0].length;i++){
    const p=PNG.sync.read(Buffer.from(a.passes[0][i].split(',')[1],'base64')).data;
    const q=PNG.sync.read(Buffer.from(b.passes[0][i].split(',')[1],'base64')).data;
    let sum=0;for(let j=0;j<p.length;j++)sum+=Math.abs(p[j]-q[j]);means.push(Number((sum/p.length).toFixed(4)));
  }
  assert.ok(means.every(m=>m<2),'cross-engine mean image difference below 2/255');
  reports.push({crossEngine:[a.name,b.name],descriptors:'exact',svgSource:'exact',meanRGBAChannelDifferences:means});
}
await writeFile(`${output}/flow-report.json`,JSON.stringify(reports,null,2)+'\n');
console.log(JSON.stringify(reports,null,2));
