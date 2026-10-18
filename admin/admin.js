// MotoPilot admin.
//
// The database is the authority, not this page. Every write is checked
// against the /admins allowlist by the security rules, so an account that is
// signed in but not an admin sees the dashboard and is refused by the server
// the moment it saves. The UI is a convenience; the rules are the control.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getDatabase, ref, get, set, remove, onValue,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';

const app = initializeApp({
  apiKey: 'AIzaSyAkrugW8GJRzNP-7Jdmh6cGzl1D4jRmRsY',
  authDomain: 'motopilot-6a758.firebaseapp.com',
  databaseURL: 'https://motopilot-6a758-default-rtdb.firebaseio.com',
  projectId: 'motopilot-6a758',
  appId: '1:378152504767:web:6034a351a6d9f038ee250a',
});

const auth = getAuth(app);
const db = getDatabase(app);
const $ = (id) => document.getElementById(id);

const SECTIONS = {
  cameras: ['Cameras', 'Every rider downloads these and gets warned about them.'],
  notifications: ['Notifications', 'A message riders see when they next open the app.'],
  content: ['App content', 'Settings the app reads at launch, changed without a release.'],
};

let map, markers = new Map(), cameras = {}, selected = null, started = false;

// ------------------------------------------------------------------ sign in

$('login-form').onsubmit = async (e) => {
  e.preventDefault();
  const err = $('login-error');
  err.hidden = true;
  $('login-btn').disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $('email').value, $('password').value);
  } catch (ex) {
    // Firebase's own wording leaks whether an account exists; this does not.
    err.textContent = ex.code === 'auth/operation-not-allowed'
      ? 'Email sign-in is not enabled on this project yet.'
      : 'Wrong email or password.';
    err.hidden = false;
  } finally {
    $('login-btn').disabled = false;
  }
};

$('signout').onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    $('login').hidden = false;
    $('shell').hidden = true;
    return;
  }

  // Asked of the database rather than assumed: /admins/{uid} is readable only
  // by that uid, so this both answers the question and proves the rule holds.
  let isAdmin = false;
  try {
    isAdmin = (await get(ref(db, `admins/${user.uid}`))).val() === true;
  } catch { isAdmin = false; }

  if (!isAdmin) {
    $('login-error').textContent =
      `Signed in, but this account is not an admin. Its id is ${user.uid}`;
    $('login-error').hidden = false;
    await signOut(auth);
    return;
  }

  $('who').textContent = user.email ?? '';
  $('login').hidden = true;
  $('shell').hidden = false;
  startCameras();
  watchNotification();
  watchConfig();
});

// ---------------------------------------------------------------- sections

document.querySelectorAll('.rail-btn[data-section]').forEach((btn) => {
  btn.onclick = () => show(btn.dataset.section);
});

function show(name) {
  document.querySelectorAll('.rail-btn[data-section]').forEach((b) =>
    b.classList.toggle('is-on', b.dataset.section === name));
  document.querySelectorAll('.panel-section').forEach((s) =>
    s.hidden = s.dataset.panel !== name);

  const [title, subtitle] = SECTIONS[name];
  $('title').textContent = title;
  $('subtitle').textContent = subtitle;

  const action = $('primary-action');
  action.hidden = name !== 'cameras';
  // Leaflet measures the container, and it was zero while hidden.
  if (name === 'cameras' && map) setTimeout(() => map.invalidateSize(), 60);
}

$('primary-action').onclick = () => {
  const c = map.getCenter();
  openEditor(null, c.lat, c.lng);
};

// ----------------------------------------------------------------- cameras

function startCameras() {
  if (started) return;
  started = true;

  map = L.map('map').setView([23.8103, 90.4125], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap', maxZoom: 19,
  }).addTo(map);

  map.on('click', (e) => openEditor(null, e.latlng.lat, e.latlng.lng));

  // Live, so two people editing see each other rather than overwriting.
  onValue(ref(db, 'cameras/verified'), (snap) => {
    cameras = snap.val() ?? {};
    redraw();
  });

  // Submissions are write-only for riders, but an admin may count them —
  // the rule allows an admin to read, so this is the one place they surface.
  onValue(ref(db, 'cameras/submissions'), (snap) => {
    const v = snap.val();
    $('s-pending').textContent = v ? Object.keys(v).length : 0;
  }, () => { $('s-pending').textContent = '—'; });
}

function redraw() {
  markers.forEach((m) => m.remove());
  markers.clear();

  const ids = Object.keys(cameras);
  $('count').textContent = `(${ids.length})`;
  $('s-published').textContent = ids.length;
  $('s-when').textContent = ids.length ? 'just now' : '—';

  const list = $('list');
  list.innerHTML = '';

  for (const id of ids) {
    const c = cameras[id];
    if (typeof c?.latitude !== 'number' || typeof c?.longitude !== 'number') continue;

    const marker = L.marker([c.latitude, c.longitude], { draggable: true })
      .addTo(map).bindTooltip(c.name || id);
    marker.on('click', () => openEditor(id, c.latitude, c.longitude));
    marker.on('dragend', (e) => {
      const p = e.target.getLatLng();
      openEditor(id, p.lat, p.lng);
    });
    markers.set(id, marker);

    const li = document.createElement('li');
    li.innerHTML = `<b>${esc(c.name || id)}</b><span>${esc(c.type ?? 'other')} · ` +
      `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}</span>`;
    li.onclick = () => {
      map.setView([c.latitude, c.longitude], 17);
      openEditor(id, c.latitude, c.longitude);
    };
    list.appendChild(li);
  }
}

