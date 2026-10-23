// Presentation checks against synthetic snapshots; no production state or handlers are changed.
const rgb = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
function contrast(a, b) {
  const light = (v) => rgb(v).map((n) => n / 255)
    .map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
    .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
  const [hi, lo] = [light(a), light(b)].sort((x, y) => y - x);
  return (hi + .05) / (lo + .05);
}

export async function v3Overview(page, qa, width, theme) {
  const facts = await page.evaluate(() => {
    const hero = document.querySelector('.overview-hero');
    const value = hero.querySelector('.portfolio-value');
    const color = (n) => getComputedStyle(n).color;
    const background = (n) => getComputedStyle(n).backgroundColor;
    const cards = [...document.querySelectorAll('.assets-grid>.asset-card')];
    return { text: value.textContent, valueColor: color(value), heroColor: background(hero),
      tracks: document.querySelectorAll('.shielding-track,.shielding-breakdown').length,
      privacy: [...document.querySelectorAll('.asset-shielding')].map((n) => n.textContent),
      cards: cards.map((n) => n.getBoundingClientRect().bottom),
      activity: document.querySelector('.overview-transactions')?.getBoundingClientRect().top,
      height: innerHeight, warnings: [...document.querySelectorAll('.asset-unavailable')]
        .map((n) => ({ foreground: color(n.querySelector('.asset-incoming')),
          background: background(n), text: n.textContent })),
      bodyColor: background(document.body), sideColor: background(document.querySelector('.side')),
      currentWallet: document.querySelector('.wallet-context.active')
        ? getComputedStyle(document.querySelector('.wallet-context.active'), '::before').display
        : null };
  });
  const label = 'v3 Overview ' + width + ' ' + theme.name;
  qa.check(facts.text === 'USD value unavailable', label + ' explicit unavailable fiat state');
  qa.check(facts.tracks === 0 && facts.privacy.length === 3
    && facts.privacy.every((text) => /unavailable/.test(text)),
  label + ' no empty tracks or fabricated allocation');
  qa.check(contrast(facts.valueColor, facts.heroColor) >= 4.5,
    label + ' opaque graphite value contrast');
  qa.check(facts.warnings.every((w) => contrast(w.foreground, w.background) >= 4.5),
    label + ' unavailable-asset warnings retain normal text contrast');
  if (width >= 1440) qa.check(facts.cards.length === 3
    && facts.cards.every((bottom) => bottom <= facts.height)
    && facts.activity < facts.height, label + ' assets and start of activity fit initial viewport');
  if (facts.currentWallet) qa.check(facts.currentWallet === 'none',
    label + ' wallet context does not duplicate active route marker');
}

export async function v3Text(page, qa, id, helpers) {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => {
    window.__v3Sizes = [...document.querySelectorAll('body *')]
      .map((n) => [n, n.style.fontSize, n.style.lineHeight,
        getComputedStyle(n).fontSize, getComputedStyle(n).lineHeight]);
    for (const [n, , , size, line] of window.__v3Sizes) {
      n.style.fontSize = parseFloat(size) * 2 + 'px';
      if (line !== 'normal') n.style.lineHeight = parseFloat(line) * 2 + 'px';
    }
  });
  await helpers.layout(page, qa, 'v3 actual doubled text ' + id);
  await qa.capture(page, 'v3-double-text-' + id);
  await page.evaluate(() => {
    for (const [n, size, line] of window.__v3Sizes) {
      n.style.fontSize = size; n.style.lineHeight = line;
    }
    delete window.__v3Sizes;
  });
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await helpers.layout(page, qa, 'v3 forced colors ' + id);
  await qa.capture(page, 'v3-forced-colors-' + id);
  await page.emulateMedia({ forcedColors: 'none' });
}
