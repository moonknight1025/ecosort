/**
 * EcoSort frontend — the single Flask-served app.
 *
 * The UI is the refined green AI Studio layout. Every score, badge, bin count
 * and challenge state comes from the Flask API; the browser never invents
 * points. Camera frames, uploads and sample presets all post to
 * /api/identify, and /api/dispose is protected by a per-scan client_token so a
 * retried toss cannot double-credit.
 */

const DOMAIN = JSON.parse(document.getElementById('domain-config').textContent);
const PROFILE_KEY = 'ecosort.profile.v2';
const LEGACY_PROFILE_KEY = 'ecosort.profile';
const ACTIVITY_KEY = 'ecosort.activity.v1';
const DEMO_STATE_KEY = 'ecosort.demo.v1';
const CUSTOM = '__custom__';

const el = {
  // header / settings
  ecoPointsPill: document.getElementById('ecoPointsPill'),
  ecoPointsValue: document.getElementById('ecoPointsValue'),
  settingsToggleBtn: document.getElementById('settingsToggleBtn'),
  settingsPopover: document.getElementById('settingsPopover'),
  visionStatus: document.getElementById('visionStatus'),
  visionStatusShort: document.getElementById('visionStatusShort'),
  limitsStatus: document.getElementById('limitsStatus'),
  networkLabel: document.getElementById('networkLabel'),
  settingsLeaves: document.getElementById('settingsLeaves'),
  settingsAutoRead: document.getElementById('settingsAutoRead'),
  profileStatus: document.getElementById('profileStatus'),
  resetProfileBtn: document.getElementById('resetProfileBtn'),

  // profile
  profileForm: document.getElementById('profileForm'),
  applyProfileBtn: document.querySelector('#profileForm button[type="submit"]'),
  displayNameInput: document.getElementById('displayNameInput'),
  communitySelect: document.getElementById('communitySelect'),
  citySelect: document.getElementById('citySelect'),
  customProfileWrap: document.getElementById('customProfileWrap'),
  customCommunityField: document.getElementById('customCommunityField'),
  customCommunityInput: document.getElementById('customCommunityInput'),
  customCityField: document.getElementById('customCityField'),
  customCityInput: document.getElementById('customCityInput'),

  // tabs
  tabBtnScan: document.getElementById('tabBtnScan'),
  tabBtnBadges: document.getElementById('tabBtnBadges'),
  mobileTabScan: document.getElementById('mobileTabScan'),
  mobileTabBadges: document.getElementById('mobileTabBadges'),
  panelScan: document.getElementById('panelScan'),
  panelBadges: document.getElementById('panelBadges'),

  // camera
  cameraPlaceholder: document.getElementById('cameraPlaceholder'),
  cameraVideo: document.getElementById('cameraVideo'),
  imagePreview: document.getElementById('imagePreview'),
  cameraFallbackBox: document.getElementById('cameraFallbackBox'),
  cameraFallbackMsg: document.getElementById('cameraFallbackMsg'),
  startCameraBtn: document.getElementById('startCameraBtn'),
  capturePhotoBtn: document.getElementById('capturePhotoBtn'),
  stopCameraBtn: document.getElementById('stopCameraBtn'),
  cameraSwitchWrap: document.getElementById('cameraSwitchWrap'),
  cameraDeviceSelect: document.getElementById('cameraDeviceSelect'),
  photoUploadInput: document.getElementById('photoUploadInput'),
  clearScanBtn: document.getElementById('clearScanBtn'),
  captureCanvas: document.getElementById('captureCanvas'),
  leafCanvas: document.getElementById('leafCanvas'),

  // upload / samples
  samplePresetSelect: document.getElementById('samplePresetSelect'),
  presetChips: Array.from(document.querySelectorAll('.preset-chip')),

  // result
  resultEmptyState: document.getElementById('resultEmptyState'),
  resultActiveState: document.getElementById('resultActiveState'),
  resultItemName: document.getElementById('resultItemName'),
  resultRewardPill: document.getElementById('resultRewardPill'),
  resultCategoryBadge: document.getElementById('resultCategoryBadge'),
  resultBinBadge: document.getElementById('resultBinBadge'),
  resultModePill: document.getElementById('resultModePill'),
  resultConfidencePill: document.getElementById('resultConfidencePill'),
  readAloudBtn: document.getElementById('readAloudBtn'),
  readAloudLabel: document.getElementById('readAloudLabel'),
  autoReadBtn: document.getElementById('autoReadBtn'),
  resultVisionNote: document.getElementById('resultVisionNote'),
  resultStepsList: document.getElementById('resultStepsList'),
  resultLocalNote: document.getElementById('resultLocalNote'),
  prepChecklist: document.getElementById('prepChecklist'),
  prepCheckStatus: document.getElementById('prepCheckStatus'),
  binOverrideSelect: document.getElementById('binOverrideSelect'),
  selectedBinTag: document.getElementById('selectedBinTag'),
  tossToBinBtn: document.getElementById('tossToBinBtn'),
  recentActivityList: document.getElementById('recentActivityList'),

  // badges / challenges
  badgesGrid: document.getElementById('badgesGrid'),
  badgeFilterSelect: document.getElementById('badgeFilterSelect'),
  challengeFilterSelect: document.getElementById('challengeFilterSelect'),
  challengeList: document.getElementById('challengeList'),
  challengeProgressText: document.getElementById('challengeProgressText'),
  challengeProgressPercent: document.getElementById('challengeProgressPercent'),
  challengeProgressBar: document.getElementById('challengeProgressBar'),
  challengeRail: document.getElementById('challengeRail'),

  toastRegion: document.getElementById('toastRegion'),
};

const state = {
  profile: null,
  result: null,
  disposeToken: null,
  capabilities: null,
  busy: false,
  leavesEnabled: true,
  activity: [],
  apiAvailable: !window.__ECOSORT_STATIC__,
  demo: null,
};

const camera = {
  stream: null,
  devices: [],
  deviceId: null,
  previewUrl: null,
};

const speech = {
  supported: typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof window.SpeechSynthesisUtterance === 'function',
  utterance: null,
  speaking: false,
  autoRead: false,
  primed: false,
};

/* ---------------- static / demo fallback ---------------- */

const LOCAL_NOTE = 'Rules vary by municipality — check your local waste collection guidance.';