function openEditor(id, lat, lng) {
  selected = id;
  const c = id ? cameras[id] ?? {} : {};
  $('f-name').value = c.name ?? '';
  $('f-type').value = c.type ?? 'speed';
  $('f-limit').value = c.speedLimitKmh ?? '';
  $('f-lat').value = lat.toFixed(6);
  $('f-lng').value = lng.toFixed(6);
  $('f-bidir').checked = c.isBidirectional !== false;
  $('delete').hidden = !id;
  $('editor').hidden = false;
}

$('cancel').onclick = () => { $('editor').hidden = true; selected = null; redraw(); };

$('save').onclick = async () => {
  const lat = parseFloat($('f-lat').value);
  const lng = parseFloat($('f-lng').value);
  if (!isFinite(lat) || !isFinite(lng)) return alert('Latitude and longitude are required.');
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return alert('Coordinates out of range.');

  // Derived and stable, so re-saving updates a camera rather than leaving a
  // duplicate beside it — the app matches rows on this id.
  const id = selected ?? `bd-${lat.toFixed(5)}-${lng.toFixed(5)}`.replace(/\./g, '_');
  const limit = parseInt($('f-limit').value, 10);

  const camera = {
    latitude: lat, longitude: lng,
    type: $('f-type').value,
    isBidirectional: $('f-bidir').checked,
    isActive: true,
  };
  if ($('f-name').value.trim()) camera.name = $('f-name').value.trim();
  if (Number.isFinite(limit)) camera.speedLimitKmh = limit;

  try {
    // A move changes the derived id, so the old one has to go or both stay
    // published a few metres apart.
    if (selected && selected !== id) await remove(ref(db, `cameras/verified/${selected}`));
    await set(ref(db, `cameras/verified/${id}`), camera);
    $('editor').hidden = true;
    selected = null;
  } catch (e) { alert(`Refused: ${e.message}`); }
};

$('delete').onclick = async () => {
  if (!selected || !confirm('Remove this camera? Riders stop being warned about it.')) return;
  try {
    await remove(ref(db, `cameras/verified/${selected}`));
    $('editor').hidden = true;
    selected = null;
  } catch (e) { alert(`Refused: ${e.message}`); }
};

$('export').onclick = () => {
  // The exact shape the app's importer reads, so a copy can be bundled as the
  // seed asset with nothing reinterpreting it in between.
  const payload = {
    version: Date.now(),
    cameras: Object.entries(cameras).map(([externalId, c]) => ({ externalId, ...c })),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)],
    { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'camera_locations.json'; a.click();
  URL.revokeObjectURL(url);
};

// ----------------------------------------------------------- notifications

function watchNotification() {
  onValue(ref(db, 'config/announcement'), (snap) => {
    const a = snap.val();
    $('n-current').innerHTML = a?.title
      ? `<b>${esc(a.title)}</b>${esc(a.body ?? '')}`
      : 'Nothing published.';
  });
}

$('n-publish').onclick = async () => {
  const title = $('n-title').value.trim();
  if (!title) return alert('A title is required.');
  const until = $('n-until').value
    ? new Date(`${$('n-until').value}T23:59:59Z`).getTime()
    : null;

  try {
    await set(ref(db, 'config/announcement'), {
      title,
      body: $('n-body').value.trim(),
      publishedAt: Date.now(),
      ...(until ? { until } : {}),
    });
    note('n-status', 'Published. Riders see it next time they open the app.');
  } catch (e) { note('n-status', `Refused: ${e.message}`); }
};

$('n-clear').onclick = async () => {
  try {
    await remove(ref(db, 'config/announcement'));
    note('n-status', 'Cleared.');
  } catch (e) { note('n-status', `Refused: ${e.message}`); }
};

// ----------------------------------------------------------------- content

function watchConfig() {
  onValue(ref(db, 'config'), (snap) => {
    const c = snap.val() ?? {};
    $('c-cur-min').textContent = c.minVersionCode ?? 0;
    if (document.activeElement !== $('c-min')) $('c-min').value = c.minVersionCode ?? 0;
    if (document.activeElement !== $('c-msg')) $('c-msg').value = c.updateMessage ?? '';
  });
}

$('c-save').onclick = async () => {
  const min = parseInt($('c-min').value, 10);
  if (!Number.isFinite(min) || min < 0) return alert('Minimum versionCode must be a number.');

  // Said out loud because getting it wrong locks every rider out of the app.
  if (!confirm(`Block every install below versionCode ${min}?`)) return;

  try {
    await set(ref(db, 'config/minVersionCode'), min);
    await set(ref(db, 'config/updateMessage'), $('c-msg').value.trim());
    note('c-status', 'Saved. Applies the next time each app launches.');
  } catch (e) { note('c-status', `Refused: ${e.message}`); }
};

// ------------------------------------------------------------------ bits

function note(id, text) {
  $(id).textContent = text;
  setTimeout(() => { $(id).textContent = ''; }, 6000);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
