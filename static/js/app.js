/**
 * EcoSort frontend.
 *
 * Owns: profile sync, camera capture + image upload, AI/backoff identification,
 * disposal, challenge claims and the two leaderboards.
 *
 * Camera notes:
 * - Live preview uses getUserMedia({ facingMode: ideal 'environment' }). It needs
 *   a secure context (https or localhost); permission denial, missing hardware,
 *   a busy device and an insecure page all degrade to the upload/file path plus
 *   the six presets instead of dead-ending.
 * - A captured frame is sent as a JPEG blob; nothing is recorded or stored
 *   beyond the single frame the user asked to analyse.
 * - The server response carries `source` (`ai_vision` or `rules`) so the UI can
 *   say where the guidance came from instead of implying a model ran.
 */

const DOMAIN = JSON.parse(document.getElementById('domain-config').textContent);
const PROFILE_KEY = 'ecosort.profile';

const el = {
  tabs: Array.from(document.querySelectorAll('.tab')),
  panels: Array.from(document.querySelectorAll('.panel')),
  username: document.getElementById('username'),
  groupName: document.getElementById('group-name'),
  city: document.getElementById('city'),
  setProfile: document.getElementById('set-profile'),
  ecoScore: document.getElementById('eco-score'),
  toast: document.getElementById('toast'),
  bins: document.getElementById('bins'),
  dropzone: document.getElementById('dropzone'),
  video: document.getElementById('camera-video'),
  preview: document.getElementById('capture-preview'),
  placeholder: document.getElementById('camera-placeholder'),
  startCamera: document.getElementById('start-camera'),
  capturePhoto: document.getElementById('capture-photo'),
  switchCamera: document.getElementById('switch-camera'),
  retake: document.getElementById('retake'),
  stopCamera: document.getElementById('stop-camera'),
  cameraStatus: document.getElementById('camera-status'),
  capabilityNote: document.getElementById('capability-note'),
  imageInput: document.getElementById('image-input'),
  presets: Array.from(document.querySelectorAll('.preset')),
  resultCard: document.getElementById('result-card'),
  resultCategory: document.getElementById('result-category'),
  resultPoints: document.getElementById('result-points'),
  resultSource: document.getElementById('result-source'),
  resultName: document.getElementById('result-name'),
  resultInstructions: document.getElementById('result-instructions'),
  resultAnalysis: document.getElementById('result-analysis'),
  resultConfidence: document.getElementById('result-confidence'),
  resultSteps: document.getElementById('result-steps'),
  resultWhy: document.getElementById('result-why'),
  resultNote: document.getElementById('result-note'),
  resultLocalNote: document.getElementById('result-local-note'),
  disposeBtn: document.getElementById('dispose-btn'),
  claims: Array.from(document.querySelectorAll('[data-claim-day]')),
  groupRank: document.getElementById('group-rank'),
  userRank: document.getElementById('user-rank'),
};

const state = {
  profile: null,
  result: null,
  busy: false,
  capabilities: null,
};

const camera = {
  stream: null,
  facing: 'environment',
  canSwitch: false,
  previewUrl: null,
  capturedBlob: null,
};

let toastTimer = null;

/* --- utilities ---------------------------------------------------------- */

function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  requestAnimationFrame(() => el.toast.classList.add('is-visible'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.classList.remove('is-visible');
    setTimeout(() => {
      el.toast.hidden = true;
    }, 200);
  }, 3200);
}

function setCameraStatus(message, isError = false) {
  el.cameraStatus.textContent = message || '';
  el.cameraStatus.classList.toggle('is-error', Boolean(isError));
}

