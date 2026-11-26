/**
 * EcoSort frontend.
 *
 * One page, three panels. All rendering is driven by server responses; the client
 * never computes points, badges or bin totals itself.
 *
 * Scan paths: live camera (getUserMedia) -> canvas -> JPEG bytes; file upload;
 * or a quick sample (no image, rules only). Every path posts multipart `image`
 * and/or `preset_keyword` to /api/identify, and the card shows which engine
 * answered (`analysis_mode`).
 */

const DOMAIN = JSON.parse(document.getElementById('domain-config').textContent);
const PROFILE_KEY = 'ecosort.profile';
const CUSTOM = '__custom__';

const el = {
  // header / settings
  ecoScore: document.getElementById('eco-score'),
  settings: document.getElementById('settings'),
  visionStatus: document.getElementById('vision-status'),
  limitsStatus: document.getElementById('limits-status'),
  profileStatus: document.getElementById('profile-status'),
  resetProfile: document.getElementById('reset-profile'),

  // profile
  username: document.getElementById('username'),
  groupSelect: document.getElementById('group-select'),
  groupCustom: document.getElementById('group-custom'),
  groupCustomField: document.getElementById('group-custom-field'),
  citySelect: document.getElementById('city-select'),
  cityCustom: document.getElementById('city-custom'),
  cityCustomField: document.getElementById('city-custom-field'),
  setProfile: document.getElementById('set-profile'),
  profileSummary: document.getElementById('profile-summary'),

  // tabs
  tabs: Array.from(document.querySelectorAll('.tab')),
  panels: Array.from(document.querySelectorAll('.panel')),

  // camera
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

  // upload / samples
  imageInput: document.getElementById('image-input'),
  sampleSelect: document.getElementById('sample-select'),
  useSample: document.getElementById('use-sample'),
  presets: Array.from(document.querySelectorAll('.preset')),

  // result
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
  categoryOverride: document.getElementById('category-override'),
  overrideHint: document.getElementById('override-hint'),
  disposeBtn: document.getElementById('dispose-btn'),
  bins: document.getElementById('bins'),

  // badges / challenges
  challengeFilter: document.getElementById('challenge-filter'),
  challenges: document.getElementById('challenges'),
  claims: Array.from(document.querySelectorAll('[data-claim-day]')),

  // leaderboards
  rankScope: document.getElementById('rank-scope'),
  rankFilterField: document.getElementById('rank-filter-field'),
  rankFilter: document.getElementById('rank-filter'),
  userRank: document.getElementById('user-rank'),
  groupRank: document.getElementById('group-rank'),

  toast: document.getElementById('toast'),
};

const state = {
  profile: null,
  result: null,
  leadership: { users: [], groups: [] },
  busy: false,
};

const camera = {
  stream: null,
  devices: [],
  deviceId: null,
  canSwitch: false,
  previewUrl: null,
};

let toastTimer = null;

/* ---------------- utilities ---------------- */

function toast(message, isError = false) {
  const text = String(message || '').slice(0, 220);
  if (!text) {
    return;
  }
  el.toast.textContent = text;
  el.toast.classList.toggle('is-error', Boolean(isError));
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

const postJson = (path, body) =>
  callApi(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const postForm = (path, formData) => callApi(path, { method: 'POST', body: formData });

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

function setBusy(button, busy, label) {
  if (!button) {
    return;
  }
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
  if (label) {
    if (busy) {
      button.dataset.idleLabel = button.textContent;
      button.textContent = label;
    } else if (button.dataset.idleLabel) {
      button.textContent = button.dataset.idleLabel;
      delete button.dataset.idleLabel;
    }
  }
}

/* ---------------- profile controls ---------------- */

function resolveSelect(select, custom) {
  const value = select.value;
  if (value === CUSTOM) {
    return (custom.value || '').trim();
  }
  return value;
}

function syncCustomFields() {
  el.groupCustomField.classList.toggle('is-hidden', el.groupSelect.value !== CUSTOM);
  el.cityCustomField.classList.toggle('is-hidden', el.citySelect.value !== CUSTOM);
}

function setSelectValue(select, custom, value) {
  const preset = Array.from(select.options).find(
    (option) => option.value !== CUSTOM && option.value === value,
  );
  if (preset) {
    select.value = value;
    custom.value = '';
  } else if (value) {
    select.value = CUSTOM;
    custom.value = value;
  }
  syncCustomFields();
}

function saveProfile(user) {
  state.profile = user;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(user));
  el.username.value = user.username;
  setSelectValue(el.groupSelect, el.groupCustom, user.group_name || '');
  setSelectValue(el.citySelect, el.cityCustom, user.city || '');
  renderProfileSummary();
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
    saveProfile(user);
    if (typeof user.eco_points === 'number') {
      el.ecoScore.textContent = String(user.eco_points);
    }
    return true;
  } catch {
    localStorage.removeItem(PROFILE_KEY);
    return false;
  }
}

