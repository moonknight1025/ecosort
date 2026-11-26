/**
 * EcoSort UI control-surface check (optional dev tooling).
 *
 * Verifies the real controls, not just the flow: profile dropdowns (presets +
 * custom), the settings popover, the sample dropdown, the category-override
 * correction, the challenge filter, the leaderboard scope/filter, and no
 * horizontal overflow at 375 and 320 px.
 *
 *   python app.py &
 *   cd tests/e2e && npm install
 *   node controls.mjs
 */

import { chromium } from 'playwright-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:5000/';
const r = [];
const errs = [];
const check = (n, ok, d) => { r.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(BASE, { waitUntil: 'networkidle' });

// --- dropdowns exist and are real <select> controls ---
const controls = await page.evaluate(() => ({
  group: !!document.querySelector('select#group-select'),
  city: !!document.querySelector('select#city-select'),
  sample: !!document.querySelector('select#sample-select'),
  override: !!document.querySelector('select#category-override'),
  challenge: !!document.querySelector('select#challenge-filter'),
  scope: !!document.querySelector('select#rank-scope'),
  settings: !!document.querySelector('details#settings'),
  groupOptions: document.querySelectorAll('#group-select option').length,
}));
check('profile + scan + result + filter dropdowns are real <select>s',
  controls.group && controls.city && controls.sample && controls.override &&
  controls.challenge && controls.scope && controls.settings,
  `group options: ${controls.groupOptions}`);
check('group select offers presets plus a custom option', controls.groupOptions >= 6);

// --- custom group reveals the text field and is sent ---
await page.fill('#username', 'ControlTester');
await page.selectOption('#group-select', '__custom__');
const customVisible = await page.isVisible('#group-custom-field');
await page.fill('#group-custom', 'My Flat 4B');
await page.selectOption('#city-select', '__custom__');
await page.fill('#city-custom', 'Kochi');
await page.click('#set-profile');
await page.waitForFunction(() => /My Flat 4B/.test(document.getElementById('profile-summary').textContent), null, { timeout: 6000 });
const summary = await page.textContent('#profile-summary');
check('custom community + city apply and are summarised',
  customVisible && summary.includes('My Flat 4B') && summary.includes('Kochi'), summary.trim());

// --- settings popover shows engine status ---
await page.click('#settings > summary');
await page.waitForFunction(() => !/Checking/.test(document.getElementById('vision-status').textContent), null, { timeout: 6000 });
const settings = await page.evaluate(() => ({
  vision: document.getElementById('vision-status').textContent.trim(),
  limits: document.getElementById('limits-status').textContent.trim(),
  profile: document.getElementById('profile-status').textContent.trim(),
}));
check('settings popover reports the scan engine', /AI vision (on|off)/.test(settings.vision), settings.vision.slice(0, 60));
check('settings popover reports rate limits', /Limits\/min|disabled/.test(settings.limits), settings.limits.slice(0, 60));
check('settings popover shows the active profile', settings.profile.includes('ControlTester'));
await page.click('#settings > summary');

// --- sample dropdown drives a scan ---
await page.selectOption('#sample-select', 'battery');
await page.click('#use-sample');
await page.waitForSelector('#result-card:not([hidden])', { timeout: 15000 });
const result = await page.evaluate(() => ({
  name: document.getElementById('result-name').textContent.trim(),
  cat: document.getElementById('result-category').textContent.trim(),
  source: document.getElementById('result-source').textContent.trim(),
  points: document.getElementById('result-points').textContent.trim(),
}));
check('sample dropdown identifies an item', result.cat === 'Hazardous Waste', `${result.name} / ${result.points}`);
check('result shows the mode badge', /Offline rules|AI Vision/.test(result.source), result.source);

// --- category override changes the stream the server records ---
await page.selectOption('#category-override', 'Recyclable Waste');
const hintVisible = await page.isVisible('#override-hint');
await page.click('#dispose-btn');
await page.waitForFunction(() => document.getElementById('eco-score').textContent === '15', null, { timeout: 10000 });
const afterOverride = await page.evaluate(() => ({
  score: document.getElementById('eco-score').textContent,
  recyclable: document.querySelector('[data-count-for="Recyclable Waste"]').textContent,
  hazardous: document.querySelector('[data-count-for="Hazardous Waste"]').textContent,
  toast: document.getElementById('toast').textContent.trim(),
}));
check('category override is honoured (recyclable bin, 15 pts, not hazardous)',
  hintVisible && afterOverride.recyclable === '1' && afterOverride.hazardous === '0' && afterOverride.score === '15',
  `recyclable=${afterOverride.recyclable} hazardous=${afterOverride.hazardous} toast="${afterOverride.toast}"`);

// --- challenge filter ---
await page.click('#tab-btn-badges');
await page.selectOption('#challenge-filter', 'completed');
const completedOnly = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.challenge')).filter((c) => !c.hidden).length);
await page.selectOption('#challenge-filter', 'pending');
const pendingOnly = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.challenge')).filter((c) => !c.hidden).length);
check('challenge filter switches pending/completed', completedOnly === 0 && pendingOnly === 7,
  `completed=${completedOnly} pending=${pendingOnly}`);

// --- leaderboard scope + community filter ---
await page.click('#tab-btn-rank');
await page.waitForTimeout(600);
const contributors = await page.isVisible('#user-rank');
await page.selectOption('#rank-scope', 'groups');
await page.waitForTimeout(300);
const groupsVisible = await page.isVisible('#group-rank');
const filterVisible = await page.isVisible('#rank-filter-field');
const options = await page.evaluate(() => document.querySelectorAll('#rank-filter option').length);
check('scope select swaps contributors <-> groups', contributors && groupsVisible && filterVisible,
  `${options} community options`);

// --- no overflow at 375 and 320 ---
for (const width of [375, 320]) {
  await page.setViewportSize({ width, height: 812 });
  await page.waitForTimeout(200);
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  check(`no horizontal overflow at ${width}px`, o.sw <= o.iw, `${o.sw} <= ${o.iw}`);
}

check('no console or page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'clean');
await browser.close();
const failed = r.filter((ok) => !ok).length;
console.log(`\n${r.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