class HttpError extends Error {
  constructor(message, status, retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function callApi(path, options) {
  const response = await fetch(path, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = (payload && payload.error) || `Request failed (${response.status})`;
    throw new HttpError(message, response.status, payload && payload.retry_after);
  }
  return payload;
}

function postJson(path, body) {
  return callApi(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postForm(path, formData) {
  return callApi(path, { method: 'POST', body: formData });
}

function newClientToken() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `t-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

/* --- rendering ---------------------------------------------------------- */

function setEcoScore(points) {
  el.ecoScore.textContent = String(points);
}

function pulseBin(category, count) {
  const bin = el.bins.querySelector(`[data-category="${category}"]`);
  if (!bin) {
    return;
  }
  if (typeof count === 'number') {
    const counter = bin.querySelector('[data-count-for]');
    if (counter) {
      counter.textContent = String(count);
    }
  }
  bin.classList.remove('is-pulsing');
  void bin.offsetWidth;
  bin.classList.add('is-pulsing');
}

function renderBins(counts) {
  if (!counts) {
    return;
  }
  for (const [category, count] of Object.entries(counts)) {
    pulseBin(category, count);
  }
}

function renderBadges(badges) {
  if (!badges) {
    return;
  }
  for (const badge of badges) {
    const node = document.querySelector(`.badge[data-badge="${badge.id}"]`);
    if (!node) {
      continue;
    }
    node.classList.toggle('is-unlocked', Boolean(badge.unlocked));
    node.classList.toggle('is-locked', !badge.unlocked);
    const label = node.querySelector('.badge-state');
    if (label) {
      label.textContent = badge.unlocked ? 'Unlocked' : 'Locked';
    }
  }
}

function renderChallenges(challenges) {
  if (!challenges) {
    return;
  }
  for (const challenge of challenges) {
    const row = document.querySelector(`.challenge[data-day="${challenge.day_number}"]`);
    if (!row) {
      continue;
    }
    row.classList.toggle('is-done', Boolean(challenge.completed));
    const button = row.querySelector('.btn-claim');
    if (button) {
      button.disabled = Boolean(challenge.completed);
      button.textContent = challenge.completed
        ? 'Claimed'
        : `Claim +${DOMAIN.challengeReward}`;
    }
  }
}

function renderResult(result) {
  state.result = result;
  el.resultCard.hidden = false;

  const meta = DOMAIN.bins[result.category];
  if (meta) {
    el.resultCard.style.setProperty('--bin', meta.hex);
  }

  el.resultCategory.textContent = result.category;
  el.resultPoints.textContent = `+${result.points} pts`;
  el.resultName.textContent = result.display_name;
  el.resultInstructions.textContent = result.instructions;

  const fromAi = result.source === 'ai_vision';
  el.resultSource.hidden = false;
  el.resultSource.dataset.source = fromAi ? 'ai_vision' : 'offline_fallback';
  el.resultSource.textContent = fromAi
    ? `AI Vision${result.ai_model ? ` · ${result.ai_model}` : ''}`
    : 'Offline fallback';

  const steps = Array.isArray(result.preparation_steps) ? result.preparation_steps : [];
  if (steps.length > 0) {
    el.resultAnalysis.hidden = false;
    el.resultConfidence.textContent =
      typeof result.confidence === 'number'
        ? `Confidence ${Math.round(result.confidence * 100)}%`
        : 'Model confidence unavailable';
    el.resultSteps.innerHTML = steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('');
    el.resultWhy.textContent = result.why || '';
    el.resultWhy.hidden = !result.why;
  } else {
    el.resultAnalysis.hidden = true;
  }

  if (result.vision_error) {
    el.resultNote.hidden = false;
    el.resultNote.textContent = `AI vision unavailable — ${result.vision_error}. Showing offline rules.`;
  } else if (!fromAi && result.vision_available === false) {
    el.resultNote.hidden = false;
    el.resultNote.textContent =
      'AI vision is not configured on this server, so the offline rule engine answered.';
  } else {
    el.resultNote.hidden = true;
  }

  if (result.local_note) {
    el.resultLocalNote.hidden = false;
    el.resultLocalNote.textContent = result.local_note;
  } else {
    el.resultLocalNote.hidden = true;
  }

  el.disposeBtn.disabled = false;
  el.disposeBtn.textContent = 'Toss into Virtual Bin';
}

function clearResult() {
  state.result = null;
  el.resultCard.hidden = true;
}

function rankRow(position, title, subtitle, score) {
  return `
    <li class="rank-item">
      <span class="rank-position">${position}</span>
      <span class="rank-name">${escapeHtml(title)}
        <span class="rank-sub">${escapeHtml(subtitle)}</span>
      </span>
      <span class="rank-score">${score} pts</span>
    </li>`;
}

function renderLeaderboards(payload) {
  // `groups` is the current shape; `campuses` is accepted from older servers.
  const groups = (payload && (payload.groups || payload.campuses)) || [];
  const users = (payload && payload.users) || [];

  el.userRank.innerHTML = users.length
    ? users
        .map((row, index) =>
          rankRow(
            index + 1,
            row.username,
            [row.group_name || row.campus, row.city].filter(Boolean).join(' · '),
            row.eco_points,
          ),
        )
        .join('')
    : '<li class="rank-empty">No disposals logged yet.</li>';

  el.groupRank.innerHTML = groups.length
    ? groups
        .map((row, index) =>
          rankRow(
            index + 1,
            row.group_name || row.campus,
            `${row.members} member${row.members === 1 ? '' : 's'}`,
            row.total_points,
          ),
        )
        .join('')
    : '<li class="rank-empty">No group data yet.</li>';
}

function renderCapabilities(payload) {
  state.capabilities = payload;
  const vision = (payload && payload.ai_vision) || {};
  if (vision.enabled) {
    el.capabilityNote.textContent = `AI vision: on (${vision.model})`;
    el.capabilityNote.classList.remove('is-offline');
  } else {
    el.capabilityNote.textContent = 'AI vision: off — offline rules engine active';
    el.capabilityNote.classList.add('is-offline');
  }
}

/* --- profile ------------------------------------------------------------ */

function saveProfile(user) {
  state.profile = user;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(user));
  el.username.value = user.username;
  if (user.group_name) {
    el.groupName.value = user.group_name;
  }
  if (user.city) {
    el.city.value = user.city;
  }
}

function restoreProfile() {
  const raw = localStorage.getItem(PROFILE_KEY);
  if (!raw) {
    return false;
  }
  try {
    const user = JSON.parse(raw);
    if (!user || typeof user.username !== 'string') {
      throw new Error('invalid');
    }
    state.profile = user;
    el.username.value = user.username;
    if (user.group_name || user.campus) {
      el.groupName.value = user.group_name || user.campus;
    }
    if (user.city) {
      el.city.value = user.city;
    }
    if (typeof user.eco_points === 'number') {
      setEcoScore(user.eco_points);
    }
    return true;
  } catch {
    localStorage.removeItem(PROFILE_KEY);
    return false;
  }
}

function applyUserPayload(payload) {
  saveProfile(payload.user);
  setEcoScore(payload.user.eco_points);
  renderBins(payload.bin_counts);
  renderBadges(payload.badges);
  renderChallenges(payload.challenges);
}

async function syncProfile({ announce } = { announce: true }) {
  const username = el.username.value.trim();
  const groupName = el.groupName.value.trim();
  const city = el.city.value.trim();
  if (!username) {
    toast('Enter a name first.');
    el.username.focus();
    return false;
  }

  el.setProfile.disabled = true;
  try {
    const payload = await postJson('/api/user', {
      username,
      group_name: groupName,
      city,
    });
    applyUserPayload(payload);
    if (announce) {
      const where = [payload.user.group_name, payload.user.city].filter(Boolean).join(' · ');
      toast(`Welcome ${payload.user.username}${where ? ` · ${where}` : ''}`);
    }
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  } finally {
    el.setProfile.disabled = false;
  }
}

/* --- camera ------------------------------------------------------------- */

async function stopStream() {
  if (camera.stream) {
    for (const track of camera.stream.getTracks()) {
      track.stop();
    }
    camera.stream = null;
  }
  el.video.srcObject = null;
}

function setCameraIdle() {
  el.video.hidden = true;
  el.preview.hidden = true;
  el.placeholder.hidden = false;
  el.startCamera.hidden = false;
  el.capturePhoto.hidden = true;
  el.switchCamera.hidden = true;
  el.retake.hidden = true;
  el.stopCamera.hidden = true;
}

async function countVideoInputs() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'videoinput').length;
  } catch {
    return 1;
  }
}

async function startCamera() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    setCameraStatus('This browser has no camera API. Use Upload photo or a quick sample below.', true);
    return;
  }
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!window.isSecureContext && !localHost) {
    setCameraStatus(
      'Live camera needs HTTPS (or localhost). Use Upload photo or a quick sample below.',
      true,
    );
    return;
  }

  el.startCamera.disabled = true;
  setCameraStatus('Requesting camera permission…');
  try {
    await stopStream();
    try {
      camera.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: camera.facing } },
        audio: false,
      });
    } catch (error) {
      // A device may refuse facingMode but still deliver a stream.
      if (error && (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError')) {
        camera.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } else {
        throw error;
      }
    }

    el.video.srcObject = camera.stream;
    try {
      await el.video.play();
    } catch {
      /* autoplay can be blocked; the stream is still attached */
    }

    el.placeholder.hidden = true;
    el.preview.hidden = true;
    el.video.hidden = false;
    el.capturePhoto.hidden = false;
    el.stopCamera.hidden = false;
    el.retake.hidden = true;
    el.startCamera.hidden = true;

    camera.canSwitch = (await countVideoInputs()) > 1;
    el.switchCamera.hidden = !camera.canSwitch;
    setCameraStatus(
      camera.canSwitch
        ? 'Camera live. Frame the item and tap Capture Photo.'
        : 'Camera live. Frame the item and tap Capture Photo.',
    );
  } catch (error) {
    const name = (error && error.name) || 'Error';
    const messages = {
      NotAllowedError: 'Camera permission denied. Use Upload photo or a quick sample below.',
      PermissionDeniedError: 'Camera permission denied. Use Upload photo or a quick sample below.',
      NotFoundError: 'No camera found. Use Upload photo or a quick sample below.',
      DevicesNotFoundError: 'No camera found. Use Upload photo or a quick sample below.',
      NotReadableError: 'The camera is busy in another app. Close it, or use Upload photo.',
      TrackStartError: 'The camera could not start. Use Upload photo or a quick sample below.',
      SecurityError: 'The browser blocked camera access. Use Upload photo instead.',
    };
    setCameraStatus(messages[name] || `Camera unavailable (${name}). Use Upload photo instead.`, true);
    setCameraIdle();
  } finally {
    el.startCamera.disabled = false;
  }
}

async function switchCamera() {
  camera.facing = camera.facing === 'environment' ? 'user' : 'environment';
  setCameraStatus(`Switching to the ${camera.facing === 'user' ? 'front' : 'rear'} camera…`);
  await startCamera();
}

function showPreview(url) {
  if (camera.previewUrl) {
    URL.revokeObjectURL(camera.previewUrl);
  }
  camera.previewUrl = url;
  el.preview.src = url;
  el.preview.hidden = false;
  el.video.hidden = true;
  el.placeholder.hidden = true;
}

async function capturePhoto() {
  if (!camera.stream) {
    setCameraStatus('Camera is not running.', true);
    return;
  }
  const width = el.video.videoWidth || 1280;
  const height = el.video.videoHeight || 720;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    setCameraStatus('This browser could not capture the frame.', true);
    return;
  }
  context.drawImage(el.video, 0, 0, width, height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) {
    setCameraStatus('Capture produced no image. Try again.', true);
    return;
  }

  camera.capturedBlob = blob;
  showPreview(URL.createObjectURL(blob));
  el.capturePhoto.hidden = true;
  el.retake.hidden = false;
  el.stopCamera.hidden = false;
  el.switchCamera.hidden = true;
  setCameraStatus(`Captured ${width}×${height}. Analysing…`);

  await identifyBlob(blob, `camera-capture-${Date.now()}.jpg`);
  setCameraStatus('Captured. Retake for another frame, or Stop Camera.');
}

function retakePhoto() {
  camera.capturedBlob = null;
  el.retake.hidden = true;
  el.capturePhoto.hidden = false;
  el.switchCamera.hidden = !camera.canSwitch;
  el.preview.hidden = true;
  el.video.hidden = false;
  clearResult();
  setCameraStatus('Ready — frame the item and capture again.');
}

async function stopCamera() {
  await stopStream();
  camera.capturedBlob = null;
  setCameraIdle();
  setCameraStatus('Camera stopped.');
}

/* --- identification ----------------------------------------------------- */

function setPresetsDisabled(disabled) {
  for (const preset of el.presets) {
    preset.disabled = disabled;
  }
}

async function identifyRequest(buildForm, label) {
  if (state.busy) {
    return;
  }
  state.busy = true;
  setPresetsDisabled(true);
  try {
    const result = await postForm('/api/identify', buildForm());
    renderResult(result);
    const provenance = result.source === 'ai_vision' ? 'AI vision' : 'offline rules';
    toast(
      result.fallback
        ? `${label}: no catalog match, sorted as ${result.category} (${provenance}).`
        : `${label}: ${result.category} · +${result.points} pts (${provenance})`,
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) {
      const wait = error.retryAfter ? ` Retry in ${error.retryAfter}s.` : '';
      setCameraStatus(error.message, true);
      toast(`${error.message}${wait}`);
    } else {
      toast(error.message);
    }
  } finally {
    state.busy = false;
    setPresetsDisabled(false);
  }
}

function identifyPreset(keyword, label) {
  identifyRequest(() => {
    const form = new FormData();
    form.append('preset_keyword', keyword);
    return form;
  }, label);
}

function identifyBlob(blob, filename) {
  return identifyRequest(() => {
    const form = new FormData();
    form.append('image', blob, filename);
    return form;
  }, filename);
}

function handleFile(file) {
  if (!file) {
    return;
  }
  showPreview(URL.createObjectURL(file));
  setCameraStatus(`${file.name} selected. Analysing…`);
  identifyBlob(file, file.name || 'upload.jpg');
}

/* --- disposal ----------------------------------------------------------- */

async function dispose() {
  if (state.busy) {
    return;
  }
  if (!state.profile || typeof state.profile.id !== 'number') {
    toast('Set a profile first.');
    return;
  }
  if (!state.result) {
    toast('Scan an item first.');
    return;
  }

  state.busy = true;
  el.disposeBtn.disabled = true;
  el.disposeBtn.textContent = 'Tossing…';
  const item = state.result;
  try {
    const payload = await postJson('/api/dispose', {
      user_id: state.profile.id,
      item_name: item.display_name,
      client_token: newClientToken(),
    });

    setEcoScore(payload.new_points);
    state.profile.eco_points = payload.new_points;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
    renderBins(payload.bin_counts);
    renderBadges(payload.badges);
    clearResult();

    toast(
      payload.duplicate
        ? `${item.display_name} was already logged.`
        : `${item.display_name} → ${payload.logged.category} bin (+${payload.logged.points} pts)`,
    );
    await refreshLeaderboards();
  } catch (error) {
    toast(error.message);
    el.disposeBtn.disabled = false;
    el.disposeBtn.textContent = 'Toss into Virtual Bin';
  } finally {
    state.busy = false;
  }
}

/* --- challenges --------------------------------------------------------- */

async function claimDay(day, button) {
  if (state.busy) {
    return;
  }
  if (!state.profile || typeof state.profile.id !== 'number') {
    toast('Set a profile first.');
    return;
  }

  state.busy = true;
  button.disabled = true;
  try {
    const payload = await postJson('/api/challenge/complete', {
      user_id: state.profile.id,
      day_number: day,
    });
    setEcoScore(payload.new_points);
    state.profile.eco_points = payload.new_points;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
    renderChallenges(payload.challenges);
    toast(
      payload.awarded
        ? `Day ${day} claimed (+${payload.awarded_points} pts)`
        : `Day ${day} was already claimed.`,
    );
    await refreshLeaderboards();
  } catch (error) {
    toast(error.message);
    button.disabled = false;
  } finally {
    state.busy = false;
  }
}

/* --- leaderboards ------------------------------------------------------- */

async function refreshLeaderboards() {
  try {
    renderLeaderboards(await callApi('/api/leaderboard'));
  } catch (error) {
    el.groupRank.innerHTML = `<li class="rank-empty">${escapeHtml(error.message)}</li>`;
    el.userRank.innerHTML = '';
  }
}

/* --- navigation & wiring ------------------------------------------------ */

function activateTab(name) {
  for (const tab of el.tabs) {
    const isActive = tab.dataset.tab === name;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  }
  for (const panel of el.panels) {
    const isActive = panel.id === `tab-${name}`;
    panel.classList.toggle('is-active', isActive);
    panel.hidden = !isActive;
  }
  if (name === 'rank') {
    refreshLeaderboards();
  }
}

function wireEvents() {
  el.tabs.forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });

  const tablist = document.querySelector('.tabs');
  tablist.addEventListener('keydown', (event) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) {
      return;
    }
    event.preventDefault();
    const order = el.tabs.map((tab) => tab.dataset.tab);
    const current = order.indexOf(
      document.activeElement?.dataset?.tab ?? el.tabs[0].dataset.tab,
    );
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % order.length;
    if (event.key === 'ArrowLeft') next = (current - 1 + order.length) % order.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = order.length - 1;
    activateTab(order[next]);
    el.tabs[next].focus();
  });

  el.setProfile.addEventListener('click', () => syncProfile());
  el.username.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      syncProfile();
    }
  });

  el.startCamera.addEventListener('click', startCamera);
  el.capturePhoto.addEventListener('click', capturePhoto);
  el.switchCamera.addEventListener('click', switchCamera);
  el.retake.addEventListener('click', retakePhoto);
  el.stopCamera.addEventListener('click', stopCamera);

  el.presets.forEach((preset) => {
    preset.addEventListener('click', () =>
      identifyPreset(preset.dataset.preset, preset.textContent.trim()),
    );
  });

  el.imageInput.addEventListener('change', () => {
    handleFile(el.imageInput.files[0]);
    el.imageInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((type) => {
    el.dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      el.dropzone.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    el.dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      el.dropzone.classList.remove('is-dragover');
    });
  });
  el.dropzone.addEventListener('drop', (event) => {
    handleFile(event.dataTransfer?.files?.[0]);
  });

  el.disposeBtn.addEventListener('click', dispose);
  el.claims.forEach((button) => {
    button.addEventListener('click', () =>
      claimDay(Number(button.dataset.claimDay), button),
    );
  });

  window.addEventListener('pagehide', () => {
    stopStream();
  });
}

async function init() {
  wireEvents();
  activateTab('scan');
  if (restoreProfile()) {
    await syncProfile({ announce: false });
  }
  try {
    renderCapabilities(await callApi('/api/capabilities'));
  } catch {
    el.capabilityNote.textContent = 'Capabilities unavailable';
    el.capabilityNote.classList.add('is-offline');
  }
  await refreshLeaderboards();
}

init();
