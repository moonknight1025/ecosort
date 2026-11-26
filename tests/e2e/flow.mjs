/**
 * EcoSort end-to-end demo + 375 px layout check.
 *
 * Optional dev tooling, not a product dependency: it drives the *installed*
 * Chrome through playwright-core, so nothing is downloaded and nothing is
 * added to the app. Run it against a live server:
 *
 *   python app.py &                       # http://127.0.0.1:5000
 *   cd tests/e2e && npm i playwright-core  # once
 *   node flow.mjs
 *
 * It asserts the demo script from the PRD (set profile -> identify -> toss ->
 * claim challenge -> view leaderboard), mobile layout at 375x812, persistence
 * across a reload, and a clean browser console. Exit code 0 means all checks
 * passed. The path to Chrome is configurable via CHROME_PATH.
 */
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME_PATH ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:5000/';
const results = [];
const errors = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push(String(err)));

await page.goto(BASE, { waitUntil: 'networkidle' });

// 1. responsive: no horizontal overflow at 375 px
const overflow = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
}));
check('no horizontal overflow at 375px', overflow.scrollWidth <= overflow.innerWidth,
  `scrollWidth ${overflow.scrollWidth} <= ${overflow.innerWidth}`);

// 2. bins wrap to 3 columns below 500px
const binCols = await page.evaluate(() =>
  getComputedStyle(document.querySelector('.bins')).gridTemplateColumns.split(' ').length);
check('5 bins wrap to 3 columns at 375px', binCols === 3, `${binCols} columns`);

// 3. presets wrap to 2 columns
const presetCols = await page.evaluate(() =>
  getComputedStyle(document.querySelector('.presets')).gridTemplateColumns.split(' ').length);
check('6 presets wrap to 2 columns at 375px', presetCols === 2, `${presetCols} columns`);

// 4. only one tab panel is visible
const visiblePanels = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.panel')).filter((p) => !p.hidden).length);
check('one tab panel visible at a time', visiblePanels === 1, `${visiblePanels} visible`);

// 5. set a profile
await page.fill('#username', 'E2EUser');
await page.fill('#group-name', 'Home & Family');
await page.fill('#city', 'Chennai');
await page.click('#set-profile');
await page.waitForFunction(() => document.getElementById('eco-score').textContent !== '0' || document.getElementById('toast')?.textContent.includes('Welcome'), null, { timeout: 5000 }).catch(() => {});
const startScore = await page.textContent('#eco-score');
check('profile set, score starts at 0', startScore === '0', `score ${startScore}`);

// 6. quick-test preset -> result card
await page.click('.preset[data-preset="battery"]');
await page.waitForSelector('#result-card:not([hidden])', { timeout: 5000 });
const category = await page.textContent('#result-category');
const points = await page.textContent('#result-points');
check('battery preset renders Hazardous Waste / +25 pts',
  category === 'Hazardous Waste' && points === '+25 pts', `${category} ${points}`);

// 7. toss into bin
await page.click('#dispose-btn');
await page.waitForFunction(() => document.getElementById('eco-score').textContent === '25', null, { timeout: 5000 });
const hazardCount = await page.textContent('[data-count-for="Hazardous Waste"]');
check('disposal credits 25 pts and increments the bin', hazardCount === '1', `hazard bin ${hazardCount}`);

// 8. persistence across reload
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => document.getElementById('eco-score').textContent === '25', null, { timeout: 5000 });
const afterReload = await page.textContent('[data-count-for="Hazardous Waste"]');
check('score and bin count persist across reload', afterReload === '1', `hazard bin ${afterReload} after reload`);

// 9. badges tab -> claim day 1
await page.click('.tab[data-tab="badges"]');
await page.waitForSelector('#tab-badges:not([hidden])');
const unlocked = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.badge.is-unlocked')).map((b) => b.dataset.badge));
check('First Step and Hazard Hero show as unlocked',
  unlocked.includes('first_step') && unlocked.includes('hazard_hero'), unlocked.join(', '));

await page.click('.challenge[data-day="1"] .btn-claim');
await page.waitForFunction(() => document.getElementById('eco-score').textContent === '40', null, { timeout: 5000 });
const claimed = await page.textContent('.challenge[data-day="1"] .btn-claim');
check('claiming day 1 adds +15 and disables the button', claimed === 'Claimed', `button "${claimed}"`);

// 10. duplicate claim is not offered
const disabled = await page.isDisabled('.challenge[data-day="1"] .btn-claim');
check('claimed day cannot be re-claimed from the UI', disabled, `disabled=${disabled}`);

// 11. leaderboards: everyone + community groups
await page.click('.tab[data-tab="rank"]');
await page.waitForSelector('#group-rank .rank-item', { timeout: 5000 });
const rank = await page.evaluate(() => ({
  groups: document.querySelectorAll('#group-rank .rank-item').length,
  users: document.querySelectorAll('#user-rank .rank-item').length,
  firstGroup: document.querySelector('#group-rank .rank-name')?.textContent.trim().split('\n')[0],
  subtitle: document.querySelector('#user-rank .rank-sub')?.textContent.trim() ?? '',
}));
check('top contributors and group standings render', rank.groups >= 3 && rank.users >= 5,
  `${rank.groups} groups, ${rank.users} users, top group=${rank.firstGroup}`);
check('contributor rows show group and city',
  rank.subtitle.includes('\u00b7'), `subtitle "${rank.subtitle}"`);

// 12. console must be clean
check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