const DEMO_CATALOG = {
  bottle: {
    item_name: 'Plastic Bottle',
    category: 'Recyclable Waste',
    bin_color: 'Blue',
    points: 15,
    instructions: 'Empty and rinse the bottle, crush it flat, cap it, then drop it in the blue recyclables bin.',
    preparation_steps: [
      'Empty and rinse the bottle.',
      'Crush it flat and keep the cap on.',
      'Place it in the blue recyclables bin.',
    ],
  },
  banana: {
    item_name: 'Banana Peel',
    category: 'Wet Waste',
    bin_color: 'Green',
    points: 10,
    instructions: 'Drop the peel into the green wet-waste bin, ideally loose rather than in a plastic bag.',
    preparation_steps: [
      'Remove any produce sticker.',
      'Keep the peel loose, not bagged in plastic.',
      'Place it in the green wet-waste bin.',
    ],
  },
  battery: {
    item_name: 'Alkaline or Li-ion Battery',
    category: 'Hazardous Waste',
    bin_color: 'Red',
    points: 25,
    instructions: 'Tape the terminals, keep it away from heat, and drop it in the red hazardous-waste bin.',
    preparation_steps: [
      'Tape both battery terminals.',
      'Keep the battery away from heat and metal tools.',
      'Place it in the red hazardous-waste bin.',
    ],
  },
  box: {
    item_name: 'Cardboard Box',
    category: 'Recyclable Waste',
    bin_color: 'Blue',
    points: 15,
    instructions: 'Remove tape and flatten the box so it stacks neatly in the blue recyclables bin.',
    preparation_steps: [
      'Remove tape and packing inserts.',
      'Flatten the box completely.',
      'Place it in the blue recyclables bin.',
    ],
  },
  charger: {
    item_name: 'Broken Charger or Cable',
    category: 'E-Waste',
    bin_color: 'Purple',
    points: 20,
    instructions: 'Coil the cable, bag it separately, and hand it to the purple e-waste bin.',
    preparation_steps: [
      'Unplug and coil the damaged cable.',
      'Do not cut open the adapter casing.',
      'Place it in the purple e-waste bin.',
    ],
  },
  wrapper: {
    item_name: 'Soiled Chip Bag',
    category: 'Dry Waste',
    bin_color: 'Gray',
    points: 10,
    instructions: 'Multi-layer wrappers cannot be recycled. Bag them and drop them in the gray dry-waste bin.',
    preparation_steps: [
      'Shake out any remaining crumbs.',
      'Keep the wrapper out of the recycling stream.',
      'Place it in the gray dry-waste bin.',
    ],
  },
};

const DEMO_ALIASES = {
  plastic: 'bottle',
  food: 'banana',
  paper: 'box',
  phone: 'charger',
  med: 'battery',
  medicine: 'battery',
  tissue: 'wrapper',
};

const DEMO_POINTS = {
  'Wet Waste': 10,
  'Recyclable Waste': 15,
  'Dry Waste': 10,
  'E-Waste': 20,
  'Hazardous Waste': 25,
};

function defaultDemoChallenges() {
  return Array.from(document.querySelectorAll('[data-day]')).map((card) => ({
    day_number: Number(card.dataset.day),
    completed: card.classList.contains('completed'),
  }));
}

function defaultDemoBadges() {
  return DOMAIN.badges.map((badge) => ({ id: badge.id, unlocked: false }));
}

function defaultDemoState() {
  return {
    points: 0,
    bins: Object.fromEntries(Object.keys(DOMAIN.bins).map((category) => [category, 0])),
    badges: defaultDemoBadges(),
    challenges: defaultDemoChallenges(),
    usedTokens: [],
  };
}

function loadDemoState() {
  try {
    const raw = localStorage.getItem(DEMO_STATE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const base = defaultDemoState();
    if (!parsed || typeof parsed !== 'object') {
      return base;
    }
    return {
      ...base,
      ...parsed,
      bins: { ...base.bins, ...(parsed.bins || {}) },
      badges: Array.isArray(parsed.badges) && parsed.badges.length ? parsed.badges : base.badges,
      challenges: Array.isArray(parsed.challenges) && parsed.challenges.length
        ? parsed.challenges
        : base.challenges,
      usedTokens: Array.isArray(parsed.usedTokens) ? parsed.usedTokens : [],
    };
  } catch {
    return defaultDemoState();
  }
}

function saveDemoState() {
  if (!state.demo) {
    return;
  }
  try {
    localStorage.setItem(DEMO_STATE_KEY, JSON.stringify(state.demo));
  } catch {
    /* private browsing can reject storage; the in-memory state still works */
  }
}

function evaluateDemoBadges(demo) {
  const total = Object.values(demo.bins).reduce((sum, count) => sum + Number(count || 0), 0);
  const recyclable = Number(demo.bins['Recyclable Waste'] || 0) + Number(demo.bins['Dry Waste'] || 0);
  const hazardous = Number(demo.bins['E-Waste'] || 0) + Number(demo.bins['Hazardous Waste'] || 0);
  const unlocked = new Set(
    demo.badges.filter((badge) => badge.unlocked).map((badge) => badge.id),
  );
  if (total >= 1) unlocked.add('first_step');
  if (recyclable >= 3) unlocked.add('plastic_warrior');
  if (hazardous >= 1) unlocked.add('hazard_hero');
  if (demo.points >= 100) unlocked.add('green_champion');
  return DOMAIN.badges.map((badge) => ({ id: badge.id, unlocked: unlocked.has(badge.id) }));
}

function applyLocalState() {
  if (!state.profile || !state.demo) {
    return;
  }
  state.profile.eco_points = state.demo.points;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
  renderPoints(state.demo.points);
  renderBins(state.demo.bins);
  renderBadges(state.demo.badges);
  renderChallenges(state.demo.challenges);
}

function applyLocalProfile(profile) {
  state.profile = {
    id: 'local',
    username: profile.username,
    group_name: profile.group_name,
    city: profile.city,
    eco_points: state.demo ? state.demo.points : 0,
  };
  saveProfile(state.profile);
  applyLocalState();
}

function localResult(keyword) {
  const normalized = String(keyword || '').toLowerCase();
  let key = Object.keys(DEMO_CATALOG).find((candidate) => normalized.includes(candidate));
  if (!key) {
    const alias = Object.keys(DEMO_ALIASES).find((candidate) => normalized.includes(candidate));
    if (alias) key = DEMO_ALIASES[alias];
  }
  const base = key ? DEMO_CATALOG[key] : {
    item_name: 'Unrecognized item',
    category: 'Dry Waste',
    bin_color: 'Gray',
    points: 10,
    instructions: 'Bag the item securely and place it in the gray dry-waste bin.',
    preparation_steps: [
      'Bag the item securely.',
      'Place it in the gray dry-waste bin.',
    ],
  };
  return {
    ...base,
    display_name: base.item_name,
    analysis_mode: 'offline_fallback',
    source: 'offline_fallback',
    confidence: null,
    vision_available: false,
    fallback: !key,
    local_note: LOCAL_NOTE,
  };
}

function localIdentify(form) {
  const keyword = form.get('preset_keyword') || '';
  const image = form.get('image');
  const filename = image && image.name ? image.name : '';
  return localResult(keyword || filename);
}

function localDispose(category, itemName, token) {
  const demo = state.demo;
  if (demo.usedTokens.includes(token)) {
    return {
      new_points: demo.points,
      bin_counts: demo.bins,
      badges: demo.badges,
      logged: {
        item_name: itemName,
        category,
        bin_color: DOMAIN.bins[category] ? DOMAIN.bins[category].bin_color : 'Gray',
        points: 0,
      },
      duplicate: true,
    };
  }

  const points = DEMO_POINTS[category] || 10;
  demo.usedTokens = [...demo.usedTokens.slice(-40), token];
  demo.points += points;
  demo.bins[category] = Number(demo.bins[category] || 0) + 1;
  demo.badges = evaluateDemoBadges(demo);
  saveDemoState();
  return {
    new_points: demo.points,
    bin_counts: demo.bins,
    badges: demo.badges,
    logged: {
      item_name: itemName,
      category,
      bin_color: DOMAIN.bins[category] ? DOMAIN.bins[category].bin_color : 'Gray',
      points,
    },
    duplicate: false,
  };
}

function localClaimDay(day) {
  const demo = state.demo;
  const challenge = demo.challenges.find((item) => Number(item.day_number) === Number(day));
  if (!challenge || challenge.completed) {
    return {
      new_points: demo.points,
      challenges: demo.challenges,
      awarded: false,
      awarded_points: 0,
    };
  }
  challenge.completed = true;
  demo.points += DOMAIN.challengeReward;
  demo.badges = evaluateDemoBadges(demo);
  saveDemoState();
  return {
    new_points: demo.points,
    challenges: demo.challenges,
    awarded: true,
    awarded_points: DOMAIN.challengeReward,
  };
}

function isApiUnavailable(error) {
  return !error
    || error.name === 'TypeError'
    || error.status === 404
    || error.status === 405
    || error.status >= 500;
}

function markDemoMode() {
  state.apiAvailable = false;
  if (el.networkLabel) el.networkLabel.textContent = 'Local demo';
  if (el.visionStatusShort) el.visionStatusShort.textContent = 'demo';
}

/* ---------------- utilities ---------------- */

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function toast(message, isError = false) {
  const text = String(message || '').slice(0, 260);
  if (!text || !el.toastRegion) {
    return;
  }
  while (el.toastRegion.children.length >= 1) {
    el.toastRegion.firstElementChild.remove();
  }
  const node = document.createElement('div');
  node.className = `toast${isError ? ' is-error' : ''}`;
  node.textContent = text;
  el.toastRegion.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    node.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
    setTimeout(() => node.remove(), 230);
  }, 3000);
}

