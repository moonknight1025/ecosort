/**
 * EcoSort frontend.
 *
 * Milestone 2 owns: profile sync against /api/user, the scan flows against
 * /api/identify (dropzone + six presets), and rendering the classify result.
 * Disposal, badges-by-achievement and leaderboards arrive in M3/M4; the controls
 * that still need those routes say so instead of faking success.
 */

const DOMAIN = JSON.parse(document.getElementById('domain-config').textContent);
const PROFILE_KEY = 'ecosort.profile';

const state = {
  profile: null,
  result: null,
  busy: false,
};

const el = {
  tabs: Array.from(document.querySelectorAll('.tab')),
  panels: Array.from(document.querySelectorAll('.panel')),
  username: document.getElementById('username'),
  campus: document.getElementById('campus'),
  setProfile: document.getElementById('set-profile'),
  ecoScore: document.getElementById('eco-score'),
  toast: document.getElementById('toast'),
  bins: document.getElementById('bins'),
  dropzone: document.getElementById('dropzone'),
  imageInput: document.getElementById('image-input'),
  presets: Array.from(document.querySelectorAll('.preset')),
  resultCard: document.getElementById('result-card'),
  resultCategory: document.getElementById('result-category'),
  resultPoints: document.getElementById('result-points'),
  resultName: document.getElementById('result-name'),
  resultInstructions: document.getElementById('result-instructions'),
  disposeBtn: document.getElementById('dispose-btn'),
};

let toastTimer = null;

/** Show a transient bottom toast. */
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
  }, 2600);
}

/** Switch the visible panel and keep ARIA state in sync. */
function activateTab(name) {
  for (const tab of el.tabs) {
    const isActive = tab.dataset.tab === name;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  }
  for (const panel of el.panels) {
    const isActive = panel.id === `tab-${name}`;
    panel.classList.toggle('is-active', isActive);
    panel.hidden = !isActive;
  }
}

/* --- API helpers -------------------------------------------------------- */

async function callApi(path, options) {
  const response = await fetch(path, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error((payload && payload.error) || `Request failed (${response.status})`);
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

/* --- rendering ---------------------------------------------------------- */

function setEcoScore(points) {
  el.ecoScore.textContent = String(points);
}

function renderBins(counts) {
  if (!counts) {
    return;
  }
  for (const [category, count] of Object.entries(counts)) {
    pulseBin(category, count);
  }
}

/** Pulse a virtual bin and refresh its counter. */
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
  void bin.offsetWidth; // restart the animation
  bin.classList.add('is-pulsing');
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
    node.classList.toggle('is-unlocked', badge.unlocked);
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
    row.classList.toggle('is-done', challenge.completed);
    const button = row.querySelector('.btn-claim');
    if (button) {
      button.disabled = challenge.completed;
      button.textContent = challenge.completed ? 'Claimed' : `Claim +${DOMAIN.challengeReward}`;
    }
  }
}

/** Render the classify result and paint the card in its bin colour. */
function renderResult(result) {
  state.result = result;
  const meta = DOMAIN.bins[result.category];
  el.resultCard.hidden = false;
  if (meta) {
    el.resultCard.style.setProperty('--bin', meta.hex);
  }
  el.resultCategory.textContent = result.category;
  el.resultPoints.textContent = `+${result.points} pts`;
  el.resultName.textContent = result.display_name;
  el.resultInstructions.textContent = result.instructions;
}

function applyUserPayload(payload) {
  saveProfile(payload.user);
  setEcoScore(payload.user.eco_points);
  renderBins(payload.bin_counts);
  renderBadges(payload.badges);
  renderChallenges(payload.challenges);
  if (payload.challenges) {
    const done = payload.challenges.filter((row) => row.completed).length;
    if (done > 0) {
      toast(`${done} of 7 challenge days claimed.`);
    }
  }
}

function saveProfile(user) {
  state.profile = user;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(user));
  el.username.value = user.username;
  if (user.campus) {
    el.campus.value = user.campus;
  }
}

function restoreProfile() {
  const raw = localStorage.getItem(PROFILE_KEY);
  if (!raw) {
    return false;
  }
  try {
    const profile = JSON.parse(raw);
    if (!profile || typeof profile.username !== 'string') {
      throw new Error('invalid');
    }
    state.profile = profile;
    el.username.value = profile.username;
    if (profile.campus) {
      el.campus.value = profile.campus;
    }
    if (typeof profile.eco_points === 'number') {
      setEcoScore(profile.eco_points);
    }
    return true;
  } catch {
    localStorage.removeItem(PROFILE_KEY);
    return false;
  }
}

/* --- actions ------------------------------------------------------------ */

async function syncProfile({ announce } = { announce: true }) {
  const username = el.username.value.trim();
  const campus = el.campus.value;
  if (!username) {
    toast('Enter a name first.');
    el.username.focus();
    return;
  }

  el.setProfile.disabled = true;
  try {
    const payload = await postJson('/api/user', { username, campus });
    applyUserPayload(payload);
    if (announce) {
      toast(`Welcome ${payload.user.username} · ${payload.user.campus}`);
    }
  } catch (error) {
    toast(error.message);
  } finally {
    el.setProfile.disabled = false;
  }
}

async function identify(payloadBuilder, label) {
  if (state.busy) {
    return;
  }
  state.busy = true;
  setPresetsDisabled(true);
  try {
    const result = await postForm('/api/identify', payloadBuilder());
    renderResult(result);
    toast(
      result.fallback
        ? `${label}: no catalog match, sorted as ${result.category}.`
        : `${label}: ${result.category} · +${result.points} pts`,
    );
  } catch (error) {
    toast(error.message);
  } finally {
    state.busy = false;
    setPresetsDisabled(false);
  }
}

function setPresetsDisabled(disabled) {
  for (const preset of el.presets) {
    preset.disabled = disabled;
  }
}

function handlePreset(preset, keyword) {
  preset.disabled = true;
  identify(() => {
    const form = new FormData();
    form.append('preset_keyword', keyword);
    return form;
  }, preset.textContent.trim()).finally(() => {
    preset.disabled = false;
  });
}

function handleImageFile(file) {
  if (!file) {
    return;
  }
  identify(() => {
    const form = new FormData();
    form.append('image', file, file.name);
    return form;
  }, file.name || 'Upload');
}

function wireEvents() {
  el.tabs.forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });

  el.setProfile.addEventListener('click', () => syncProfile());
  el.username.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      syncProfile();
    }
  });

  el.presets.forEach((preset) => {
    preset.addEventListener('click', () => handlePreset(preset, preset.dataset.preset));
  });

  el.imageInput.addEventListener('change', () => {
    handleImageFile(el.imageInput.files[0]);
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
    handleImageFile(event.dataTransfer?.files?.[0]);
  });

  el.disposeBtn.addEventListener('click', () => {
    toast('Tossing into the virtual bin lands in Milestone 3.');
  });
}

function init() {
  wireEvents();
  activateTab('scan');
  if (restoreProfile()) {
    syncProfile({ announce: false });
  }
}

init();
