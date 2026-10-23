// Use an existing Playwright installation; it is not a runtime/preview dependency.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const { chromium, webkit, firefox } = await import(process.env.ORB_PLAYWRIGHT_MODULE || 'playwright');
const { PNG } = await import(process.env.ORB_PNG_MODULE || 'pngjs');
const base = process.env.ORB_PREVIEW_URL || 'http://127.0.0.1:8796/dev/metal-orbs/';
const output = resolve(process.env.ORB_ARTIFACT_DIR || '/tmp/zigs-metal-orb-qa');
await mkdir(output, { recursive: true });
const reports = [], pixels = [];
for (const [name, engine, options] of [
  ['chromium', chromium, { channel: 'chrome' }], ['webkit', webkit, {}],
  ...(process.env.ORB_FIREFOX_EXECUTABLE ? [['firefox', firefox, { executablePath: process.env.ORB_FIREFOX_EXECUTABLE }]] : []),
]) {
  const browser = await engine.launch({ headless: true, ...options });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base); await page.waitForFunction(() => !!window.orbPreview);
    const result = await page.evaluate(async () => {
      const { descriptors } = window.orbPreview;
      const { fallbackSvg } = await import('./fallback.js');
      const { radiusAt } = await import('./identity.js');
      const { imageFor, releaseStudio } = await import('./avatar.js');
      // Fill all 24 cache records, including offscreen identities.
      const cached = [];
      for (const p of descriptors) cached.push(await imageFor(p));
      releaseStudio();
      const { createStudio } = await import('./renderer.js');
      let studio;
      const passes = [];
      try {
        for (let pass = 0; pass < 2; pass++) {
          studio = createStudio(); const images = [];
          for (const p of descriptors) { images.push(studio.render(p)); await new Promise((r) => setTimeout(r, 0)); }
          passes.push(images); studio.dispose(); studio = null;
        }
      } catch (e) { passes.push({ error: e.message }); }
      finally { studio?.dispose(); }
      return { descriptors, cached, passes,
        svg: descriptors.map(fallbackSvg),
        surface: descriptors.map((p) => Array.from({length:128}, (_,i) => {
          const y = i / 64 - 1, t = i * 2.399963229728653, r = Math.sqrt(1-y*y);
          return radiusAt(p, Math.cos(t)*r, y, Math.sin(t)*r).toFixed(6);
        })) };
    });
    for (const p of result.descriptors) assert.equal(p.digest, createHash('sha256').update(p.input).digest('hex'));
    assert.equal(result.descriptors.length, 24); assert.equal(new Set(result.svg).size, 24);
    const fresh = Array.isArray(result.passes[0]) && Array.isArray(result.passes[1]);
    if (fresh) {
      assert.deepEqual(result.passes[0], result.passes[1], `${name}: fresh studios must repeat exactly`);
      assert.equal(new Set(result.passes[0]).size, 24);
      for (const url of result.passes[0]) {
        const png = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
        assert.equal(png.width, 192); assert.equal(png.height, 192);
        assert.ok(png.data.some((v,i) => i%4===3 && v>0));
      }
      pixels.push({name, urls: result.passes[0], svg: result.svg, surface: result.surface, descriptors:result.descriptors});
    }
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.reload(); await page.waitForFunction(() => !!window.orbPreview);
    await page.waitForFunction(() => [...document.querySelectorAll('#hero img')].every((i) => i.dataset.state !== 'loading'));
    const warm = await page.evaluate(() => ({...window.orbPreview.metrics}));
    if (fresh) {
      assert.equal(warm.renders, 0, 'warm reload must avoid GPU renders');
      assert.ok(warm.cacheHits > 0);
      assert.ok(!requests.some((url) => /renderer\.js|vendor\/three\.js/.test(url)), 'cache hits must not load Three.js');
    }
    await page.evaluate(() => scrollTo(0,0));
    await page.screenshot({ path: `${output}/${name}-desktop.png`, fullPage: false });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(async () => { scrollTo(0,0); await document.fonts.ready;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflow at ${width}`);
      await page.screenshot({ path: `${output}/${name}-${width}.png` });
    }
    // Full gallery visual record, after activating every lazy image.
    await page.setViewportSize({ width:1440, height:1000 });
    await page.evaluate(async () => {
      for (const card of document.querySelectorAll('.orb-card')) { card.scrollIntoView(); await new Promise(r=>setTimeout(r,25)); }
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.orb-card img')].every((i) => i.dataset.state !== 'loading'));
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.orb-card')].every(card => new Set([...card.querySelectorAll('img')].map(i=>i.src)).size === 1)), 'all four sizes share one static image');
    await page.evaluate(() => scrollTo(0,0));
    await page.screenshot({ path: `${output}/${name}-collection.png`, fullPage: true });
    await page.locator('#svg-toggle').click();
    await page.waitForFunction(() => [...document.querySelectorAll('#hero img')].every((i) => i.dataset.state === 'svg'));
    await page.screenshot({ path: `${output}/${name}-svg.png`, fullPage: false });
    await page.locator('#chain').selectOption('eip155:1');
    await page.locator('#address').fill('not an address'); await page.locator('#identity-form button').click();
    assert.match(await page.locator('#input-error').innerText(), /public EVM address/);
    assert.deepEqual(errors, []);
    const resilience = await page.evaluate(async () => {
      const { clearImages, writeImage, readImage } = await import('./cache.js');
      const { imageFor, releaseStudio, metrics } = await import('./avatar.js');
      const { describeOrb } = await import('./identity.js');
      await clearImages(); releaseStudio();
      let context;
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type,...args) {
        const result=original.call(this,type,...args); if(type==='webgl2') context=result; return result;
      };
      const first=await imageFor(await describeOrb('eip155:1','0x0000000000000000000000000000000000000001'));
      const loss=context?.getExtension('WEBGL_lose_context');
      if(loss) { loss.loseContext(); await new Promise(r=>setTimeout(r,80)); }
      const second=await imageFor(await describeOrb('eip155:1','0x0000000000000000000000000000000000000002'));
      HTMLCanvasElement.prototype.getContext=original;
      const lossFallback=!loss || second.mode==='svg';
      releaseStudio();
      for(let i=0;i<110;i++) await writeImage(`test:${i}`, first.src);
      const db=await new Promise((res,rej)=>{const r=indexedDB.open('zigs-metal-orb-preview-v1',1);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
      const count=await new Promise(res=>{const r=db.transaction('images').objectStore('images').count();r.onsuccess=()=>res(r.result);});db.close();
      const evicted=await readImage('test:0')===null;
      await clearImages();
      return {lossFallback,cacheEntries:count,evicted,activeContexts:metrics.activeContexts};
    });
    assert.ok(resilience.lossFallback,'context loss must fall back');
    assert.ok(resilience.cacheEntries<=96,'persistent cache bounded'); assert.ok(resilience.evicted);
    assert.equal(resilience.activeContexts,0);
    await context.close();
    const fallbackContext = await browser.newContext();
    await fallbackContext.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        if (type === 'webgl2') return null;
        return original.call(this, type, ...args);
      };
      Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('Blocked for QA', 'SecurityError'); } });
    });
    const fallbackPage = await fallbackContext.newPage();
    await fallbackPage.goto(base); await fallbackPage.waitForFunction(() => !!window.orbPreview);
    const fallbacks = await fallbackPage.evaluate(async () => {
      const { imageFor, metrics } = await import('./avatar.js');
      const results = await Promise.all(window.orbPreview.descriptors.map(p => imageFor(p)));
      return { modes: results.map(r=>r.mode), unique:new Set(results.map(r=>r.src)).size, metrics };
    });
    assert.ok(fallbacks.modes.every((m)=>m==='svg')); assert.equal(fallbacks.unique,24);
    assert.equal(fallbacks.metrics.activeContexts,0);
    await fallbackContext.close();
    reports.push({ engine:name, version:browser.version(), identities:24, uniqueSVGs:24,
      freshPNGRepeat: fresh ? '24/24 exact across two fresh studios' : result.passes,
      warmCache: warm, resilience, noWebGLAndBlockedStorage:'24 distinct SVGs', desktopAndMobileOverflow:'passed 1440/390/320', errors });
  } finally { await browser.close(); }
}
for (const b of pixels.slice(1)) {
  const a = pixels[0];
  assert.deepEqual(a.descriptors,b.descriptors,'cross-engine descriptors');
  assert.deepEqual(a.svg,b.svg,'cross-engine SVG source');
  assert.deepEqual(a.surface,b.surface,'cross-engine quantized surface');
  let sum=0, count=0, max=0;
  const perImage=[];
  for(let i=0;i<24;i++) {
    const p=PNG.sync.read(Buffer.from(a.urls[i].split(',')[1],'base64')).data;
    const q=PNG.sync.read(Buffer.from(b.urls[i].split(',')[1],'base64')).data;
    let diff=0;
    for(let j=0;j<p.length;j++) { const d=Math.abs(p[j]-q[j]);diff+=d;sum+=d;count++;max=Math.max(max,d); }
    perImage.push(Number((diff/p.length).toFixed(4)));
  }
  assert.ok(sum/count < 1.5, 'cross-engine mean PNG difference below 1.5/255');
  assert.ok(perImage.every(mean => mean < 2), 'every identity visually consistent across engines');
  reports.push({crossEngine:{engines:[a.name,b.name],descriptor:'exact',svgSource:'exact',surface6Decimals:'exact',
    pngMeanAbsoluteChannelDifference:Number((sum/count).toFixed(4)),pngMaximumChannelDifference:max,perImageMean:perImage}});
}
await writeFile(`${output}/report.json`,JSON.stringify(reports,null,2)+'\n');
console.log(JSON.stringify(reports,null,2));
