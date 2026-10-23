import assert from 'node:assert/strict';
// Production-renderer checks in a fresh browser context. Synthetic, unfunded data only.
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const phase = process.argv[2] || 'after';
assert.ok(['before','after'].includes(phase));
const root = resolve('web'), out = resolve(process.env.SETTINGS_QA_DIR ||
  '/tmp/zigs-settings-qa', phase);
mkdirSync(out, { recursive: true });
function fixtureTheme(path, body) {
  if (path === "/" && !body.toString().includes('src="/theme.js"'))
    return body + '<script src="/theme.js"></script>';
  return body;
}
function fixtureSource(path, file) {
  const relative = path === '/' ? 'index.html' : path.slice(1);
  const baseline = ['index.html','app-wallet.js','app-shell.js','app-theme.js','app-help.js',
    'help-model.js'];
  let body = phase === 'before' && baseline.includes(relative)
    ? execFileSync('git',['show','31e9c20:web/' + relative]) : readFileSync(file);
  if (path === '/') body = body.toString().replace(
    /<script\b[^>]*type="module"[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<link[^>]+rel="(?:modulepreload|preload)"[^>]*>/g, '');
  // The current HTML entry loads theme.js from the explicit demo bootstrap.
  // This inert renderer fixture removes that bootstrap and loads only theme setup.
  body = fixtureTheme(path, body);
  // Production renderers and handlers, inert wallet reactor, no app boot or live wallet.
  if (path === '/app-loop.js') body = body.toString().replace('export function react() {',
    'export function react() { return;');
  if (path === '/app-groups.js') body = body.toString().replace('dbReady = false',
    'dbReady = true');
  return body;
}
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = join(root, path === '/' ? 'index.html' : path);
  if (!file.startsWith(root + '/') || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': ({ js:'text/javascript', css:'text/css',
    html:'text/html', png:'image/png', woff2:'font/woff2' })[file.split('.').pop()] ||
      'text/plain' }).end(fixtureSource(path, file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless:true,
  executablePath:process.env.CHROME_EXECUTABLE });
const context = await browser.newContext({ reducedMotion:'reduce', permissions:[
  'clipboard-read','clipboard-write'] });
await context.route('**/*', r => new URL(r.request().url()).origin === origin ? r.continue() :
  r.abort());
const page = await context.newPage(), errors=[], facts=[], checks=[];
const check=(ok,label)=>{checks.push({label,pass:!!ok});console.log('check:',label);assert.ok(
  ok,label);};
page.on('pageerror', e => errors.push(e.message));
async function scene(wallet=true) {
  await page.goto(origin);
  await page.evaluate(async wallet => {
    const { state, ui } = await import('/app-state.js');
    const { draw } = await import('/app-loop.js');
    const g={id:'e1'.repeat(10),name:'Household wallet',t:2,n:3,version:2,network:'testnet'};
    Object.assign(state,{g:wallet?g:null,gid:wallet?g.id:null,groups:wallet?[g]:[],wallet:wallet?{
      birthday:4500000,address:'utest1'+'syntheticaddress'.repeat(12),
        group_verifying_key:'abcd'.repeat(16),ufvk:'uviewtest1'+'syntheticviewingkey'.repeat(12)
    }:null,seats:wallet?{1:{name:'Home device',uid:'one'},2:{name:'Travel device',uid:'two'}}:
      {},sessions:[],log:[]});
    ui.tab='settings';
    globalThis.qa={state,ui,draw};
    globalThis.qa.draw();
  }, wallet);
  await page.waitForTimeout(180);
}
const summary=name=>page.locator('#panel-settings summary').filter({hasText:name}).first();
const button=name=>page.getByRole('button',{name,exact:true});
const settle=()=>page.waitForTimeout(160);

async function addressSafetyChecks() {
  await scene();
  await page.evaluate(async()=>{
    globalThis.qa.state.g.network='mainnet';
    (await import('/app-chain.js')).setChain({gid:globalThis.qa.state.gid,syncing:true,
      bal:{spendable:50000000,pending:0,height:4500000}});
    globalThis.qa.draw();
  });
  check(await page.locator('#panel-settings').innerText().then(t=>t.includes('Zcash Mainnet')&&
    t.includes('Deposits cannot be blocked')),'mainnet risk and real network labels are retained');
  check(await button('Copy address').count()===0,'mainnet cap still hides address and copy');
  await scene();
  await page.evaluate(async()=>{
    (await import('/app-keystore.js')).setSecrets({[globalThis.qa.state.gid+':1']:{uid:'one'}});
    globalThis.qa.draw();
  });
  check(await button('Copy address').count()===0,
    'unverified local signer cannot reveal or copy address');
  await page.evaluate(async()=>{(await import('/app-keystore.js')).setSecrets(
    {});globalThis.qa.draw();});
  await summary('Wallet description').click();
  await page.getByLabel('Edit wallet description',{exact:true}).fill('Unsaved at lock');
  await page.evaluate(async()=>{(await import('/app-keystore.js')).setLocked({
    damaged:true});globalThis.qa.draw();});
  check(await page.locator('#panel-settings').count()===0&&await page.locator(
    'textarea').count()===0,'existing locked state removes Settings and unsaved editor');
}

