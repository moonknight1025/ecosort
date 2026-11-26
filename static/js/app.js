/**
 * EcoSort frontend.
 *
 * Owns: profile sync (/api/user), scan flows (/api/identify), disposal
 * (/api/dispose), challenge claims (/api/challenge/complete) and the two
 * leaderboards (/api/leaderboard).
 *
 * Every server response is the source of truth for points, bin counts, badges
 * and challenges — the client never mutates those numbers locally, so a reload
 * can only ever show what SQLite actually holds.
 */

const DOMAIN = JSON.parse(document.getElementById('domain-config').textContent);
const PROFILE_KEY = 'ecosort.profile';
const DISPOSE_ENDPOINT = '/api/dispose';

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
  claims: Array.from(document.querySelectorAll('[data-claim-day]')),
  campusRank: document.getElementById('campus-rank'),
  userRank: document.getElementById('user-rank'),
};

const state = {
  /** Server user record: {id, username, campus, eco_points}. */
  profile: null,
  /** Current classification from /api/identify, or null. */
  result: null,
  busy: false,
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
  }, 2600);
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

function newClientToken() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `t-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  void bin.offsetWidth; // restart the animation
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function renderLeaderboards(payload) {
  const campuses = (payload && payload.campuses) || [];
  const users = (payload && payload.users) || [];

  el.campusRank.innerHTML = campuses.length
    ? campuses
        .map((row, index) =>
          rankRow(
            index + 1,
            row.campus,
            `${row.members} member${row.members === 1 ? '' : 's'}`,
            row.total_points,
          ),
        )
        .join('')
    : '<li class="rank-empty">No campus data yet.</li>';

  el.userRank.innerHTML = users.length
    ? users
        .map((row, index) => rankRow(index + 1, row.username, row.campus, row.eco_points))
        .join('')
    : '<li class="rank-empty">No disposals logged yet.</li>';
}

/* --- profile ------------------------------------------------------------ */

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
    const user = JSON.parse(raw);
    if (!user || typeof user.username !== 'string') {
      throw new Error('invalid');
    }
    state.profile = user;
    el.username.value = user.username;
    if (user.campus) {
      el.campus.value = user.campus;
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
  const campus = el.campus.value;
  if (!username) {
    toast('Enter a name first.');
    el.username.focus();
    return false;
  }

  el.setProfile.disabled = true;
  try {
    const payload = await postJson('/api/user', { username, campus });
    applyUserPayload(payload);
    if (announce) {
      toast(`Welcome ${payload.user.username} · ${payload.user.campus}`);
    }
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  } finally {
    el.setProfile.disabled = false;
  }
}

/* --- scan --------------------------------------------------------------- */

function setPresetsDisabled(disabled) {
  for (const preset of el.presets) {
    preset.disabled = disabled;
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

function handlePreset(keyword, label) {
  identify(() => {
    const form = new FormData();
    form.append('preset_keyword', keyword);
    return form;
  }, label);
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
    const payload = await postJson(DISPOSE_ENDPOINT, {
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
    el.campusRank.innerHTML = `<li class="rank-empty">${escapeHtml(error.message)}</li>`;
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

  // WAI-ARIA tabs pattern: arrow keys move between tabs, Home/End jump.
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

  el.presets.forEach((preset) => {
    preset.addEventListener('click', () =>
      handlePreset(preset.dataset.preset, preset.textContent.trim()),
    );
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

  el.disposeBtn.addEventListener('click', dispose);
  el.claims.forEach((button) => {
    button.addEventListener('click', () =>
      claimDay(Number(button.dataset.claimDay), button),
    );
  });
}

async function init() {
  wireEvents();
  activateTab('scan');
  if (restoreProfile()) {
    await syncProfile({ announce: false });
  }
  await refreshLeaderboards();
}

init();
