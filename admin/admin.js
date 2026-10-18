// Camera admin.
//
// The database is the authority, not this page. Every write here is checked
// against the /admins allowlist by the security rules, so a signed-in rider
// who opens this URL sees the tool and gets refused by the server the moment
// they try to save. The UI hiding itself is a courtesy, not the protection.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
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
const gate = $('gate'), denied = $('denied'), tool = $('tool');

let map, markers = new Map(), cameras = {}, selected = null, placing = null;

// ------------------------------------------------------------------ sign in

$('signin').onclick = () =>
  signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => alert(e.message));

$('signout').onclick = (e) => {
  e.preventDefault();
  signOut(auth);
};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    gate.hidden = false;
    denied.hidden = tool.hidden = true;
    $('signout').hidden = true;
    $('who').textContent = '';
    return;
  }

  $('who').textContent = user.email ?? '';
  $('signout').hidden = false;

  // Asking the database rather than trusting the page: /admins/{uid} is
  // readable only by that uid, so this both answers the question and proves
  // the rule works.
  let isAdmin = false;
  try {
    isAdmin = (await get(ref(db, `admins/${user.uid}`))).val() === true;
  } catch { isAdmin = false; }

  gate.hidden = true;
  denied.hidden = isAdmin;
  tool.hidden = !isAdmin;
  $('uid').textContent = user.uid;

  if (isAdmin) start();
});

// --------------------------------------------------------------------- map

function start() {
  if (map) return;

  // Dhaka, because that is where the riders are. Any marker moves it.
  map = L.map('map').setView([23.8103, 90.4125], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
  }).addTo(map);

  map.on('click', (e) => openEditor(null, e.latlng.lat, e.latlng.lng));

  // Live, so two people editing see each other's work rather than silently
  // overwriting it.
  onValue(ref(db, 'cameras/verified'), (snap) => {
    cameras = snap.val() ?? {};
    redraw();
  });
}

function redraw() {
  markers.forEach((m) => m.remove());
  markers.clear();

  const ids = Object.keys(cameras);
  $('count').textContent = `${ids.length} published`;

  const list = $('list');
  list.innerHTML = '';

  for (const id of ids) {
    const c = cameras[id];
    if (typeof c?.latitude !== 'number' || typeof c?.longitude !== 'number') continue;

    const marker = L.marker([c.latitude, c.longitude], { draggable: true })
      .addTo(map)
      .bindTooltip(c.name || id);

    marker.on('click', () => openEditor(id, c.latitude, c.longitude));
    marker.on('dragend', (e) => {
      const p = e.target.getLatLng();
      openEditor(id, p.lat, p.lng);
    });
    markers.set(id, marker);

    const li = document.createElement('li');
    li.innerHTML =
      `<b>${escapeHtml(c.name || id)}</b>` +
      `<span>${c.type ?? 'other'} · ${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}</span>`;
    li.onclick = () => {
      map.setView([c.latitude, c.longitude], 17);
      openEditor(id, c.latitude, c.longitude);
    };
    list.appendChild(li);
  }
}

// ------------------------------------------------------------------ editor

function openEditor(id, lat, lng) {
  selected = id;
  placing = { lat, lng };
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

$('cancel').onclick = () => {
  $('editor').hidden = true;
  selected = placing = null;
  redraw();
};

$('save').onclick = async () => {
  const lat = parseFloat($('f-lat').value);
  const lng = parseFloat($('f-lng').value);
  if (!isFinite(lat) || !isFinite(lng)) return say('Latitude and longitude are required.');
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return say('Those coordinates are out of range.');

  // Stable and derived, so re-saving the same camera updates it instead of
  // leaving a duplicate a few metres away — the app matches on this id.
  const id = selected ?? `bd-${lat.toFixed(5)}-${lng.toFixed(5)}`.replace(/\./g, '_');

  const limit = parseInt($('f-limit').value, 10);
  const camera = {
    latitude: lat,
    longitude: lng,
    type: $('f-type').value,
    isBidirectional: $('f-bidir').checked,
    isActive: true,
  };
  if ($('f-name').value.trim()) camera.name = $('f-name').value.trim();
  if (Number.isFinite(limit)) camera.speedLimitKmh = limit;

  try {
    // Moving an existing camera means removing the old id: it is derived from
    // the coordinates, so a move would otherwise leave the old one published.
    if (selected && selected !== id) await remove(ref(db, `cameras/verified/${selected}`));
    await set(ref(db, `cameras/verified/${id}`), camera);
    say('Saved. Riders get it on their next download.');
    $('editor').hidden = true;
    selected = null;
  } catch (e) {
    say(`Refused: ${e.message}`);
  }
};

$('delete').onclick = async () => {
  if (!selected) return;
  if (!confirm('Remove this camera? Riders stop being warned about it.')) return;
  try {
    await remove(ref(db, `cameras/verified/${selected}`));
    say('Removed.');
    $('editor').hidden = true;
    selected = null;
  } catch (e) {
    say(`Refused: ${e.message}`);
  }
};

// ------------------------------------------------------------------ export

$('export').onclick = () => {
  // The same shape the app's importer reads, so a copy can be bundled as the
  // seed asset without anything in between reinterpreting it.
  const payload = {
    version: Date.now(),
    cameras: Object.entries(cameras).map(([externalId, c]) => ({ externalId, ...c })),
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'camera_locations.json';
  a.click();
  URL.revokeObjectURL(url);
};

function say(message) {
  $('status').textContent = message;
  setTimeout(() => { $('status').textContent = ''; }, 6000);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