async function descriptionChecks() {
  await scene(); await page.setViewportSize({width:390,height:844});
  check(await page.locator('.preferences-group>h3').allTextContents().then(x=>x.join('|')===(
    "General|Privacy & Network|Current wallet|Security & "
    + "Device|Messaging account|Help & Support|Advanced"
  )),'section order and all existing destinations');
  check(await page.locator('#panel-settings details[open]').count()===0,
    'secondary details start collapsed');
  await summary('Wallet description').focus(); await page.keyboard.press('Enter');
  const input=page.getByLabel('Edit wallet description',{exact:true});
  await input.fill('Draft to cancel');
  await page.locator('.description-disclosure').getByRole('button',{name:'Cancel',
    exact:true}).click();
  check(await page.evaluate(()=>localStorage.getItem('zf-wallet-description:'+
    globalThis.qa.state.gid))===null,'cancel writes no description');
  check(await summary('Wallet description').evaluate(n=>n===document.activeElement),
    'cancel returns focus to editor summary');
  await summary('Wallet description').click(); await input.fill('Treasury <img src=x>');
  await button('Save description').click(); await settle();
  check(await page.evaluate(()=>JSON.parse(localStorage.getItem('zf-wallet-description:'+
    globalThis.qa.state.gid)).text)==='Treasury <img src=x>',
      'description uses existing explicit local save');
  check(await page.locator('.description-disclosure img').count()===0,
    'description is rendered as text');
  await summary('Wallet description').click();
  await input.fill('Retain this unsaved draft');
  await page.evaluate(()=>{globalThis.originalSetItem=
    Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith(
      'zf-wallet-description:'))throw Error(
        'test storage refusal');return globalThis.originalSetItem.call(this,k,v);};});
  await button('Save description').click();
  check(await input.inputValue()==='Retain this unsaved draft','failed save retains draft');
  check(await page.locator('.wallet-description-editor [role=alert]').innerText().then(
    t=>t.includes('Couldn’t save')),'failed save has accessible error');
  check(await page.locator('#banner').getAttribute('class')==='bad',
    'failed save never reports success');
  await page.evaluate(()=>Storage.prototype.setItem=globalThis.originalSetItem);
  await page.locator('.description-disclosure').getByRole('button',{name:'Cancel',
    exact:true}).click();
  await button('Copy address').click();
  check(await page.evaluate(async()=>await navigator.clipboard.readText()===
    globalThis.qa.state.wallet.address),'copy uses complete canonical address');
  await summary('View full address').click();
  check(await page.locator('.preference-address .addr-full').innerText().then(t=>t.replace(
    /\s/g,'').startsWith('utest1')),'full address can be inspected');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),
    'long expanded address has no mobile overflow');
  await page.evaluate(()=>{globalThis.originalClipboard=navigator.clipboard.writeText.bind(
    navigator.clipboard);navigator.clipboard.writeText=async()=>{throw Error(
      'clipboard refused');};});
  await button('Copy address').click();
  check(await page.locator('#banner').getAttribute('class')==='bad',
    'clipboard failure produces error feedback');
  await page.evaluate(()=>navigator.clipboard.writeText=globalThis.originalClipboard);
}

async function themeChecks() {
  const theme=page.getByLabel('Appearance',{exact:true});
  await theme.selectOption('light');
  check(await page.evaluate(()=>document.documentElement.dataset.theme==='light'&&
    localStorage.getItem('zf-theme')==='light'),'theme uses existing persistence');
  await scene();
  check(await page.getByLabel('Appearance',{exact:true}).inputValue()==='light',
    'theme survives reload');
  await theme.selectOption('device'); await page.emulateMedia({colorScheme:'dark'});
  const dark=await page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
  await page.emulateMedia({colorScheme:'light'});
  check(dark!==await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),
    'System follows color-scheme changes');
  await page.emulateMedia({colorScheme:'dark'});
}