class HttpError extends Error {
  constructor(message, status, retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function friendlyError(error) {
  if (error && error.status === 429) {
    const wait = error.retryAfter
      ? ` Try again in ${error.retryAfter}s.`
      : ' Please wait a moment and try again.';
    return `Too many requests right now.${wait}`;
  }
  return (error && error.message) || 'Something went wrong.';
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

function setBusy(button, busy) {
  if (!button) {
    return;
  }
  button.disabled = Boolean(busy);
  button.classList.toggle('is-busy', Boolean(busy));
  button.setAttribute('aria-busy', String(Boolean(busy)));
}

/* ---------------- sorting-guide speech ---------------- */

function cleanSpeechText(value) {
  return String(value || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/[#*_`>|~^]/g, ' ')
    .replace(/[()[\]{}"“”‘’]/g, ' ')
    .replace(/[•·]/g, '. ')
    .replace(/[—–]/g, ', ')
    .replace(/&/g, ' and ')
    .replace(/[\/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentenceForSpeech(value) {
  const text = cleanSpeechText(value);
  if (!text) {
    return '';
  }
  const normalized = text
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/([.,!?])\1+/g, '$1');
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function buildSortingGuideSpeech(result) {
  if (!result) {
    return '';
  }
  const item = sentenceForSpeech(result.item_name || result.display_name || 'Scanned item');
  const category = cleanSpeechText(result.category || 'Dry waste');
  const binColor = cleanSpeechText(result.bin_color || '');
  const steps = Array.isArray(result.preparation_steps) && result.preparation_steps.length
    ? result.preparation_steps
    : String(result.instructions || '').split(/(?<=[.!?])\s+/);
  const spokenSteps = steps.map(sentenceForSpeech).filter(Boolean);
  const categoryLine = sentenceForSpeech(
    `Category ${category}${binColor ? `, ${binColor} bin` : ''}`,
  );
  const parts = [item, categoryLine];
  if (spokenSteps.length) {
    parts.push(`Sorting steps. ${spokenSteps.join(' ')}`);
  }
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function updateSpeechControls() {
  if (!el.readAloudBtn || !el.autoReadBtn) {
    return;
  }
  el.readAloudBtn.setAttribute('aria-pressed', String(speech.speaking));
  el.readAloudBtn.classList.toggle('is-speaking', speech.speaking);
  if (el.readAloudLabel) {
    el.readAloudLabel.textContent = speech.speaking ? 'Stop' : 'Read aloud';
  }
  el.autoReadBtn.checked = speech.autoRead;
  el.autoReadBtn.setAttribute('aria-pressed', String(speech.autoRead));
  el.autoReadBtn.classList.toggle('is-on', speech.autoRead);
  el.autoReadBtn.title = speech.autoRead ? 'Auto-read is on' : 'Auto-read is off';
  if (el.settingsAutoRead) {
    el.settingsAutoRead.checked = speech.autoRead;
  }
}

function stopSpeech() {
  speech.utterance = null;
  speech.speaking = false;
  if (speech.supported) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* a browser without a working synthesiser must not break the UI */
    }
  }
  updateSpeechControls();
}

function primeSpeech() {
  if (!speech.supported || speech.primed || speech.speaking) {
    return;
  }
  try {
    const primer = new SpeechSynthesisUtterance(' ');
    primer.volume = 0;
    primer.rate = 1;
    primer.onend = () => {
      speech.primed = true;
    };
    primer.onerror = () => {
      speech.primed = true;
    };
    window.speechSynthesis.speak(primer);
    speech.primed = true;
  } catch {
    speech.primed = false;
  }
}

function speakSortingGuide() {
  if (!speech.supported) {
    toast('Read aloud is not supported in this browser.', true);
    return;
  }
  const text = buildSortingGuideSpeech(state.result);
  if (!text) {
    toast('Scan an item to hear the sorting guide.', true);
    return;
  }

  stopSpeech();
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-IN';
    utterance.rate = 0.98;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onstart = () => {
      if (speech.utterance !== utterance) {
        return;
      }
      speech.speaking = true;
      updateSpeechControls();
    };
    utterance.onend = () => {
      if (speech.utterance !== utterance) {
        return;
      }
      speech.speaking = false;
      speech.utterance = null;
      updateSpeechControls();
    };
    utterance.onerror = (event) => {
      if (speech.utterance !== utterance) {
        return;
      }
      speech.speaking = false;
      speech.utterance = null;
      updateSpeechControls();
      if (event && event.error && !['interrupted', 'canceled'].includes(event.error)) {
        toast('Read aloud could not start.', true);
      }
    };
    speech.utterance = utterance;
    speech.speaking = true;
    updateSpeechControls();
    window.speechSynthesis.speak(utterance);
  } catch {
    speech.utterance = null;
    speech.speaking = false;
    updateSpeechControls();
    toast('Read aloud is blocked in this browser.', true);
  }
}

function initSpeech() {
  if (!speech.supported) {
    if (el.readAloudBtn) {
      el.readAloudBtn.disabled = true;
      el.readAloudBtn.title = 'Read aloud is not supported in this browser';
    }
    if (el.autoReadBtn) {
      el.autoReadBtn.disabled = true;
      el.autoReadBtn.title = 'Read aloud is not supported in this browser';
    }
  }
  updateSpeechControls();
}

/* ---------------- profile ---------------- */

function resolveSelect(select, input) {
  if (select.value === CUSTOM) {
    return (input.value || '').trim();
  }
  return select.value;
}

function syncCustomProfileFields() {
  const showCommunity = el.communitySelect.value === CUSTOM;
  const showCity = el.citySelect.value === CUSTOM;
  el.customCommunityField.classList.toggle('hidden', !showCommunity);
  el.customCityField.classList.toggle('hidden', !showCity);
  el.customProfileWrap.classList.toggle('hidden', !showCommunity && !showCity);
}

function setSelectValue(select, input, value) {
  const preset = Array.from(select.options).find(
    (option) => option.value !== CUSTOM && option.value === value,
  );
  if (preset) {
    select.value = value;
    input.value = '';
  } else if (value) {
    select.value = CUSTOM;
    input.value = value;
  } else {
    select.selectedIndex = 0;
    input.value = '';
  }
}

function populateProfileForm(profile) {
  el.displayNameInput.value = profile.username || '';
  setSelectValue(el.communitySelect, el.customCommunityInput, profile.group_name || '');
  setSelectValue(el.citySelect, el.customCityInput, profile.city || '');
  syncCustomProfileFields();
}

function renderProfileStatus() {
  if (!state.profile) {
    el.profileStatus.textContent = 'No profile yet — set a display name to start.';
    return;
  }
  const where = [state.profile.group_name, state.profile.city].filter(Boolean).join(' · ');
  el.profileStatus.textContent = `${state.profile.username}${where ? ` — ${where}` : ''}`;
}

function renderPoints(points) {
  el.ecoPointsValue.textContent = String(Number(points) || 0);
}

function animatePointsPill() {
  el.ecoPointsPill.classList.remove('pop');
  void el.ecoPointsPill.offsetWidth;
  el.ecoPointsPill.classList.add('pop');
}

function saveProfile(user) {
  state.profile = user;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(user));
  localStorage.removeItem(LEGACY_PROFILE_KEY);
  populateProfileForm(user);
  renderProfileStatus();
}

function restoreProfile() {
  const raw = localStorage.getItem(PROFILE_KEY) || localStorage.getItem(LEGACY_PROFILE_KEY);
  if (!raw) {
    return false;
  }
  try {
    const user = JSON.parse(raw);
    if (!user || typeof user.username !== 'string') {
      throw new Error('invalid profile');
    }
    state.profile = user;
    populateProfileForm(user);
    renderPoints(user.eco_points);
    renderProfileStatus();
    localStorage.setItem(PROFILE_KEY, JSON.stringify(user));
    localStorage.removeItem(LEGACY_PROFILE_KEY);
    return true;
  } catch {
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(LEGACY_PROFILE_KEY);
    return false;
  }
}

function applyUserPayload(payload) {
  if (!payload || !payload.user) {
    return;
  }
  saveProfile(payload.user);
  renderPoints(payload.user.eco_points);
  renderBins(payload.bin_counts);
  renderBadges(payload.badges);
  renderChallenges(payload.challenges);

  if (state.demo) {
    state.demo.points = payload.user.eco_points;
    if (payload.bin_counts) {
      state.demo.bins = { ...state.demo.bins, ...payload.bin_counts };
    }
    if (Array.isArray(payload.badges)) {
      state.demo.badges = payload.badges;
    }
    if (Array.isArray(payload.challenges)) {
      state.demo.challenges = payload.challenges;
    }
    saveDemoState();
  }
}

async function applyProfile({ silent = false } = {}) {
  const username = el.displayNameInput.value.trim();
  if (!username) {
    toast('Enter a display name first.', true);
    el.displayNameInput.focus();
    return;
  }
  const groupName = resolveSelect(el.communitySelect, el.customCommunityInput)
    || el.communitySelect.options[0].value;
  const city = resolveSelect(el.citySelect, el.customCityInput)
    || el.citySelect.options[0].value;

  if (!state.apiAvailable) {
    applyLocalProfile({ username, group_name: groupName, city });
    if (!silent) {
      toast(`Profile saved in local demo mode: ${username}`);
    }
    return;
  }

  setBusy(el.applyProfileBtn, true);
  try {
    const payload = await postJson('/api/user', {
      username,
      group_name: groupName,
      city,
    });
    state.apiAvailable = true;
    applyUserPayload(payload);
    if (!silent) {
      toast(`Profile applied: ${payload.user.username}`);
    }
  } catch (error) {
    if (isApiUnavailable(error)) {
      markDemoMode();
      applyLocalProfile({ username, group_name: groupName, city });
      if (!silent) {
        toast(`Profile saved in local demo mode: ${username}`);
      }
    } else {
      toast(friendlyError(error), true);
    }
  } finally {
    setBusy(el.applyProfileBtn, false);
  }
}

async function hydrateProfile() {
  if (!state.profile) {
    return;
  }
  if (!state.apiAvailable) {
    applyLocalState();
    return;
  }
  try {
    const payload = await postJson('/api/user', {
      username: state.profile.username,
      group_name: state.profile.group_name,
      city: state.profile.city,
    });
    state.apiAvailable = true;
    applyUserPayload(payload);
  } catch (error) {
    if (isApiUnavailable(error)) {
      markDemoMode();
      applyLocalState();
    } else {
      toast(`Could not refresh your server profile. ${friendlyError(error)}`, true);
    }
  }
}

function resetLocalProfile() {
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(LEGACY_PROFILE_KEY);
  state.profile = null;
  state.result = null;
  state.disposeToken = null;

  el.displayNameInput.value = '';
  el.communitySelect.selectedIndex = 0;
  el.citySelect.selectedIndex = 0;
  el.customCommunityInput.value = '';
  el.customCityInput.value = '';
  syncCustomProfileFields();

  renderPoints(0);
  renderProfileStatus();
  clearResult();

  const zeroCounts = Object.fromEntries(Object.keys(DOMAIN.bins).map((category) => [category, 0]));
  renderBins(zeroCounts);

  document.querySelectorAll('[data-badge]').forEach((node) => {
    node.classList.remove('unlocked');
    const status = node.querySelector('.badge-status');
    if (status) {
      status.textContent = 'Locked';
    }
  });

  document.querySelectorAll('[data-day]').forEach((node) => {
    node.classList.remove('completed');
    const button = node.querySelector('[data-claim-day]');
    if (button) {
      button.disabled = false;
      button.classList.remove('is-busy');
      button.removeAttribute('aria-busy');
      button.textContent = `Claim +${DOMAIN.challengeReward}`;
    }
  });
  localStorage.removeItem(ACTIVITY_KEY);
  localStorage.removeItem(DEMO_STATE_KEY);
  state.activity = [];
  state.demo = defaultDemoState();
  saveDemoState();
  renderRecentActivity();
  setActiveBin(null);
  renderChallengeProgress();
  applyChallengeFilter();
  applyBadgeFilter();

  el.settingsPopover.classList.add('hidden');
  el.settingsToggleBtn.setAttribute('aria-expanded', 'false');
  toast('Local profile cleared. Data already logged stays on the server.');
}

/* ---------------- capabilities ---------------- */

async function loadCapabilities() {
  if (window.__ECOSORT_STATIC__) {
    markDemoMode();
    el.visionStatus.textContent = 'Local demo mode — offline sorting rules';
    el.limitsStatus.textContent = 'Static Cloudflare Pages build: no server API';
    return;
  }
  try {
    const payload = await callApi('/api/capabilities');
    state.capabilities = payload;
    state.apiAvailable = true;
    const vision = payload.ai_vision || {};
    if (vision.enabled) {
      el.visionStatus.innerHTML = `AI Vision: <strong>on</strong> · ${escapeHtml(
        vision.model || 'model',
      )} (${escapeHtml(vision.provider || 'google-genai')})`;
      if (el.visionStatusShort) el.visionStatusShort.textContent = 'on';
      if (el.networkLabel) el.networkLabel.textContent = 'AI Vision on';
    } else {
      el.visionStatus.innerHTML = 'AI Vision: <strong>off</strong> · deterministic offline rules';
      if (el.visionStatusShort) el.visionStatusShort.textContent = 'off';
      if (el.networkLabel) el.networkLabel.textContent = 'Local engine';
    }
    const limits = payload.rate_limits || {};
    el.limitsStatus.textContent = payload.rate_limit_enabled
      ? `Rate limits/min — scan ${limits.identify}, AI ${limits.ai_vision}, writes ${limits.general}`
      : 'Rate limiting is disabled on this server.';
  } catch (error) {
    if (isApiUnavailable(error)) {
      markDemoMode();
      el.visionStatus.textContent = 'Local demo mode — offline sorting rules';
      el.limitsStatus.textContent = 'Server API unavailable; using local rules';
    } else {
      el.visionStatus.textContent = 'Scan engine status unavailable.';
      el.limitsStatus.textContent = friendlyError(error);
    }
  }
}

/* ---------------- bins / badges / challenges ---------------- */

function renderBins(counts) {
  if (!counts) {
    return;
  }
  for (const [category, count] of Object.entries(counts)) {
    const counter = document.querySelector(`[data-bin-count="${category}"]`);
    if (!counter) {
      continue;
    }
    const previous = counter.textContent;
    counter.textContent = String(count);
    if (previous !== String(count)) {
      counter.classList.remove('bump');
      void counter.offsetWidth;
      counter.classList.add('bump');
    }
  }
}

function setActiveBin(category) {
  document.querySelectorAll('[data-bin-card]').forEach((card) => {
    card.classList.toggle('is-active', card.dataset.binCard === category);
  });
}

function categoryClassName(category) {
  return {
    'Wet Waste': 'cat-wet',
    'Recyclable Waste': 'cat-recyclable',
    'Dry Waste': 'cat-dry',
    'E-Waste': 'cat-ewaste',
    'Hazardous Waste': 'cat-hazardous',
  }[category] || 'cat-dry';
}

function loadActivity() {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    state.activity = Array.isArray(list) ? list.slice(0, 6) : [];
  } catch {
    state.activity = [];
  }
}

function saveActivity() {
  try {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(state.activity.slice(0, 6)));
  } catch {
    /* private browsing can reject storage; the session list still works */
  }
}

function renderRecentActivity() {
  if (!el.recentActivityList) {
    return;
  }
  if (!state.activity.length) {
    el.recentActivityList.innerHTML = '<p class="empty-state">No disposals yet.</p>';
    return;
  }
  el.recentActivityList.innerHTML = state.activity.map((entry) => `
    <div class="recent-item">
      <span class="recent-dot ${categoryClassName(entry.category)}" aria-hidden="true"></span>
      <div class="recent-body">
        <div class="recent-name">${escapeHtml(entry.name)}</div>
        <div class="recent-meta">${escapeHtml(entry.category.replace(' Waste', ''))} · +${Number(entry.points) || 0} pts</div>
      </div>
    </div>
  `).join('');
}

function addRecentActivity(entry) {
  state.activity.unshift({
    name: String(entry.name || 'Item').slice(0, 80),
    category: String(entry.category || 'Dry Waste'),
    points: Number(entry.points) || 0,
  });
  state.activity = state.activity.slice(0, 6);
  saveActivity();
  renderRecentActivity();
}

function animateBinReward(category, points) {
  const card = document.querySelector(`[data-bin-card="${category}"]`);
  if (!card) {
    return;
  }
  card.classList.remove('pop');
  void card.offsetWidth;
  card.classList.add('pop');

  card.querySelectorAll('.bin-float').forEach((node) => node.remove());
  const float = document.createElement('span');
  float.className = 'bin-float';
  float.setAttribute('aria-hidden', 'true');
  float.textContent = `+${points}`;
  card.appendChild(float);
  setTimeout(() => float.remove(), 1200);
}

function renderBadges(badges) {
  if (!Array.isArray(badges)) {
    return;
  }
  for (const badge of badges) {
    const node = document.querySelector(`[data-badge="${badge.id}"]`);
    if (!node) {
      continue;
    }
    node.classList.toggle('unlocked', Boolean(badge.unlocked));
    node.dataset.status = badge.unlocked ? 'unlocked' : 'locked';
    const status = node.querySelector('.badge-status');
    if (status) {
      status.textContent = badge.unlocked ? 'Unlocked' : 'Locked';
    }
  }
  applyBadgeFilter();
}

function applyBadgeFilter() {
  if (!el.badgeFilterSelect) {
    return;
  }
  const mode = el.badgeFilterSelect.value;
  document.querySelectorAll('[data-badge]').forEach((node) => {
    const status = node.classList.contains('unlocked') ? 'unlocked' : 'locked';
    node.classList.toggle('hidden', mode !== 'all' && mode !== status);
  });
}

function renderChallenges(challenges) {
  if (!Array.isArray(challenges)) {
    return;
  }
  for (const challenge of challenges) {
    const card = document.querySelector(`[data-day="${challenge.day_number}"]`);
    if (!card) {
      continue;
    }
    const done = Boolean(challenge.completed);
    card.classList.toggle('completed', done);
    const button = card.querySelector('[data-claim-day]');
    if (button) {
      button.disabled = done;
      button.classList.remove('is-busy');
      button.removeAttribute('aria-busy');
      button.textContent = done ? 'Claimed' : `Claim +${DOMAIN.challengeReward}`;
    }
  }
  renderChallengeProgress(challenges);
  applyChallengeFilter();
}

function renderChallengeProgress(challenges) {
  const list = Array.isArray(challenges)
    ? challenges
    : Array.from(document.querySelectorAll('.challenge-card')).map((card) => ({
        day_number: Number(card.dataset.day),
        completed: card.classList.contains('completed'),
      }));
  const total = list.length || 7;
  const done = list.filter((item) => item.completed).length;
  const percent = total ? Math.round((done / total) * 100) : 0;

  if (el.challengeProgressText) {
    el.challengeProgressText.textContent = `${done} of ${total} days`;
  }
  if (el.challengeProgressPercent) {
    el.challengeProgressPercent.textContent = `${percent}%`;
  }
  if (el.challengeProgressBar) {
    el.challengeProgressBar.style.width = `${percent}%`;
  }
  if (el.challengeRail) {
    el.challengeRail.querySelectorAll('[data-rail-day]').forEach((chip) => {
      const day = Number(chip.dataset.railDay);
      const item = list.find((entry) => Number(entry.day_number) === day);
      const doneDay = Boolean(item && item.completed);
      chip.classList.toggle('is-done', doneDay);
      const stateEl = chip.querySelector('[data-rail-state]');
      if (stateEl) {
        stateEl.textContent = doneDay ? 'Done' : 'Pending';
      }
    });
  }
}

function applyChallengeFilter() {
  const mode = el.challengeFilterSelect.value;
  let visible = 0;
  el.challengeList.querySelectorAll('[data-day]').forEach((card) => {
    const done = card.classList.contains('completed');
    const show = mode === 'all' || (mode === 'completed' ? done : !done);
    card.classList.toggle('hidden', !show);
    if (show) {
      visible += 1;
    }
  });

  let empty = document.getElementById('challengeEmpty');
  if (visible === 0 && !empty) {
    empty = document.createElement('div');
    empty.id = 'challengeEmpty';
    empty.className = 'empty-state';
    empty.textContent = 'No tasks match this filter right now.';
    el.challengeList.appendChild(empty);
  } else if (visible > 0 && empty) {
    empty.remove();
  }
}

/* ---------------- result card ---------------- */

function updatePrepCheckStatus() {
  if (!el.prepChecklist || !el.prepCheckStatus) {
    return;
  }
  const boxes = Array.from(el.prepChecklist.querySelectorAll('.prep-box'));
  const checked = boxes.filter((box) => box.checked).length;
  el.prepCheckStatus.textContent = `${checked} of ${boxes.length} steps`;
}

function renderPrepChecklist(steps) {
  if (!el.prepChecklist || !el.prepCheckStatus) {
    return;
  }
  const items = (steps || []).filter(Boolean).slice(0, 3);
  if (!items.length) {
    el.prepChecklist.innerHTML = '';
    el.prepCheckStatus.textContent = '0 of 0 steps';
    return;
  }
  el.prepChecklist.innerHTML = items.map((step) => `
    <label class="prep-item">
      <input class="prep-box" type="checkbox" />
      <span>${escapeHtml(step)}</span>
    </label>
  `).join('');
  el.prepChecklist.querySelectorAll('.prep-box').forEach((box) => {
    box.addEventListener('change', updatePrepCheckStatus);
  });
  updatePrepCheckStatus();
}

function renderSelectedBinTag(category) {
  const meta = DOMAIN.bins[category] || DOMAIN.bins['Dry Waste'];
  el.selectedBinTag.className = `bin-preview-tag ${categoryClassName(category)}`;
  el.selectedBinTag.innerHTML =
    '<span class="bin-dot" aria-hidden="true"></span>' +
    `<span>Target bin: ${escapeHtml(category)} (${escapeHtml(meta.bin_color)})</span>`;
}

function renderResult(result) {
  state.result = result;
  state.disposeToken = newClientToken();

  el.resultEmptyState.classList.add('hidden');
  el.resultActiveState.classList.remove('hidden');

  const itemName = result.item_name || result.display_name || 'Scanned item';
  el.resultItemName.textContent = itemName;
  el.resultRewardPill.textContent = `+${result.points}`;
  if (el.resultCategoryBadge) {
    el.resultCategoryBadge.className = `category-badge ${categoryClassName(result.category)}`;
    el.resultCategoryBadge.textContent = result.category;
  }
  if (el.resultBinBadge) {
    el.resultBinBadge.textContent = `${result.bin_color || 'Gray'} bin`;
  }

  const isAi = (result.analysis_mode || result.source) === 'ai_vision';
  el.resultModePill.textContent = isAi
    ? `AI Vision${result.ai_model ? ` · ${result.ai_model}` : ''}`
    : 'Offline Rules';
  el.resultModePill.className = `pill ${isAi ? 'pill-mode-ai' : 'pill-mode-offline'}`;

  if (typeof result.confidence === 'string' && result.confidence) {
    el.resultConfidencePill.textContent = `Confidence: ${result.confidence}`;
  } else if (typeof result.confidence === 'number') {
    el.resultConfidencePill.textContent = `Confidence: ${Math.round(result.confidence * 100)}%`;
  } else {
    el.resultConfidencePill.textContent = 'Confidence: n/a';
  }

  const steps = Array.isArray(result.preparation_steps) && result.preparation_steps.length
    ? result.preparation_steps
    : String(result.instructions || '')
        .split(/(?<=[.!?])\s+/)
        .map((step) => step.trim())
        .filter(Boolean);
  el.resultStepsList.innerHTML = (steps.length ? steps : ['No specific preparation steps were reported.'])
    .map((step) => `<li>${escapeHtml(step)}</li>`)
    .join('');
  renderPrepChecklist(steps);

  const note = result.local_note
    || 'Rules vary by municipality — check your local waste collection guidance.';
  el.resultLocalNote.innerHTML = `
    <svg class="icon" aria-hidden="true"><use href="#i-info"></use></svg>
    <div><strong>Regional note:</strong> <span>${escapeHtml(note)}</span></div>
  `;

  if (result.vision_error) {
    el.resultVisionNote.textContent = `AI vision unavailable — ${result.vision_error}. Showing offline rules.`;
    el.resultVisionNote.classList.remove('hidden');
  } else if (!isAi && result.vision_available === false) {
    el.resultVisionNote.textContent =
      'AI vision is not configured on this server, so the offline rule engine answered.';
    el.resultVisionNote.classList.remove('hidden');
  } else {
    el.resultVisionNote.classList.add('hidden');
  }

  if (Array.from(el.binOverrideSelect.options).some((option) => option.value === result.category)) {
    el.binOverrideSelect.value = result.category;
  }
  renderSelectedBinTag(el.binOverrideSelect.value);
  setActiveBin(result.category);

  setBusy(el.tossToBinBtn, false);
  if (speech.autoRead) {
    speakSortingGuide();
  }
}

function clearResult() {
  stopSpeech();
  state.result = null;
  state.disposeToken = null;
  setActiveBin(null);
  if (el.prepChecklist) el.prepChecklist.innerHTML = '';
  if (el.prepCheckStatus) el.prepCheckStatus.textContent = '0 of 0 steps';
  el.resultActiveState.classList.add('hidden');
  el.resultEmptyState.classList.remove('hidden');
  el.resultVisionNote.classList.add('hidden');
  setBusy(el.tossToBinBtn, false);
}

/* ---------------- camera ---------------- */

function clearScanPreview() {
  stopCamera(false);
  if (camera.previewUrl) {
    URL.revokeObjectURL(camera.previewUrl);
    camera.previewUrl = null;
  }
  el.imagePreview.src = '';
  el.imagePreview.classList.add('hidden');
  el.cameraPlaceholder.classList.remove('hidden');
  el.samplePresetSelect.value = '';
  clearResult();
}

function hideFallbackMessage() {
  el.cameraFallbackBox.classList.add('hidden');
}

function showFallbackMessage(message) {
  el.cameraFallbackMsg.textContent = message;
  el.cameraFallbackBox.classList.remove('hidden');
}

function stopStream() {
  if (camera.stream) {
    camera.stream.getTracks().forEach((track) => track.stop());
    camera.stream = null;
  }
  el.cameraVideo.srcObject = null;
}

function showPreview(url) {
  if (camera.previewUrl) {
    URL.revokeObjectURL(camera.previewUrl);
  }
  camera.previewUrl = url;
  el.imagePreview.src = url;
  el.imagePreview.classList.remove('hidden');
  el.cameraVideo.classList.add('hidden');
  el.cameraPlaceholder.classList.add('hidden');
}

async function refreshCameraDevices(activeDeviceId = null) {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
    return;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    camera.devices = devices.filter((device) => device.kind === 'videoinput');
    if (camera.devices.length > 1) {
      el.cameraDeviceSelect.innerHTML = camera.devices
        .map((device, index) =>
          `<option value="${escapeHtml(device.deviceId)}">${escapeHtml(
            device.label || `Camera ${index + 1}`,
          )}</option>`,
        )
        .join('');
      if (activeDeviceId) {
        el.cameraDeviceSelect.value = activeDeviceId;
      }
      el.cameraSwitchWrap.classList.remove('hidden');
    } else {
      el.cameraSwitchWrap.classList.add('hidden');
    }
  } catch {
    el.cameraSwitchWrap.classList.add('hidden');
  }
}

async function startCamera(deviceId = null) {
  hideFallbackMessage();
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    showFallbackMessage('Live camera is not supported in this browser or context (requires HTTPS or localhost).');
    return;
  }
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!window.isSecureContext && !localHost) {
    showFallbackMessage('Live camera needs HTTPS or localhost. Upload a photo instead.');
    return;
  }

  stopCamera(false);
  try {
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

    el.cameraVideo.srcObject = camera.stream;
    try {
      await el.cameraVideo.play();
    } catch {
      /* autoplay can be blocked; the stream is attached regardless */
    }
    camera.deviceId = deviceId
      || camera.stream.getVideoTracks()[0]?.getSettings?.().deviceId
      || null;

    el.cameraVideo.classList.remove('hidden');
    el.cameraPlaceholder.classList.add('hidden');
    el.imagePreview.classList.add('hidden');
    el.startCameraBtn.classList.add('hidden');
    el.capturePhotoBtn.classList.remove('hidden');
    el.stopCameraBtn.classList.remove('hidden');

    await refreshCameraDevices(camera.deviceId);
  } catch (error) {
    const messages = {
      NotAllowedError: 'Camera permission was denied. Upload a photo or pick a sample instead.',
      PermissionDeniedError: 'Camera permission was denied. Upload a photo or pick a sample instead.',
      NotFoundError: 'No camera was found. Upload a photo or pick a sample instead.',
      DevicesNotFoundError: 'No camera was found. Upload a photo or pick a sample instead.',
      NotReadableError: 'The camera is busy in another app. Close it, or upload a photo.',
      TrackStartError: 'The camera could not start. Upload a photo instead.',
      SecurityError: 'The browser blocked camera access. Upload a photo instead.',
    };
    showFallbackMessage(messages[error && error.name] || 'The camera could not start. Upload a photo instead.');
    stopCamera(false);
  }
}

function stopCamera(resetStage = true) {
  stopStream();
  el.cameraVideo.classList.add('hidden');
  el.startCameraBtn.classList.remove('hidden');
  el.capturePhotoBtn.classList.add('hidden');
  el.stopCameraBtn.classList.add('hidden');
  el.cameraSwitchWrap.classList.add('hidden');

  if (resetStage && el.imagePreview.classList.contains('hidden')) {
    el.cameraPlaceholder.classList.remove('hidden');
  }
}

async function capturePhoto() {
  if (!camera.stream || !el.cameraVideo.videoWidth) {
    return;
  }
  const canvas = el.captureCanvas;
  canvas.width = el.cameraVideo.videoWidth;
  canvas.height = el.cameraVideo.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    showFallbackMessage('This browser could not capture the frame.');
    return;
  }
  context.drawImage(el.cameraVideo, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) {
    showFallbackMessage('The capture produced no image. Try again.');
    return;
  }

  showPreview(URL.createObjectURL(blob));
  stopCamera(false);
  await identifyBlob(blob, `camera-capture-${Date.now()}.jpg`);
}

/* ---------------- identification ---------------- */

async function identifyRequest(buildForm, label) {
  if (state.busy) {
    return;
  }
  state.busy = true;
  stopSpeech();
  el.presetChips.forEach((chip) => {
    chip.disabled = true;
  });
  setBusy(el.samplePresetSelect, true);
  try {
    const form = buildForm();
    let result;
    if (state.apiAvailable) {
      try {
        result = await postForm('/api/identify', form);
      } catch (error) {
        if (!isApiUnavailable(error)) {
          throw error;
        }
        markDemoMode();
        result = localIdentify(form);
      }
    } else {
      result = localIdentify(form);
    }
    renderResult(result);
    const isAi = (result.analysis_mode || result.source) === 'ai_vision';
    const provenance = isAi ? 'AI vision' : 'offline rules';
    const itemName = result.item_name || result.display_name || label || 'Item';
    toast(`${itemName} → ${result.category} (+${result.points} pts, ${provenance})`);
  } catch (error) {
    toast(friendlyError(error), true);
  } finally {
    state.busy = false;
    el.presetChips.forEach((chip) => {
      chip.disabled = false;
    });
    setBusy(el.samplePresetSelect, false);
  }
}

function identifyPreset(keyword, label) {
  return identifyRequest(() => {
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

/* ---------------- disposal ---------------- */

async function dispose() {
  if (state.busy) {
    return;
  }
  if (!state.profile || (typeof state.profile.id !== 'number' && state.profile.id !== 'local')) {
    toast('Apply a profile first.', true);
    return;
  }
  if (!state.result) {
    toast('Scan an item first.', true);
    return;
  }

  const category = el.binOverrideSelect.value || state.result.category;
  const token = state.disposeToken || newClientToken();
  const itemName = state.result.item_name || state.result.display_name || 'Item';
  state.busy = true;
  setBusy(el.tossToBinBtn, true);
  try {
    let payload;
    if (state.apiAvailable) {
      try {
        payload = await postJson('/api/dispose', {
          user_id: state.profile.id,
          item_name: itemName,
          category_override: category,
          client_token: token,
        });
      } catch (error) {
        if (!isApiUnavailable(error)) {
          throw error;
        }
        markDemoMode();
        payload = localDispose(category, itemName, token);
      }
    } else {
      payload = localDispose(category, itemName, token);
    }
    state.disposeToken = null;
    state.profile.eco_points = payload.new_points;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
    renderPoints(payload.new_points);
    animatePointsPill();
    renderBins(payload.bin_counts);
    renderBadges(payload.badges);

    const logged = payload.logged || {};
    if (!payload.duplicate) {
      animateBinReward(logged.category || category, logged.points || 0);
      addRecentActivity({
        name: logged.item_name || 'Item',
        category: logged.category || category,
        points: logged.points || 0,
      });
    }
    toast(
      payload.duplicate
        ? 'Already logged — no double credit'
        : `Tossed ${logged.item_name || 'item'} into ${logged.category || category} · +${logged.points || 0} points`,
    );
    clearResult();
  } catch (error) {
    toast(friendlyError(error), true);
  } finally {
    state.busy = false;
    setBusy(el.tossToBinBtn, false);
  }
}

/* ---------------- challenges ---------------- */

async function claimDay(day, button) {
  if (state.busy) {
    return;
  }
  if (!state.profile || (typeof state.profile.id !== 'number' && state.profile.id !== 'local')) {
    toast('Apply a profile first.', true);
    return;
  }

  state.busy = true;
  setBusy(button, true);
  try {
    let payload;
    if (state.apiAvailable) {
      try {
        payload = await postJson('/api/challenge/complete', {
          user_id: state.profile.id,
          day_number: day,
        });
      } catch (error) {
        if (!isApiUnavailable(error)) {
          throw error;
        }
        markDemoMode();
        payload = localClaimDay(day);
      }
    } else {
      payload = localClaimDay(day);
    }
    state.profile.eco_points = payload.new_points;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
    renderPoints(payload.new_points);
    animatePointsPill();
    renderChallenges(payload.challenges);
    toast(
      payload.awarded
        ? `Day ${day} complete · +${payload.awarded_points} points`
        : `Day ${day} was already claimed.`,
    );
  } catch (error) {
    toast(friendlyError(error), true);
    setBusy(button, false);
  } finally {
    state.busy = false;
  }
}

/* ---------------- navigation & wiring ---------------- */

function switchTab(tabName) {
  const isScan = tabName === 'scan';
  el.tabBtnScan.setAttribute('aria-selected', String(isScan));
  el.tabBtnBadges.setAttribute('aria-selected', String(!isScan));
  if (el.mobileTabScan) {
    el.mobileTabScan.setAttribute('aria-selected', String(isScan));
    el.mobileTabScan.classList.toggle('is-active', isScan);
  }
  if (el.mobileTabBadges) {
    el.mobileTabBadges.setAttribute('aria-selected', String(!isScan));
    el.mobileTabBadges.classList.toggle('is-active', !isScan);
  }
  el.panelScan.classList.toggle('hidden', !isScan);
  el.panelBadges.classList.toggle('hidden', isScan);
  if (!isScan) {
    stopSpeech();
    applyChallengeFilter();
    applyBadgeFilter();
  }
}

function wireEvents() {
  el.tabBtnScan.addEventListener('click', () => switchTab('scan'));
  el.tabBtnBadges.addEventListener('click', () => switchTab('badges'));
  if (el.mobileTabScan) el.mobileTabScan.addEventListener('click', () => switchTab('scan'));
  if (el.mobileTabBadges) el.mobileTabBadges.addEventListener('click', () => switchTab('badges'));

  // settings popover
  el.settingsToggleBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = el.settingsPopover.classList.contains('hidden');
    el.settingsPopover.classList.toggle('hidden', !willOpen);
    el.settingsToggleBtn.setAttribute('aria-expanded', String(willOpen));
  });
  document.addEventListener('click', (event) => {
    if (!el.settingsPopover.contains(event.target) && event.target !== el.settingsToggleBtn) {
      el.settingsPopover.classList.add('hidden');
      el.settingsToggleBtn.setAttribute('aria-expanded', 'false');
    }
  });
  el.resetProfileBtn.addEventListener('click', resetLocalProfile);

  if (el.settingsLeaves) {
    el.settingsLeaves.addEventListener('change', () => {
      setLeavesEnabled(el.settingsLeaves.checked);
    });
  }
  if (el.settingsAutoRead) {
    el.settingsAutoRead.addEventListener('change', () => {
      speech.autoRead = el.settingsAutoRead.checked;
      updateSpeechControls();
      if (speech.autoRead) primeSpeech();
    });
  }

  // profile
  el.communitySelect.addEventListener('change', syncCustomProfileFields);
  el.citySelect.addEventListener('change', syncCustomProfileFields);
  el.profileForm.addEventListener('submit', (event) => {
    event.preventDefault();
    applyProfile();
  });

  // camera
  el.startCameraBtn.addEventListener('click', () => startCamera());
  el.capturePhotoBtn.addEventListener('click', capturePhoto);
  el.stopCameraBtn.addEventListener('click', () => stopCamera(true));
  if (el.clearScanBtn) el.clearScanBtn.addEventListener('click', clearScanPreview);
  el.cameraDeviceSelect.addEventListener('change', () => {
    if (el.cameraDeviceSelect.value) {
      startCamera(el.cameraDeviceSelect.value);
    }
  });
  el.photoUploadInput.addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }
    stopCamera(false);
    hideFallbackMessage();
    showPreview(URL.createObjectURL(file));
    identifyBlob(file, file.name || 'upload.jpg');
    event.target.value = '';
  });

  // samples
  el.samplePresetSelect.addEventListener('change', () => {
    const keyword = el.samplePresetSelect.value;
    if (!keyword) {
      return;
    }
    const label = el.samplePresetSelect.options[el.samplePresetSelect.selectedIndex].textContent.trim();
    identifyPreset(keyword, label);
  });
  el.presetChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const keyword = chip.dataset.preset;
      el.samplePresetSelect.value = keyword;
      identifyPreset(keyword, chip.textContent.trim());
    });
  });

  // result + sorting-guide speech
  el.binOverrideSelect.addEventListener('change', () => {
    renderSelectedBinTag(el.binOverrideSelect.value);
  });
  el.tossToBinBtn.addEventListener('click', dispose);

  el.readAloudBtn.addEventListener('click', () => {
    if (speech.speaking) {
      stopSpeech();
    } else {
      speakSortingGuide();
    }
  });

  el.autoReadBtn.addEventListener('change', () => {
    speech.autoRead = el.autoReadBtn.checked;
    updateSpeechControls();
    if (speech.autoRead) {
      primeSpeech();
    }
  });

  // challenges / badges
  el.challengeFilterSelect.addEventListener('change', applyChallengeFilter);
  if (el.badgeFilterSelect) {
    el.badgeFilterSelect.addEventListener('change', applyBadgeFilter);
  }
  el.challengeList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-claim-day]');
    if (!button) {
      return;
    }
    claimDay(Number(button.dataset.claimDay), button);
  });

  window.addEventListener('pagehide', () => {
    stopStream();
    stopSpeech();
  });
}

