/**
 * EcoSort camera + AI-provenance browser check.
 *
 * Optional dev tooling (playwright-core against the installed Chrome), same as
 * flow.mjs. Uses Chrome's fake capture device so the live-camera path is
 * exercised without a physical webcam:
 *
 *   python app.py &
 *   cd tests/e2e && npm i playwright-core
 *   node camera.mjs
 *
 * Checks: live preview starts, Capture Photo produces a frame and an analysis,
 * the camera is released after capture, permission denial degrades to the
 * upload path with a friendly message, rate limiting surfaces a 429 toast, and
 * the console stays clean.
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME_PATH ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.ECOSORT_URL || 'http://127.0.0.1:5000/';
const USER = `CameraTester-${Date.now().toString(36)}`;

/**
 * Wait until the identify rate-limit window has room again. Re-running this
 * script inside the same 60 s window would otherwise inherit the previous run's
 * exhausted budget (the throttle check deliberately drains it).
 */
async function waitForIdentifyBudget(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const retryAfter = await page.evaluate(async () => {
      const form = new FormData();
      form.append('preset_keyword', 'bottle');
      const response = await fetch('/api/identify', { method: 'POST', body: form });
      if (response.status !== 429) return 0;
      return Number(response.headers.get('Retry-After') || 60);
    });
    if (retryAfter === 0) return;
    console.log(`  (waiting ${retryAfter}s for the identify rate-limit window)`);
    await page.waitForTimeout((retryAfter + 1) * 1000);
  }
}

const results = [];
const consoleErrors = [];

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ['camera'],
  baseURL: BASE,
});
const page = await context.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (error) => consoleErrors.push(String(error)));

await page.goto(BASE, { waitUntil: 'networkidle' });

// A profile is required before a disposal can be logged.
await page.fill('#displayNameInput', USER);
await page.selectOption('#communitySelect', 'Apartment Society');
await page.selectOption('#citySelect', 'Coimbatore');
await page.click('#profileForm button[type="submit"]');
await page.waitForFunction(
  () => document.getElementById('ecoPointsValue')?.textContent.trim() === '0',
  null,
  { timeout: 5000 },
).catch(() => {});

await waitForIdentifyBudget(page);

// --- 1. live camera starts ----------------------------------------------
await page.click('#startCameraBtn');
const live = await page.waitForFunction(() => {
  const video = document.getElementById('cameraVideo');
  return video && !video.classList.contains('hidden') && video.videoWidth > 0;
}, null, { timeout: 8000 }).then(() => true).catch(() => false);
const dims = await page.evaluate(() => {
  const video = document.getElementById('cameraVideo');
  return video ? `${video.videoWidth}x${video.videoHeight}` : 'no video';
});
check('live camera stream starts and renders frames', live, dims);

const controls = await page.evaluate(() => ({
  capture: !document.getElementById('capturePhotoBtn').classList.contains('hidden'),
  stop: !document.getElementById('stopCameraBtn').classList.contains('hidden'),
  start: !document.getElementById('startCameraBtn').classList.contains('hidden'),
}));
check('capture + stop controls appear, start hidden while live',
  controls.capture && controls.stop && !controls.start, JSON.stringify(controls));

// --- 2. capture -> preview + analysis -----------------------------------
await page.click('#capturePhotoBtn');
const analysed = await page.waitForSelector('#resultActiveState:not(.hidden)', { timeout: 15000 })
  .then(() => true).catch(() => false);
const previewShown = await page.evaluate(() => {
  const preview = document.getElementById('imagePreview');
  return !preview.classList.contains('hidden') && preview.src.startsWith('blob:');
});
check('captured frame shows a live preview', previewShown);
check('captured frame produces an analysis result', analysed,
  analysed ? await page.textContent('#binOverrideSelect') : 'no result card');

// --- 3. provenance is labelled -----------------------------------------
const provenance = await page.evaluate(() => {
  const pill = document.getElementById('resultModePill');
  const note = document.getElementById('resultVisionNote');
  return {
    label: pill.textContent.trim(),
    ai: pill.classList.contains('pill-mode-ai'),
    note: note.classList.contains('hidden') ? '' : note.textContent.trim(),
  };
});
check('result states whether AI vision or the offline fallback answered',
  /AI Vision|Offline Rules/.test(provenance.label),
  `${provenance.label} (ai=${provenance.ai})`);
check('unconfigured AI explains itself instead of pretending',
  provenance.ai || provenance.note.length > 0,
  provenance.note.slice(0, 80));

// --- 4. capture releases the camera ------------------------------------
const afterCapture = await page.evaluate(() => {
  const video = document.getElementById('cameraVideo');
  return {
    videoHidden: video.classList.contains('hidden'),
    startVisible: !document.getElementById('startCameraBtn').classList.contains('hidden'),
    tracksLive: video.srcObject ? video.srcObject.getTracks().some((t) => t.readyState === 'live') : false,
  };
});
check('capture stops the stream and restores Start Camera',
  afterCapture.videoHidden && afterCapture.startVisible && !afterCapture.tracksLive,
  JSON.stringify(afterCapture));

// --- 5. permission denial degrades gracefully --------------------------
await page.evaluate(() => {
  navigator.mediaDevices.getUserMedia = () =>
    Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
});
await page.click('#startCameraBtn');
await page.waitForFunction(
  () => /permission was denied/i.test(document.getElementById('cameraFallbackMsg').textContent),
  null,
  { timeout: 5000 },
).catch(() => {});
const denied = await page.evaluate(() => ({
  status: document.getElementById('cameraFallbackMsg').textContent.trim(),
  visible: !document.getElementById('cameraFallbackBox').classList.contains('hidden'),
  uploadReady: Boolean(document.getElementById('photoUploadInput')),
  presets: document.querySelectorAll('.preset-chip').length,
}));
check('permission denial shows a friendly message and keeps upload + presets',
  denied.visible && /permission was denied/i.test(denied.status) && denied.uploadReady && denied.presets === 6,
  denied.status.slice(0, 70));

// Everything above must be console-clean. Chrome logs the deliberate 429s from
// the next section as console errors of its own, so the snapshot is taken here.
const errorsBeforeThrottle = consoleErrors.slice();

// --- 6. rate limiting surfaces a usable toast --------------------------
const throttled = await page.evaluate(async () => {
  // Drive the same endpoint the UI uses until the limiter answers 429.
  for (let i = 0; i < 40; i += 1) {
    const form = new FormData();
    form.append('preset_keyword', 'bottle');
    const response = await fetch('/api/identify', { method: 'POST', body: form });
    if (response.status === 429) {
      const body = await response.json();
      return { hit: true, retryAfter: response.headers.get('Retry-After'), message: body.error };
    }
  }
  return { hit: false };
});
check('identify rate limit returns 429 with Retry-After', throttled.hit,
  throttled.hit ? `Retry-After ${throttled.retryAfter}s` : 'limits were not reached');

if (throttled.hit) {
  await page.click('.preset-chip[data-preset="banana"]');
  await page.waitForTimeout(700);
  const toastText = await page.evaluate(() => document.getElementById('toastRegion').textContent.trim());
  check('429 surfaces in the UI toast instead of crashing',
    /too many requests/i.test(toastText), toastText.slice(0, 90));
}

// --- 7. console ---------------------------------------------------------
const unexpectedErrors = errorsBeforeThrottle.filter(
  (text) => !/429|TOO MANY REQUESTS/i.test(text),
);
check('no console or page errors outside the intentional 429s',
  unexpectedErrors.length === 0,
  unexpectedErrors.slice(0, 2).join(' | ') || 'clean');

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
