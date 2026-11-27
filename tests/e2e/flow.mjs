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
 * It asserts the demo script (set profile -> identify -> toss -> claim
 * challenge), mobile layout at 375x812, persistence across a reload, and a
 * clean browser console. Exit code 0 means all checks passed. The path to
 * Chrome is configurable via CHROME_PATH.
 */
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME_PATH ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:5000/';
const USER = `E2E-${Date.now().toString(36)}`;
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
  const calls = [];
  window.__speech = {
    calls,
    cancelCount: 0,
    end() {
      const last = calls[calls.length - 1];
      if (last && typeof last.onend === 'function') last.onend();
    },
  };
  class FakeUtterance {
    constructor(text) {
      this.text = text;
      this.volume = 1;
      this.rate = 1;
      this.pitch = 1;
      this.lang = '';
    }
  }
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: FakeUtterance,
  });
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      speak(utterance) {
        calls.push(utterance);
        if (typeof utterance.onstart === 'function') {
          setTimeout(() => utterance.onstart(), 0);
        }
      },
      cancel() {
        window.__speech.cancelCount += 1;
      },
      getVoices() {
        return [];
      },
      addEventListener() {},
      removeEventListener() {},
    },
  });
});

await page.goto(BASE, { waitUntil: 'networkidle' });

// 0. speech controls are present, auto-read is off, nothing speaks on load
const speechInitial = await page.evaluate(() => ({
  calls: window.__speech.calls.length,
  auto: document.getElementById('autoReadBtn').getAttribute('aria-pressed'),
  readLabel: document.getElementById('readAloudLabel').textContent.trim(),
  readPressed: document.getElementById('readAloudBtn').getAttribute('aria-pressed'),
}));
check('auto-read is off by default and nothing speaks on load',
  speechInitial.calls === 0 && speechInitial.auto === 'false' &&
  speechInitial.readLabel === 'Read aloud' && speechInitial.readPressed === 'false',
  `calls=${speechInitial.calls}, auto=${speechInitial.auto}, label=${speechInitial.readLabel}`);

// 1. unslop checks: no emoji, no gradients, tabular figures
const emoji = await page.evaluate(() => {
  const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  const match = document.body.innerText.match(re);
  return { found: Boolean(match), sample: match ? match[0] : '' };
});
check('no emoji left in visible interface text', !emoji.found, emoji.sample || 'clean');

const surfaces = await page.evaluate(() => ({
  body: getComputedStyle(document.body).backgroundImage,
  primary: getComputedStyle(document.querySelector('.btn-primary')).backgroundImage,
  activeTab: getComputedStyle(document.querySelector('.tab-btn[aria-selected="true"]')).backgroundImage,
}));
check('primary surfaces are solid, not gradient',
  surfaces.body === 'none' && surfaces.primary === 'none' && surfaces.activeTab === 'none',
  `body=${surfaces.body}, primary=${surfaces.primary}, tab=${surfaces.activeTab}`);

const numerals = await page.evaluate(() => ({
  points: getComputedStyle(document.getElementById('ecoPointsValue')).fontVariantNumeric,
  bin: getComputedStyle(document.querySelector('.bin-count')).fontVariantNumeric,
}));
check('scores and bin counts use tabular numerals',
  numerals.points.includes('tabular-nums') && numerals.bin.includes('tabular-nums'),
  `points=${numerals.points}, bin=${numerals.bin}`);

// 2. responsive: no horizontal overflow at 375 px
const overflow = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
}));
check('no horizontal overflow at 375px', overflow.scrollWidth <= overflow.innerWidth,
  `scrollWidth ${overflow.scrollWidth} <= ${overflow.innerWidth}`);

// 2. bins wrap to 3 columns below 500px
const binCols = await page.evaluate(() =>
  getComputedStyle(document.querySelector('.bins-grid')).gridTemplateColumns.split(' ').length);
check('5 bins wrap to 2 columns at 375px', binCols === 2, `${binCols} columns`);

// 3. six quick-sample chips render
const presetCount = await page.evaluate(() => document.querySelectorAll('.preset-chip').length);
check('six quick-sample chips render', presetCount === 6, `${presetCount} chips`);

