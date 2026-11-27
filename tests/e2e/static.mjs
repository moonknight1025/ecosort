/**
 * EcoSort static Cloudflare Pages smoke test.
 *
 * Serves the committed `public/` bundle with a tiny Node static server and
 * drives it through Playwright. The page must run entirely on local demo state:
 * profile, identify, dispose, challenge, bins and recent activity, with no
 * `/api/*` server.
 *
 *   node static.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const CHROME = process.env.CHROME_PATH ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    const file = path.resolve(ROOT, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!file.startsWith(ROOT)) {
      response.writeHead(403);
      response.end('forbidden');
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('not found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}/`;

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

await page.addInitScript(() => {
  window.__speech = { calls: [], cancelCount: 0 };
  class FakeUtterance {
    constructor(text) {
      this.text = text;
      this.volume = 1;
      this.rate = 1;
      this.pitch = 1;
    }
  }
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance });
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      speak(utterance) {
        window.__speech.calls.push(utterance);
        if (typeof utterance.onstart === 'function') setTimeout(() => utterance.onstart(), 0);
      },
      cancel() { window.__speech.cancelCount += 1; },
      getVoices() { return []; },
      addEventListener() {},
      removeEventListener() {},
    },
  });
});

await page.goto(BASE, { waitUntil: 'networkidle' });

const staticMode = await page.evaluate(() => ({
  flag: window.__ECOSORT_STATIC__ === true,
  label: document.getElementById('networkLabel').textContent.trim(),
  overflow: document.documentElement.scrollWidth <= window.innerWidth,
}));
check('static bundle loads in local demo mode',
  staticMode.flag && staticMode.label === 'Local demo' && staticMode.overflow,
  `flag=${staticMode.flag}, label=${staticMode.label}, overflow=${staticMode.overflow}`);

await page.fill('#displayNameInput', 'StaticTester');
await page.selectOption('#communitySelect', 'Home & Family');
await page.selectOption('#citySelect', 'Chennai');
await page.click('#profileForm button[type="submit"]');
await page.waitForFunction(() => document.getElementById('ecoPointsValue').textContent.trim() === '0', null, { timeout: 5000 });
check('profile saves locally', (await page.textContent('#profileStatus')).includes('StaticTester'),
  (await page.textContent('#profileStatus')).trim());

await page.click('.preset-chip[data-preset="battery"]');
await page.waitForSelector('#resultActiveState:not(.hidden)', { timeout: 5000 });
const identified = await page.evaluate(() => ({
  category: document.getElementById('binOverrideSelect').value,
  points: document.getElementById('resultRewardPill').textContent.trim(),
  mode: document.getElementById('resultModePill').textContent.trim(),
}));
check('local rules identify a sample item',
  identified.category === 'Hazardous Waste' && identified.points === '+25' && /Offline/i.test(identified.mode),
  `${identified.category} ${identified.points} (${identified.mode})`);

await page.click('#tossToBinBtn');
await page.waitForFunction(() => document.getElementById('ecoPointsValue').textContent.trim() === '25', null, { timeout: 5000 });
const tossed = await page.evaluate(() => ({
  hazard: document.querySelector('[data-bin-count="Hazardous Waste"]').textContent.trim(),
  recent: document.querySelectorAll('#recentActivityList .recent-item').length,
}));
check('local disposal updates points, bin and recent activity',
  tossed.hazard === '1' && tossed.recent === 1,
  `hazard=${tossed.hazard}, recent=${tossed.recent}`);

await page.click('#mobileTabBadges');
await page.click('[data-day="1"] [data-claim-day]');
await page.waitForFunction(() => document.getElementById('ecoPointsValue').textContent.trim() === '40', null, { timeout: 5000 });
const claimed = await page.evaluate(() => ({
  text: document.querySelector('[data-day="1"] [data-claim-day]').textContent.trim(),
  progress: document.getElementById('challengeProgressText').textContent.trim(),
}));
check('local challenge claim is idempotent',
  claimed.text === 'Claimed' && claimed.progress === '1 of 7 days',
  `button=${claimed.text}, progress=${claimed.progress}`);

const voice = await page.evaluate(() => ({
  read: document.getElementById('readAloudBtn').textContent.trim(),
  auto: document.getElementById('autoReadBtn').getAttribute('aria-pressed'),
}));
check('voice controls are present and auto-read is off',
  /Read aloud/.test(voice.read) && voice.auto === 'false',
  `read=${voice.read}, auto=${voice.auto}`);

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

await browser.close();
await new Promise((resolve) => server.close(resolve));

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