function renderProfileSummary() {
  const user = state.profile;
  if (!user) {
    el.profileSummary.textContent = 'Set a name, community and city to start.';
    el.profileStatus.textContent = 'None';
    return;
  }
  const where = [user.group_name, user.city].filter(Boolean).join(' \u00b7 ');
  el.profileSummary.textContent = `${user.username}${where ? ` \u2014 ${where}` : ''}`;
  el.profileStatus.textContent = `${user.username} (${where || 'no group'})`;
}

async function applyProfile({ silent = false } = {}) {
  const username = el.username.value.trim();
  if (!username) {
    toast('Enter a display name first.', true);
    el.username.focus();
    return;
  }
  const groupName = resolveSelect(el.groupSelect, el.groupCustom);
  const city = resolveSelect(el.citySelect, el.cityCustom);

  setBusy(el.setProfile, true, 'Applying\u2026');
  try {
    const payload = await postJson('/api/user', {
      username,
      group_name: groupName,
      city,
    });
    applyUserPayload(payload);
    if (!silent) {
      toast(`Profile applied: ${payload.user.username}`);
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(el.setProfile, false);
  }
}

function applyUserPayload(payload) {
  saveProfile(payload.user);
  el.ecoScore.textContent = String(payload.user.eco_points);
  renderBins(payload.bin_counts);
  renderBadges(payload.badges);
  renderChallenges(payload.challenges);
}

/* ---------------- header / settings ---------------- */

async function loadCapabilities() {
  try {
    const payload = await callApi('/api/capabilities');
    const vision = payload.ai_vision || {};
    el.visionStatus.textContent = vision.enabled
      ? `AI vision on \u2014 ${vision.model} (${vision.provider})`
      : 'AI vision off \u2014 deterministic rules (no GEMINI_API_KEY)';
    const limits = payload.rate_limits || {};
    el.limitsStatus.textContent = payload.rate_limit_enabled
      ? `Limits/min \u2014 scan ${limits.identify}, AI ${limits.ai_vision}, writes ${limits.general}`
      : 'Rate limiting disabled';
  } catch (error) {
    el.visionStatus.textContent = 'Capabilities unavailable';
    el.limitsStatus.textContent = String(error.message).slice(0, 80);
  }
}

function resetProfile() {
  localStorage.removeItem(PROFILE_KEY);
  state.profile = null;
  state.result = null;
  el.ecoScore.textContent = '0';
  el.resultCard.hidden = true;
  el.username.value = '';
  el.groupSelect.value = el.groupSelect.options[0].value;
  el.citySelect.value = el.citySelect.options[0].value;
  el.groupCustom.value = '';
  el.cityCustom.value = '';
  syncCustomFields();
  renderProfileSummary();
  renderBins(
    Object.fromEntries(Object.keys(DOMAIN.bins).map((category) => [category, 0])),
  );
  toast('Local profile cleared. Data already logged stays on the server.');
  el.settings.open = false;
}

/* ---------------- bins / badges / challenges ---------------- */

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
    row.dataset.completed = challenge.completed ? 'true' : 'false';
    const button = row.querySelector('.btn-claim');
    if (button) {
      button.disabled = Boolean(challenge.completed);
      button.textContent = challenge.completed
        ? 'Claimed'
        : `Claim +${DOMAIN.challengeReward}`;
    }
  }
  applyChallengeFilter();
}

function applyChallengeFilter() {
  const mode = el.challengeFilter.value;
  let visible = 0;
  for (const row of el.challenges.querySelectorAll('.challenge')) {
    const done = row.dataset.completed === 'true';
    const show = mode === 'all' || (mode === 'completed' ? done : !done);
    row.hidden = !show;
    if (show) {
      visible += 1;
    }
  }
  el.challenges.classList.toggle('is-filtered-empty', visible === 0);
}

/* ---------------- result card ---------------- */