// 4. only one tab panel is visible
const visiblePanels = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.tab-panel')).filter((p) => !p.classList.contains('hidden')).length);
check('one tab panel visible at a time', visiblePanels === 1, `${visiblePanels} visible`);

// 5. set a profile
await page.fill('#displayNameInput', USER);
await page.selectOption('#communitySelect', 'Home & Family');
await page.selectOption('#citySelect', 'Chennai');
await page.click('#profileForm button[type="submit"]');
await page.waitForFunction(() =>
  document.getElementById('ecoPointsValue').textContent.trim() === '0', null, { timeout: 5000 });
const startScore = await page.textContent('#ecoPointsValue');
check('profile set, score starts at 0', startScore.trim() === '0', `score ${startScore}`);

const afterProfileSpeech = await page.evaluate(() => window.__speech.calls.length);
check('profile updates do not speak', afterProfileSpeech === 0, `${afterProfileSpeech} calls`);

// 6. quick-test preset -> result card
await page.click('.preset-chip[data-preset="battery"]');
await page.waitForSelector('#resultActiveState:not(.hidden)', { timeout: 5000 });
const result = await page.evaluate(() => ({
  category: document.getElementById('binOverrideSelect').value,
  points: document.getElementById('resultRewardPill').textContent.trim(),
  mode: document.getElementById('resultModePill').textContent.trim(),
  name: document.getElementById('resultItemName').textContent.trim(),
}));
check('battery preset renders Hazardous Waste / +25',
  result.category === 'Hazardous Waste' && result.points === '+25',
  `${result.name}: ${result.category} ${result.points} (${result.mode})`);

const prepCount = await page.evaluate(() => document.querySelectorAll('#prepChecklist .prep-item').length);
check('prep checklist renders from the sorting steps', prepCount >= 1, `${prepCount} prep items`);

const afterScanSpeech = await page.evaluate(() => window.__speech.calls.length);
check('auto-read off means a new scan does not speak', afterScanSpeech === 0,
  `${afterScanSpeech} calls`);

await page.click('#readAloudBtn');
await page.waitForFunction(() => window.__speech.calls.length === 1, null, { timeout: 5000 });
const spoken = await page.evaluate(() => {
  const utterance = window.__speech.calls[0];
  return {
    text: utterance.text,
    volume: utterance.volume,
    label: document.getElementById('readAloudLabel').textContent.trim(),
    pressed: document.getElementById('readAloudBtn').getAttribute('aria-pressed'),
  };
});
const spokenLower = spoken.text.toLowerCase();
check('read aloud speaks only item, category/bin and sorting steps',
  spokenLower.includes('battery') &&
  spokenLower.includes('hazardous waste') &&
  spokenLower.includes('red bin') &&
  (spokenLower.includes('sorting steps') || spokenLower.includes('tape')) &&
  !spokenLower.includes('eco points') &&
  !spokenLower.includes('badge') &&
  !spokenLower.includes('challenge') &&
  !spokenLower.includes('profile') &&
  !spokenLower.includes('+25') &&
  !spokenLower.includes('offline') &&
  !spokenLower.includes('confidence'),
  spoken.text.slice(0, 180));
check('read aloud button becomes Stop while speaking',
  spoken.volume === 1 && spoken.label === 'Stop' && spoken.pressed === 'true',
  `label=${spoken.label}, pressed=${spoken.pressed}, volume=${spoken.volume}`);

await page.evaluate(() => window.__speech.end());
const ended = await page.evaluate(() => ({
  label: document.getElementById('readAloudLabel').textContent.trim(),
  pressed: document.getElementById('readAloudBtn').getAttribute('aria-pressed'),
}));
check('onend resets the button to Read aloud',
  ended.label === 'Read aloud' && ended.pressed === 'false',
  `label=${ended.label}, pressed=${ended.pressed}`);