async function memoChecks() {
  check(await page.evaluate(()=>!localStorage.getItem('zf-memos')),
    'viewing Settings leaves memos opted out');
  await summary('Incoming payment memos').click();
  check(await page.locator('.memo-switch .preference-detail').innerText().then(
    t=>/IP address/.test(t)&&/already downloaded stay/.test(t)),
      'memo consent exposes metadata and caching tradeoff');
  await page.locator('.memo-switch').screenshot({path:join(out,'memo-consent-390.png')});
  await page.locator('.memo-switch').getByRole('button',{name:'Cancel',exact:true}).click();
  check(await page.evaluate(()=>!localStorage.getItem('zf-memos')),
    'memo consent cancel does not enable');
  await summary('Incoming payment memos').click(); await button(
    'Enable incoming memos').click(); await settle();
  check(await page.evaluate(async()=>(await import('/app-chain.js')).readsMemos(
    globalThis.qa.state.gid)),'explicit memo consent calls existing preference');
  await summary('Incoming payment memos').click(); await button(
    'Turn off memo retrieval').click(); await settle();
  check(await page.evaluate(async()=>!(await import('/app-chain.js')).readsMemos(
    globalThis.qa.state.gid)),'memo retrieval disables through existing preference');
}

async function notificationChecks() {
  // Permission outcomes are simulated; the production toggle and presentation run unchanged.
  await page.evaluate(()=>{globalThis.permissionRequests=0;Object.defineProperty(window,
    'Notification',{configurable:true,value:class {
    static permission='default'; static requestPermission(){
      globalThis.permissionRequests++;return new Promise(r=>globalThis.resolvePermission=r);}
  }});globalThis.qa.ui.notify=false;globalThis.qa.draw();});
  check(await page.evaluate(()=>globalThis.permissionRequests)===0,
    'Settings never requests permission on open');
  await button('Enable notifications').click(); await settle();
  check(await page.getByRole('button',{name:'Enable notifications',exact:true}).isDisabled(),
    'permission operation prevents repeat submission');
  await page.evaluate(()=>{Notification.permission='denied';globalThis.resolvePermission(
    'denied');}); await settle();
  check(await page.locator('.preference-notifications').innerText().then(t=>t.includes(
    'Blocked by browser')),'denied permission shows blocked state');
  check(await page.evaluate(()=>!globalThis.qa.ui.notify),
    'denied permission never enables notification preference');
  await page.evaluate(()=>{Notification.permission='granted';globalThis.qa.draw();});
  check(await page.locator('.preference-notifications').innerText().then(t=>t.includes(
    'Disabled in Zigs')),'granted permission and disabled preference are distinct');
  await page.evaluate(()=>Notification.requestPermission=async()=>{
    globalThis.permissionRequests++;return 'granted';});
  await button('Enable notifications').click(); await settle();
  check(await page.evaluate(()=>globalThis.qa.ui.notify&&localStorage.getItem('zf-notify')===
    '1'),'notification enable delegates to existing handler');
  await button('Turn off notifications in Zigs').click(); await settle();
  check(await page.evaluate(()=>!globalThis.qa.ui.notify&&Notification.permission==='granted'),
    'disable keeps browser permission intact');
  await page.evaluate(()=>{delete window.Notification;globalThis.qa.draw();});
  check(await page.locator('.preference-notifications').innerText().then(t=>t.includes(
    'Unavailable')),'unsupported browser state remains visible');
  check(await page.locator('.preference-notifications button').count()===0,
    'unsupported browser has no fake toggle');
}

async function supportChecks() {
  await scene();
  await summary('On-chain messaging account').click();
  check(await page.locator('#panel-settings').innerText().then(t=>t.includes(
    'Whoever controls this browser can spend the account')),
      'account authority warning visible before creation');
  check(await button('Create account').count()===1,
    'existing explicit account creation remains available');
  await summary('Technical wallet details').click(); await settle();
  check(await page.locator('.technical').count()===1,'technical facts use existing lazy content');
  check(await page.locator('.technical details[open]').count()===0,
    'viewing key remains a second explicit disclosure');
  await summary('Guides & frequently asked questions').click();
  check(await page.locator('.preferences-faq h4').count()===7,
    'all seven original FAQ answers preserved');
  await summary('Diagnostics').click(); await button('Copy diagnostics').click();
  check(await page.evaluate(async()=>(await navigator.clipboard.readText()).startsWith(
    'Zigs diagnostics')),'diagnostics remain user controlled copy');
  await page.screenshot({path:join(out,'expanded-390.png'),fullPage:true});
}

