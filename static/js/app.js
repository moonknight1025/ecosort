/**
 * EcoSort frontend.
 *
 * Milestone 1 owns the shell behaviours only: tab navigation, profile
 * persistence in localStorage, and the toast/toast-and-pulse primitives that
 * later milestones reuse. Every control that still needs an API route says so
 * out loud instead of pretending to succeed.
 */

const DOMAIN = JSON.parse(document.getElementById('domain-config').textContent);
const PROFILE_KEY = 'ecosort.profile';

const state = {
  profile: null,
  bins: Object.fromEntries(Object.keys(DOMAIN.bins).map((category) => [category, 0])),
  result: null,
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
  }, 2400);
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

function setEcoScore(points) {
  el.ecoScore.textContent = String(points);
}

function saveProfile(profile) {
  state.profile = profile;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  el.username.value = profile.username;
  if (profile.campus) {
    el.campus.value = profile.campus;
  }
}

function restoreProfile() {
  const raw = localStorage.getItem(PROFILE_KEY);
  if (!raw) {
    return;
  }
  try {
    const profile = JSON.parse(raw);
    if (profile && typeof profile.username === 'string') {
      state.profile = profile;
      el.username.value = profile.username;
      if (profile.campus) {
        el.campus.value = profile.campus;
      }
      if (typeof profile.eco_points === 'number') {
        setEcoScore(profile.eco_points);
      }
    }
  } catch {
    localStorage.removeItem(PROFILE_KEY);
  }
}

function handleSetProfile() {
  const username = el.username.value.trim();
  const campus = el.campus.value;
  if (!username) {
    toast('Enter a name first.');
    el.username.focus();
    return;
  }
  saveProfile({ username, campus, eco_points: state.profile?.eco_points ?? 0 });
  toast(`${username} saved locally. Server sync lands in Milestone 2.`);
}

function wirePlaceholders() {
  // Controls whose backing routes arrive in milestones 2-4.
  const pending = [
    ...document.querySelectorAll('.preset, #image-input, #dispose-btn, .btn-claim'),
  ];
  for (const control of pending) {
    control.addEventListener('click', (event) => {
      event.preventDefault();
      toast('Scan, disposal and challenge routes land in the next milestones.');
    });
  }
}

function init() {
  el.tabs.forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });
  el.setProfile.addEventListener('click', handleSetProfile);
  el.username.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSetProfile();
    }
  });

  wirePlaceholders();
  restoreProfile();
  activateTab('scan');
}

init();