await page.click('#readAloudBtn');
await page.waitForFunction(() => window.__speech.calls.length === 2, null, { timeout: 5000 });
const cancelBefore = await page.evaluate(() => window.__speech.cancelCount);
await page.click('#readAloudBtn');
const stopped = await page.evaluate(() => ({
  cancelCount: window.__speech.cancelCount,
  label: document.getElementById('readAloudLabel').textContent.trim(),
  pressed: document.getElementById('readAloudBtn').getAttribute('aria-pressed'),
}));
check('Stop cancels speech and resets the button to Read aloud',
  stopped.cancelCount > cancelBefore && stopped.label === 'Read aloud' && stopped.pressed === 'false',
  `cancel=${stopped.cancelCount - cancelBefore}, label=${stopped.label}`);

// 7. toss into bin
await page.click('#tossToBinBtn');
await page.waitForFunction(() =>
  document.getElementById('ecoPointsValue').textContent.trim() === '25', null, { timeout: 5000 });
const hazardCount = await page.textContent('[data-bin-count="Hazardous Waste"]');
check('disposal credits 25 pts and increments the bin', hazardCount.trim() === '1',
  `hazard bin ${hazardCount}`);

const binEffect = await page.evaluate(() => {
  const card = document.querySelector('[data-bin-card="Hazardous Waste"]');
  return {
    pop: card.classList.contains('pop'),
    float: card.querySelector('.bin-float')?.textContent || '',
    active: card.classList.contains('is-active'),
    recent: document.querySelectorAll('#recentActivityList .recent-item').length,
  };
});
check('disposal triggers bin pop + floating +pts + recent activity',
  binEffect.pop && binEffect.float === '+25' && binEffect.recent === 1,
  `pop=${binEffect.pop} float="${binEffect.float}" recent=${binEffect.recent}`);

// 8. persistence across reload
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() =>
  document.getElementById('ecoPointsValue').textContent.trim() === '25', null, { timeout: 5000 });
const afterReload = await page.textContent('[data-bin-count="Hazardous Waste"]');
check('score and bin count persist across reload', afterReload.trim() === '1',
  `hazard bin ${afterReload} after reload`);

// 9. badges tab -> claim day 1
await page.click('#mobileTabBadges');
await page.waitForSelector('#panelBadges:not(.hidden)');
const unlocked = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.badge-card.unlocked')).map((b) => b.dataset.badge));
check('First Step and Hazard Hero show as unlocked',
  unlocked.includes('first_step') && unlocked.includes('hazard_hero'), unlocked.join(', '));

await page.click('[data-day="1"] [data-claim-day]');
await page.waitForFunction(() =>
  document.getElementById('ecoPointsValue').textContent.trim() === '40', null, { timeout: 5000 });
const claimed = await page.textContent('[data-day="1"] [data-claim-day]');
check('claiming day 1 adds +15 and disables the button', claimed.trim() === 'Claimed',
  `button "${claimed}"`);
const progress = await page.textContent('#challengeProgressText');
check('challenge progress updates after a claim', progress.trim() === '1 of 7 days',
  `progress "${progress}"`);

// 10. duplicate claim is not offered
const disabled = await page.isDisabled('[data-day="1"] [data-claim-day]');
check('claimed day cannot be re-claimed from the UI', disabled, `disabled=${disabled}`);

// 11. auto-read primes on toggle and speaks the next guide
await page.click('#mobileTabScan');
await page.click('.preset-chip[data-preset="banana"]');
await page.waitForSelector('#resultActiveState:not(.hidden)', { timeout: 10000 });
await page.click('.auto-read-toggle');
const autoOn = await page.evaluate(() => ({
  pressed: document.getElementById('autoReadBtn').getAttribute('aria-pressed'),
  calls: window.__speech.calls.length,
  last: window.__speech.calls.length
    ? {
        text: window.__speech.calls[window.__speech.calls.length - 1].text,
        volume: window.__speech.calls[window.__speech.calls.length - 1].volume,
      }
    : null,
}));
check('auto-read toggles on with aria-pressed',
  autoOn.pressed === 'true', `aria-pressed=${autoOn.pressed}`);
check('auto-read primes speech with a silent utterance',
  Boolean(autoOn.last) && autoOn.last.volume === 0 && autoOn.last.text.trim() === '',
  autoOn.last ? `text="${autoOn.last.text}" volume=${autoOn.last.volume}` : 'no primer');