/* ---------------- ambient leaves ---------------- */

const leafState = {
  ctx: null,
  items: [],
  raf: null,
  width: 0,
  height: 0,
  colors: [
    'rgba(105, 136, 82, 0.28)',
    'rgba(135, 170, 108, 0.25)',
    'rgba(117, 130, 69, 0.22)',
    'rgba(70, 123, 88, 0.2)',
  ],
};

function resizeLeafCanvas() {
  if (!el.leafCanvas) {
    return;
  }
  leafState.width = window.innerWidth;
  leafState.height = window.innerHeight;
  el.leafCanvas.width = leafState.width;
  el.leafCanvas.height = leafState.height;
}

function createLeaf(randomY = false) {
  return {
    x: Math.random() * leafState.width,
    y: randomY ? Math.random() * leafState.height : -30,
    size: Math.random() * 9 + 8,
    speedY: Math.random() * 0.45 + 0.35,
    speedX: Math.sin(Math.random() * Math.PI) * 0.3 + 0.15,
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.015,
    sway: Math.random() * 100,
    color: leafState.colors[Math.floor(Math.random() * leafState.colors.length)],
  };
}

function drawLeaf(ctx, leaf) {
  ctx.save();
  ctx.translate(leaf.x, leaf.y);
  ctx.rotate(leaf.rotation);
  ctx.fillStyle = leaf.color;
  ctx.beginPath();
  ctx.moveTo(0, -leaf.size);
  ctx.bezierCurveTo(
    leaf.size * 0.7,
    -leaf.size * 0.4,
    leaf.size * 0.7,
    leaf.size * 0.4,
    0,
    leaf.size,
  );
  ctx.bezierCurveTo(
    -leaf.size * 0.7,
    leaf.size * 0.4,
    -leaf.size * 0.7,
    -leaf.size * 0.4,
    0,
    -leaf.size,
  );
  ctx.fill();
  ctx.restore();
}