function renderResult(result) {
  state.result = result;
  el.resultCard.hidden = false;

  const meta = DOMAIN.bins[result.category];
  if (meta) {
    el.resultCard.style.setProperty('--bin', meta.hex);
  }

  const itemName = result.item_name || result.display_name || 'Unknown item';
  el.resultCategory.textContent = result.category;
  el.resultPoints.textContent = `+${result.points} pts`;
  el.resultName.textContent = itemName;
  el.resultInstructions.textContent = result.instructions;

  const fromAi = (result.analysis_mode || result.source) === 'ai_vision';
  el.resultSource.hidden = false;
  el.resultSource.dataset.source = fromAi ? 'ai_vision' : 'offline_fallback';
  el.resultSource.textContent = fromAi
    ? `AI Vision${result.ai_model ? ` \u00b7 ${result.ai_model}` : ''}`
    : 'Offline rules';

  const steps = Array.isArray(result.preparation_steps) ? result.preparation_steps : [];
  if (steps.length > 0) {
    el.resultAnalysis.hidden = false;
    if (typeof result.confidence === 'string' && result.confidence) {
      el.resultConfidence.textContent = `Confidence: ${result.confidence}`;
    } else if (typeof result.confidence === 'number') {
      el.resultConfidence.textContent = `Confidence: ${Math.round(result.confidence * 100)}%`;
    } else {
      el.resultConfidence.textContent = 'Confidence not reported';
    }
    el.resultSteps.innerHTML = steps
      .map((step) => `<li>${escapeHtml(step)}</li>`)
      .join('');
    el.resultWhy.textContent = result.why || '';
    el.resultWhy.hidden = !result.why;
  } else {
    el.resultAnalysis.hidden = true;
  }

  if (result.vision_error) {
    el.resultNote.hidden = false;
    el.resultNote.textContent = `AI vision unavailable \u2014 ${result.vision_error}. Showing offline rules.`;
  } else if (!fromAi && result.vision_available === false) {
    el.resultNote.hidden = false;
    el.resultNote.textContent =
      'AI vision is not configured on this server, so the offline rule engine answered.';
  } else {
    el.resultNote.hidden = true;
  }

  el.resultLocalNote.hidden = !result.local_note;
  el.resultLocalNote.textContent = result.local_note || '';

  // Reset the correction control for each new scan.
  el.categoryOverride.value = '';
  el.overrideHint.hidden = true;
  setBusy(el.disposeBtn, false);
  el.disposeBtn.textContent = 'Toss into virtual bin';
}

function clearResult() {
  state.result = null;
  el.resultCard.hidden = true;
  el.categoryOverride.value = '';
  el.overrideHint.hidden = true;
}

/* ---------------- camera ---------------- */

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
  el.switchCamera.classList.add('is-hidden');
  el.retake.hidden = true;
  el.stopCamera.hidden = true;
}

function setCameraStatus(message, isError = false) {
  el.cameraStatus.textContent = message || '';
  el.cameraStatus.classList.toggle('is-error', Boolean(isError));
}

async function listCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    camera.devices = devices.filter((device) => device.kind === 'videoinput');
  } catch {
    camera.devices = [];
  }
  return camera.devices;
}