const beforeAutoScan = await page.evaluate(() => window.__speech.calls.length);
await page.click('.preset-chip[data-preset="bottle"]');
await page.waitForFunction(
  (count) => window.__speech.calls.length > count,
  beforeAutoScan,
  { timeout: 10000 },
);
const autoSpoken = await page.evaluate(() => {
  const utterance = window.__speech.calls[window.__speech.calls.length - 1];
  return {
    text: utterance.text,
    volume: utterance.volume,
    label: document.getElementById('readAloudLabel').textContent.trim(),
  };
});
check('auto-read speaks a newly displayed sorting guide',
  /bottle|recyclable waste/i.test(autoSpoken.text) &&
  autoSpoken.volume === 1 &&
  autoSpoken.label === 'Stop' &&
  !/eco points|badge|challenge|profile|\+15/i.test(autoSpoken.text),
  autoSpoken.text.slice(0, 160));

await page.click('#readAloudBtn');
await page.click('.auto-read-toggle');
const autoOff = await page.evaluate(() => ({
  pressed: document.getElementById('autoReadBtn').getAttribute('aria-pressed'),
  label: document.getElementById('readAloudLabel').textContent.trim(),
}));
check('auto-read toggles off cleanly',
  autoOff.pressed === 'false' && autoOff.label === 'Read aloud',
  `aria-pressed=${autoOff.pressed}, label=${autoOff.label}`);

// 12. the AI Studio layout intentionally has no leaderboard tab
const rankTab = await page.evaluate(() =>
  Boolean(document.getElementById('tabBtnRank') || document.querySelector('[data-tab="rank"]')));
check('leaderboard tab is absent (AI Studio layout)', !rankTab, `present=${rankTab}`);

// 12. desktop layout (1280x800) stays balanced and overflow-free
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(250);
await page.click('#tabBtnScan');
const desktop = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
  scanCols: getComputedStyle(document.querySelector('.capture-grid')).gridTemplateColumns.split(' ').length,
  binCols: getComputedStyle(document.querySelector('.bins-grid')).gridTemplateColumns.split(' ').length,
}));
check('no horizontal overflow at 1280px', desktop.scrollWidth <= desktop.innerWidth,
  `scrollWidth ${desktop.scrollWidth} <= ${desktop.innerWidth}`);
check('desktop scan panel is two columns', desktop.scanCols === 2, `${desktop.scanCols} columns`);
check('desktop bins are five columns', desktop.binCols === 5, `${desktop.binCols} columns`);

// 13. reduced-motion preference disables motion
const reducedPage = await browser.newPage({
  viewport: { width: 375, height: 812 },
  reducedMotion: 'reduce',
});
await reducedPage.goto(BASE, { waitUntil: 'networkidle' });
const reduced = await reducedPage.evaluate(() => ({
  matches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  ambient: Boolean(document.querySelector('.ambient')),
  transition: getComputedStyle(document.querySelector('.btn')).transitionDuration,
}));
check('prefers-reduced-motion disables motion',
  reduced.matches && !reduced.ambient && parseFloat(reduced.transition) < 0.001,
  `matches=${reduced.matches}, ambient=${reduced.ambient}, transition=${reduced.transition}`);
await reducedPage.close();

// 14. unsupported speech disables the controls without page errors
const noSpeechPage = await browser.newPage({ viewport: { width: 375, height: 812 } });
const noSpeechErrors = [];
noSpeechPage.on('pageerror', (error) => noSpeechErrors.push(String(error)));
await noSpeechPage.addInitScript(() => {
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: undefined,
  });
});
await noSpeechPage.goto(BASE, { waitUntil: 'networkidle' });
const noSpeech = await noSpeechPage.evaluate(() => ({
  readDisabled: document.getElementById('readAloudBtn').disabled,
  autoDisabled: document.getElementById('autoReadBtn').disabled,
}));
check('unsupported speech disables the controls without errors',
  noSpeech.readDisabled && noSpeech.autoDisabled && noSpeechErrors.length === 0,
  `read=${noSpeech.readDisabled}, auto=${noSpeech.autoDisabled}, errors=${noSpeechErrors.length}`);
await noSpeechPage.close();

// 15. console must be clean
check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