function animateLeaves() {
  if (!leafState.ctx || !state.leavesEnabled) {
    leafState.raf = null;
    return;
  }
  leafState.ctx.clearRect(0, 0, leafState.width, leafState.height);
  leafState.items.forEach((leaf) => {
    leaf.y += leaf.speedY;
    leaf.sway += 0.02;
    leaf.x += Math.sin(leaf.sway) * 0.5 + leaf.speedX;
    leaf.rotation += leaf.rotSpeed;
    if (leaf.y > leafState.height + 40 || leaf.x > leafState.width + 40) {
      Object.assign(leaf, createLeaf(false));
    }
    drawLeaf(leafState.ctx, leaf);
  });
  leafState.raf = requestAnimationFrame(animateLeaves);
}

function startLeaves() {
  if (!leafState.ctx || leafState.raf) {
    return;
  }
  leafState.raf = requestAnimationFrame(animateLeaves);
}

function stopLeaves() {
  if (leafState.raf) {
    cancelAnimationFrame(leafState.raf);
    leafState.raf = null;
  }
  if (leafState.ctx) {
    leafState.ctx.clearRect(0, 0, leafState.width, leafState.height);
  }
}

function setLeavesEnabled(enabled) {
  state.leavesEnabled = Boolean(enabled);
  if (el.settingsLeaves) {
    el.settingsLeaves.checked = state.leavesEnabled;
  }
  if (state.leavesEnabled) {
    startLeaves();
  } else {
    stopLeaves();
  }
}

function initLeaves() {
  if (!el.leafCanvas) {
    return;
  }
  leafState.ctx = el.leafCanvas.getContext('2d');
  if (!leafState.ctx) {
    return;
  }
  resizeLeafCanvas();
  leafState.items = Array.from({ length: 16 }, () => createLeaf(true));
  window.addEventListener('resize', resizeLeafCanvas);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setLeavesEnabled(!reduced);
}

async function init() {
  wireEvents();
  initSpeech();
  initLeaves();
  state.demo = loadDemoState();
  loadActivity();
  renderRecentActivity();
  syncCustomProfileFields();
  renderProfileStatus();
  applyChallengeFilter();
  applyBadgeFilter();
  renderChallengeProgress();
  await loadCapabilities();
  if (restoreProfile()) {
    await hydrateProfile();
  }
}

init();