function renderCameraChooser() {
  const select = el.switchCamera;
  select.innerHTML = '';
  if (camera.devices.length <= 1) {
    select.classList.add('is-hidden');
    return;
  }
  for (const [index, device] of camera.devices.entries()) {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Camera ${index + 1}`;
    select.append(option);
  }
  if (camera.deviceId) {
    select.value = camera.deviceId;
  }
  select.classList.remove('is-hidden');
}

async function startCamera(deviceId = null) {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    setCameraStatus('This browser has no camera API. Upload a photo or tap a sample.', true);
    return;
  }
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!window.isSecureContext && !localHost) {
    setCameraStatus('Live camera needs HTTPS or localhost. Upload a photo instead.', true);
    return;
  }

  setBusy(el.startCamera, true, 'Opening\u2026');
  setCameraStatus('Requesting camera permission\u2026');
  try {
    await stopStream();
    const constraints = deviceId
      ? { video: { deviceId: { exact: deviceId } }, audio: false }
      : { video: { facingMode: { ideal: 'environment' } }, audio: false };
    try {
      camera.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
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
      /* autoplay can be blocked; the stream is attached regardless */
    }
    camera.deviceId = deviceId || camera.stream.getVideoTracks()[0]?.getSettings?.().deviceId || null;

    el.placeholder.hidden = true;
    el.preview.hidden = true;
    el.video.hidden = false;
    el.capturePhoto.hidden = false;
    el.stopCamera.hidden = false;
    el.retake.hidden = true;
    el.startCamera.hidden = true;

    await listCameras();
    renderCameraChooser();
    setCameraStatus(
      camera.devices.length > 1
        ? 'Camera live. Capture, or switch camera from the dropdown.'
        : 'Camera live. Frame the item and capture.',
    );
  } catch (error) {
    const name = (error && error.name) || 'Error';
    const messages = {
      NotAllowedError: 'Camera permission denied. Upload a photo or tap a sample.',
      PermissionDeniedError: 'Camera permission denied. Upload a photo or tap a sample.',
      NotFoundError: 'No camera found. Upload a photo or tap a sample.',
      DevicesNotFoundError: 'No camera found. Upload a photo or tap a sample.',
      NotReadableError: 'The camera is busy in another app. Close it, or upload a photo.',
      TrackStartError: 'The camera could not start. Upload a photo or tap a sample.',
      SecurityError: 'The browser blocked camera access. Upload a photo instead.',
    };
    setCameraStatus(messages[name] || `Camera unavailable (${name}). Upload a photo instead.`, true);
    setCameraIdle();
  } finally {
    setBusy(el.startCamera, false);
  }
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

  showPreview(URL.createObjectURL(blob));
  el.capturePhoto.hidden = true;
  el.retake.hidden = false;
  el.switchCamera.classList.add('is-hidden');
  setCameraStatus(`Captured ${width}\u00d7${height}. Analysing\u2026`);

  await identifyBlob(blob, `camera-capture-${Date.now()}.jpg`);
  setCameraStatus('Captured. Retake for another frame, or stop the camera.');
}

function retakePhoto() {
  el.retake.hidden = true;
  el.capturePhoto.hidden = false;
  el.switchCamera.classList.toggle('is-hidden', camera.devices.length <= 1);
  el.preview.hidden = true;
  el.video.hidden = false;
  clearResult();
  setCameraStatus('Ready \u2014 frame the item and capture again.');
}

async function stopCamera() {
  await stopStream();
  setCameraIdle();
  setCameraStatus('Camera stopped.');
}

/* ---------------- identification ---------------- */

async function identifyRequest(buildForm, label) {
  if (state.busy) {
    return;
  }
  state.busy = true;
  for (const preset of el.presets) {
    preset.disabled = true;
  }
  setBusy(el.useSample, true, 'Scanning\u2026');
  try {
    const result = await postForm('/api/identify', buildForm());
    renderResult(result);
    const fromAi = (result.analysis_mode || result.source) === 'ai_vision';
    const provenance = fromAi ? 'AI vision' : 'offline rules';
    const itemName = result.item_name || result.display_name;
    toast(
      result.fallback
        ? `${label}: no match, sorted as ${result.category} (${provenance}).`
        : `${itemName} \u2192 ${result.category} (+${result.points} pts, ${provenance})`,
    );
  } catch (error) {
    const wait = error.retryAfter ? ` Retry in ${error.retryAfter}s.` : '';
    toast(`${error.message}${wait}`, true);
    if (error.status === 429) {
      setCameraStatus(error.message, true);
    }
  } finally {
    state.busy = false;
    for (const preset of el.presets) {
      preset.disabled = false;
    }
    setBusy(el.useSample, false);
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
  setCameraStatus(`${file.name} selected. Analysing\u2026`);
  identifyBlob(file, file.name || 'upload.jpg');
}

/* ---------------- disposal ---------------- */

async function dispose() {
  if (state.busy) {
    return;
  }
  if (!state.profile || typeof state.profile.id !== 'number') {
    toast('Apply a profile first.', true);
    return;
  }
  if (!state.result) {
    toast('Scan an item first.', true);
    return;
  }

  const item = state.result;
  const override = el.categoryOverride.value;
  state.busy = true;
  setBusy(el.disposeBtn, true, 'Tossing\u2026');
  try {
    const payload = await postJson('/api/dispose', {
      user_id: state.profile.id,
      item_name: item.item_name || item.display_name,
      client_token: newClientToken(),
      ...(override ? { category_override: override } : {}),
    });

    el.ecoScore.textContent = String(payload.new_points);
    state.profile.eco_points = payload.new_points;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
    renderBins(payload.bin_counts);
    renderBadges(payload.badges);
    clearResult();

    toast(
      payload.duplicate
        ? 'Already logged \u2014 no double credit.'
        : `${payload.logged.item_name} \u2192 ${payload.logged.category} (+${payload.logged.points} pts)`,
    );
    await refreshLeaderboards();
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.busy = false;
    setBusy(el.disposeBtn, false);
    el.disposeBtn.textContent = 'Toss into virtual bin';
  }
}

/* ---------------- challenges ---------------- */

async function claimDay(day, button) {
  if (state.busy) {
    return;
  }
  if (!state.profile || typeof state.profile.id !== 'number') {
    toast('Apply a profile first.', true);
    return;
  }

  state.busy = true;
  setBusy(button, true, '\u2026');
  try {
    const payload = await postJson('/api/challenge/complete', {
      user_id: state.profile.id,
      day_number: day,
    });
    el.ecoScore.textContent = String(payload.new_points);
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
    toast(error.message, true);
    setBusy(button, false);
  } finally {
    state.busy = false;
  }
}

/* ---------------- leaderboards ---------------- */

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
  const groups = (payload && (payload.groups || payload.campuses)) || [];
  const users = (payload && payload.users) || [];
  state.leadership = { users, groups };

  el.userRank.innerHTML = users.length
    ? users
        .map((row, index) =>
          rankRow(
            index + 1,
            row.username,
            [row.group_name || row.campus, row.city].filter(Boolean).join(' \u00b7 '),
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

  const current = el.rankFilter.value;
  const options = ['<option value="">All communities</option>']
    .concat(
      groups.map(
        (row) =>
          `<option value="${escapeHtml(row.group_name || row.campus)}">${escapeHtml(
            row.group_name || row.campus,
          )}</option>`,
      ),
    )
    .join('');
  el.rankFilter.innerHTML = options;
  if (current) {
    el.rankFilter.value = current;
  }
  applyRankView();
}

function applyRankView() {
  const scope = el.rankScope.value;
  const showGroups = scope === 'groups';
  el.groupRank.hidden = !showGroups;
  el.userRank.hidden = showGroups;
  el.rankFilterField.hidden = !showGroups;

  const filter = el.rankFilter.value;
  if (!showGroups || !filter) {
    return;
  }
  const rows = state.leadership.groups.filter(
    (row) => (row.group_name || row.campus) === filter,
  );
  el.groupRank.innerHTML = rows.length
    ? rows
        .map((row, index) =>
          rankRow(
            index + 1,
            row.group_name || row.campus,
            `${row.members} member${row.members === 1 ? '' : 's'}`,
            row.total_points,
          ),
        )
        .join('')
    : '<li class="rank-empty">This community has no points yet.</li>';
}

async function refreshLeaderboards() {
  try {
    renderLeaderboards(await callApi('/api/leaderboard'));
  } catch (error) {
    el.userRank.innerHTML = `<li class="rank-empty">${escapeHtml(error.message)}</li>`;
  }
}

/* ---------------- navigation & wiring ---------------- */

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

  // profile
  el.groupSelect.addEventListener('change', syncCustomFields);
  el.citySelect.addEventListener('change', syncCustomFields);
  el.setProfile.addEventListener('click', applyProfile);
  el.username.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyProfile();
    }
  });
  el.resetProfile.addEventListener('click', resetProfile);

  // camera
  el.startCamera.addEventListener('click', () => startCamera());
  el.capturePhoto.addEventListener('click', capturePhoto);
  el.switchCamera.addEventListener('change', () => {
    if (el.switchCamera.value) {
      startCamera(el.switchCamera.value);
    }
  });
  el.retake.addEventListener('click', retakePhoto);
  el.stopCamera.addEventListener('click', stopCamera);

  // samples & upload
  el.useSample.addEventListener('click', () => {
    const keyword = el.sampleSelect.value;
    const label = el.sampleSelect.options[el.sampleSelect.selectedIndex].textContent;
    identifyPreset(keyword, label.trim());
  });
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

  // result
  el.categoryOverride.addEventListener('change', () => {
    el.overrideHint.hidden = el.categoryOverride.value === '';
  });
  el.disposeBtn.addEventListener('click', dispose);
  el.claims.forEach((button) => {
    button.addEventListener('click', () =>
      claimDay(Number(button.dataset.claimDay), button),
    );
  });

  // badges filter & leaderboard controls
  el.challengeFilter.addEventListener('change', applyChallengeFilter);
  el.rankScope.addEventListener('change', applyRankView);
  el.rankFilter.addEventListener('change', applyRankView);

  window.addEventListener('pagehide', () => {
    stopStream();
  });
}

async function init() {
  wireEvents();
  syncCustomFields();
  activateTab('scan');
  renderProfileSummary();
  loadCapabilities();
  if (restoreProfile()) {
    // Re-hydrate server state for the remembered profile without a toast.
    await applyProfile({ silent: true });
  }
  await refreshLeaderboards();
}

init();
