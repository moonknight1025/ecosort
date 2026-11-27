/**
 * EcoSort UI control-surface check (optional dev tooling).
 *
 * Verifies the real controls, not just the flow: profile dropdowns (presets +
 * custom), the settings popover, the sample dropdown, the category-override
 * correction, the challenge filter, and no horizontal overflow at 375 and
 * 320 px. The AI Studio layout intentionally has no leaderboard.
 *
 *   python app.py &
 *   cd tests/e2e && npm install
 *   node controls.mjs
 */

import { chromium } from 'playwright-core';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:5000/';
const USER = `ControlTester-${Date.now().toString(36)}`;
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
  community: !!document.querySelector('select#communitySelect'),
  city: !!document.querySelector('select#citySelect'),
  sample: !!document.querySelector('select#samplePresetSelect'),
  override: !!document.querySelector('select#binOverrideSelect'),
  challenge: !!document.querySelector('select#challengeFilterSelect'),
  settings: !!document.getElementById('settingsToggleBtn'),
  groupOptions: document.querySelectorAll('#communitySelect option').length,
}));
check('profile + scan + result + filter dropdowns are real <select>s',
  controls.community && controls.city && controls.sample && controls.override &&
  controls.challenge && controls.settings,
  `group options: ${controls.groupOptions}`);
check('group select offers presets plus a custom option', controls.groupOptions >= 6);

// --- custom group reveals the text field and is sent ---
await page.fill('#displayNameInput', USER);
await page.selectOption('#communitySelect', '__custom__');
const customVisible = await page.isVisible('#customCommunityField');
await page.fill('#customCommunityInput', 'My Flat 4B');
await page.selectOption('#citySelect', '__custom__');
await page.fill('#customCityInput', 'Kochi');
await page.click('#profileForm button[type="submit"]');
await page.waitForFunction(() => /My Flat 4B/.test(document.getElementById('profileStatus').textContent), null, { timeout: 6000 });
const summary = await page.textContent('#profileStatus');
check('custom community + city apply and are summarised',
  customVisible && summary.includes('My Flat 4B') && summary.includes('Kochi'), summary.trim());

// --- settings popover shows engine status ---
await page.click('#settingsToggleBtn');
await page.waitForFunction(() => !/Checking/.test(document.getElementById('visionStatus').textContent), null, { timeout: 6000 });
const settings = await page.evaluate(() => ({
  vision: document.getElementById('visionStatus').textContent.trim(),
  limits: document.getElementById('limitsStatus').textContent.trim(),
  profile: document.getElementById('profileStatus').textContent.trim(),
}));
check('settings popover reports the scan engine', /AI Vision: (on|off)/.test(settings.vision), settings.vision.slice(0, 70));
check('settings popover reports rate limits', /Rate limits\/min|disabled/.test(settings.limits), settings.limits.slice(0, 70));
check('settings popover shows the active profile', settings.profile.includes('ControlTester'));
await page.click('#settingsToggleBtn');

// --- sample dropdown drives a scan ---
await page.selectOption('#samplePresetSelect', 'battery');
await page.waitForSelector('#resultActiveState:not(.hidden)', { timeout: 15000 });
const result = await page.evaluate(() => ({
  name: document.getElementById('resultItemName').textContent.trim(),
  category: document.getElementById('binOverrideSelect').value,
  mode: document.getElementById('resultModePill').textContent.trim(),
  points: document.getElementById('resultRewardPill').textContent.trim(),
}));
check('sample dropdown identifies an item', result.category === 'Hazardous Waste', `${result.name} / ${result.points}`);
check('result shows the mode badge', /Offline Rules|AI Vision/.test(result.mode), result.mode);

// --- category override changes the stream the server records ---
await page.selectOption('#binOverrideSelect', 'Recyclable Waste');
const tag = await page.textContent('#selectedBinTag');
await page.click('#tossToBinBtn');
await page.waitForFunction(() =>
  document.getElementById('ecoPointsValue').textContent.trim() === '15', null, { timeout: 10000 });
const afterOverride = await page.evaluate(() => ({
  score: document.getElementById('ecoPointsValue').textContent.trim(),
  recyclable: document.querySelector('[data-bin-count="Recyclable Waste"]').textContent.trim(),
  hazardous: document.querySelector('[data-bin-count="Hazardous Waste"]').textContent.trim(),
  toast: document.getElementById('toastRegion').textContent.trim(),
}));
check('category override is honoured (recyclable bin, 15 pts, not hazardous)',
  /Recyclable Waste/.test(tag) && afterOverride.recyclable === '1' && afterOverride.hazardous === '0' && afterOverride.score === '15',
  `recyclable=${afterOverride.recyclable} hazardous=${afterOverride.hazardous} toast="${afterOverride.toast}"`);

// --- challenge filter ---
await page.click('#mobileTabBadges');
await page.selectOption('#challengeFilterSelect', 'completed');
const completedOnly = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.challenge-card')).filter((c) => !c.classList.contains('hidden')).length);
await page.selectOption('#challengeFilterSelect', 'pending');
const pendingOnly = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.challenge-card')).filter((c) => !c.classList.contains('hidden')).length);
check('challenge filter switches pending/completed', completedOnly === 0 && pendingOnly === 7,
  `completed=${completedOnly} pending=${pendingOnly}`);

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