async function navigationChecks() {
  await page.evaluate(()=>{const g={...globalThis.qa.state.g,id:'e2'.repeat(10),
    name:'Travel wallet',t:2,n:2};globalThis.qa.state.g=g;globalThis.qa.state.gid=
      g.id;globalThis.qa.state.groups.push(g);globalThis.qa.state.wallet={
        ...globalThis.qa.state.wallet,address:'utest1'+'otheraddress'.repeat(
          12)};globalThis.qa.draw();});
  check(await summary('Wallet description').innerText().then(t=>!t.includes('Treasury')),
    'switching wallet never shows another wallet note');
  check(await page.locator('#panel-settings').innerText().then(t=>t.includes(
    '2 of 2 devices')),'approval rule follows active wallet');
  await button('Copy address').click();
  check(await page.evaluate(async()=>(await navigator.clipboard.readText())===
    globalThis.qa.state.wallet.address),'copy follows active wallet');
  // Real file parser, synthetic invalid file: no account or wallet material is imported.
  await page.locator('#restore-account-settings').setInputFiles({name:'invalid.zigsbackup',
    mimeType:'application/json',buffer:Buffer.from('{}')});await settle();
  check(await page.locator('#banner').getAttribute('class')==='bad',
    'invalid recovery input preserves existing error path');
  check(await page.evaluate(()=>globalThis.qa.state.gid==='e2'.repeat(10)),
    'invalid recovery file does not replace wallet');
  await page.locator('#panel-settings').getByRole('button',{
    name:/^Security/}).click();await settle();
  check(await page.evaluate(()=>globalThis.qa.ui.tab==='recovery'),
    'security row uses existing destination');
  await scene();
  const before=await page.evaluate(()=>JSON.stringify({g:globalThis.qa.state.g,
    w:globalThis.qa.state.wallet,seats:globalThis.qa.state.seats}));
  await button('Open guide').click();await settle();
  check(await page.evaluate(()=>JSON.stringify({g:globalThis.qa.state.g,
    w:globalThis.qa.state.wallet,seats:globalThis.qa.state.seats}))===before,
      'guide replay leaves wallet and membership unchanged');
  check(await page.evaluate(()=>globalThis.qa.ui.tab==='overview'),
    'guide uses existing replay route');
}

async function offlineChecks() {
  await scene(); await context.setOffline(true);
  await page.getByLabel('Appearance',{exact:true}).selectOption('dark');
  await summary('Guides & frequently asked questions').click();
  check(await page.locator('.preferences-faq').isVisible(),
    'help remains accessible without network');
  check(await page.evaluate(()=>document.documentElement.dataset.theme==='dark'),
    'local theme works offline');
  await context.setOffline(false);
  await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});
  await page.setViewportSize({width:320,height:844});
  check(await page.evaluate(()=>getComputedStyle(document.querySelector(
    '.preference-chevron')).transitionDuration==='0s'),
      'reduced motion removes disclosure transition');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),
    'forced colors at 320px has no overflow');
  await page.screenshot({path:join(out,'forced-colors-320.png'),fullPage:true});
  await page.emulateMedia({forcedColors:'none'});}

async function interactions() {
  await addressSafetyChecks();
  await descriptionChecks();
  await themeChecks();
  await memoChecks();
  await notificationChecks();
  await supportChecks();
  await navigationChecks();
  await offlineChecks();
}
await scene();
for (const width of [320,375,390,430,768,1280,1440]) {
  await page.setViewportSize({width,height:width<768?844:1000});
  for (const theme of ['dark','light']) {
    await page.evaluate(theme => document.documentElement.dataset.theme=theme,theme);
    await page.evaluate(()=>scrollTo(0,0)); await page.waitForTimeout(120);
    await page.screenshot({path:join(out,`wallet-${width}-${theme}.png`),fullPage:width<768});
    if(width===1440) {
      await page.evaluate(()=>scrollTo(0,
        document.documentElement.scrollHeight)); await page.waitForTimeout(120);
      await page.screenshot({path:join(out,`wallet-${width}-${theme}-bottom.png`)});
      await page.evaluate(()=>scrollTo(0,0));
    }
    facts.push(await page.evaluate(({width,theme})=>({width,theme,
      overflow:document.documentElement.scrollWidth>innerWidth,
      settingsWidth:document.querySelector('.settings-page')?.getBoundingClientRect().width,
      height:document.documentElement.scrollHeight}),{width,theme}));
  }
}
if(phase==='after') await interactions();
await scene(false);
await page.setViewportSize({width:390,height:844});
await page.screenshot({path:join(out,'no-wallet-390.png'),fullPage:true});
writeFileSync(join(out,'results.json'),JSON.stringify({phase,facts,checks,errors},null,2)+'\n');
await browser.close(); await new Promise(r=>server.close(r));
assert.equal(errors.length,0,errors.join('\n'));
console.log(JSON.stringify({phase,layoutCases:facts.length,checks:checks.length,errors,facts}));
