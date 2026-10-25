'use strict';

/*
 * TrackMyMeds front end.
 *
 * Two data sources share one interface (list / create / update / remove):
 *   - DemoStore: sample data kept in this browser (used on GitHub Pages)
 *   - ApiStore:  the Express server in server.js
 *
 * Source selection, in order:
 *   1. ?api=<url> in the page URL         -> server at that URL
 *   2. a choice saved from the ⚙ dialog   -> that source
 *   3. the page is served by server.js    -> same-origin server
 *   4. otherwise                          -> demo
 */

const REFILL_THRESHOLD = 1; // days left at or below this need a refill (same as server.js)
const LOW_THRESHOLD = 3; // shown in amber
const HALF_DAY_MS = 12 * 60 * 60 * 1000;
const SETTINGS_KEY = 'tmm.settings';
const DEMO_KEY = 'tmm.demo.v1';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- storage helpers

function readJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- demo store

function sampleUsers() {
  // Fictional customers for the demo only.
  return [
    {
      name: 'Asha Rao',
      phone: '9000000001',
      email: 'asha@example.com',
      address: '12 MG Road, Bengaluru',
      medicines: [
        { name: 'Metformin 500mg', daysLeft: 0.5 },
        { name: 'Atorvastatin 10mg', daysLeft: 12 },
      ],
    },
    {
      name: 'Ravi Kumar',
      phone: '9000000002',
      email: '',
      address: '4th Cross, Jayanagar',
      medicines: [
        { name: 'Amlodipine 5mg', daysLeft: 2.5 },
        { name: 'Vitamin D3', daysLeft: 1 },
      ],
    },
    {
      name: 'Fatima Begum',
      phone: '9000000003',
      email: 'fatima@example.com',
      address: 'Banjara Hills, Hyderabad',
      medicines: [{ name: 'Levothyroxine 50mcg', daysLeft: 20 }],
    },
    {
      name: 'John Mathew',
      phone: '9000000004',
      email: '',
      address: '',
      medicines: [],
    },
  ];
}

class DemoStore {
  constructor() {
    this.kind = 'demo';
    this.memory = null; // used when localStorage is unavailable
  }

  load() {
    let data = readJSON(DEMO_KEY) || this.memory;
    if (!data || !Array.isArray(data.users)) {
      data = { users: sampleUsers(), lastTick: Date.now() };
    }
    // Same rule as the server's background job: -0.5 day every 12 hours.
    const ticks = Math.floor((Date.now() - data.lastTick) / HALF_DAY_MS);
    if (ticks > 0) {
      for (const u of data.users) {
        for (const m of u.medicines || []) {
          if (typeof m.daysLeft === 'number') m.daysLeft = Math.max(0, m.daysLeft - 0.5 * ticks);
        }
      }
      data.lastTick += ticks * HALF_DAY_MS;
    }
    this.save(data);
    return data;
  }

  save(data) {
    this.memory = data;
    writeJSON(DEMO_KEY, data);
  }

  async list() {
    return JSON.parse(JSON.stringify(this.load().users));
  }

  async create(user) {
    const data = this.load();
    if (data.users.some((u) => u.phone === user.phone)) throw new Error('A customer with this phone number already exists.');
    data.users.push(user);
    this.save(data);
  }

  async update(originalPhone, user) {
    const data = this.load();
    const i = data.users.findIndex((u) => u.phone === originalPhone);
    if (i === -1) throw new Error('Customer not found.');
    if (user.phone !== originalPhone && data.users.some((u) => u.phone === user.phone)) {
      throw new Error('A customer with this phone number already exists.');
    }
    data.users[i] = user;
    this.save(data);
  }

  async remove(phone) {
    const data = this.load();
    const next = data.users.filter((u) => u.phone !== phone);
    if (next.length === data.users.length) throw new Error('Customer not found.');
    data.users = next;
    this.save(data);
  }

  reset() {
    this.save({ users: sampleUsers(), lastTick: Date.now() });
  }
}

// ---------------------------------------------------------------- API store

class ApiStore {
  constructor(base) {
    this.kind = 'api';
    // '' means "same origin as this page"
    this.base = base ? base.replace(/\/+$/, '') + '/' : new URL('./', location.href).href;
  }

  url(path) {
    return new URL(path, this.base).href;
  }

  async request(path, options = {}) {
    let res;
    try {
      res = await fetch(this.url(path), {
        ...options,
        headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      });
    } catch {
      throw new Error(`Could not reach the server at ${this.base}`);
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* empty or non-JSON body */
    }
    if (!res.ok) throw new Error((body && body.error) || `Server returned ${res.status}`);
    return body;
  }

  async list() {
    const data = await this.request('users');
    // Older server versions returned [{}] for an empty file.
    return Array.isArray(data) ? data.filter((u) => u && u.phone) : [];
  }

  create(user) {
    return this.request('users', { method: 'POST', body: JSON.stringify(user) });
  }

  update(originalPhone, user) {
    return this.request(`users/${encodeURIComponent(originalPhone)}`, { method: 'PUT', body: JSON.stringify(user) });
  }

  remove(phone) {
    return this.request(`users/${encodeURIComponent(phone)}`, { method: 'DELETE' });
  }
}

async function sameOriginServerAvailable() {
  if (!/^https?:$/.test(location.protocol)) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(new URL('api/health', location.href), { signal: ctrl.signal });
    if (!res.ok) return false;
    const body = await res.json();
    return body && body.app === 'trackmymeds';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function chooseStore() {
  const param = new URLSearchParams(location.search).get('api');
  if (param && /^https?:\/\//i.test(param)) {
    writeJSON(SETTINGS_KEY, { source: 'api', apiUrl: param });
    return new ApiStore(param);
  }
  const saved = readJSON(SETTINGS_KEY);
  if (saved && saved.source === 'demo') return new DemoStore();
  if (saved && saved.source === 'api' && saved.apiUrl) return new ApiStore(saved.apiUrl);
  if (await sameOriginServerAvailable()) return new ApiStore('');
  return new DemoStore();
}

// ---------------------------------------------------------------- state

const state = {
  store: null,
  users: [],
  query: '',
  editingPhone: null, // phone of the customer being edited (the key used by the API)
};

// ---------------------------------------------------------------- rendering helpers

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : String(c)); // strings become text nodes, so user data is never parsed as HTML
  }
  return node;
}

function formatDays(d) {
  if (typeof d !== 'number' || !Number.isFinite(d)) return '?';
  const v = Math.round(d * 10) / 10;
  return `${v} day${v === 1 ? '' : 's'}`;
}

function level(d) {
  if (typeof d !== 'number' || d <= REFILL_THRESHOLD) return 'urgent';
  if (d <= LOW_THRESHOLD) return 'low';
  return 'ok';
}

function setStatus(text, kind = 'info') {
  const s = $('statusMsg');
  s.hidden = !text;
  s.textContent = text || '';
  s.className = `status ${kind}`;
}

function renderMode() {
  const demo = state.store.kind === 'demo';
  const badge = $('modeBadge');
  badge.textContent = demo ? 'Demo data' : 'Server';
  badge.className = `badge ${demo ? 'demo' : 'live'}`;
  badge.title = demo ? 'Sample data stored in this browser' : `Connected to ${state.store.base}`;
  $('demoBanner').hidden = !demo;
}

function refillAlerts(users) {
  const out = [];
  for (const u of users) {
    const due = (u.medicines || []).filter((m) => level(m.daysLeft) === 'urgent');
    if (due.length) out.push({ user: u, due });
  }
  return out;
}

function renderAlerts() {
  const list = $('messagesList');
  const alerts = refillAlerts(state.users);
  if (!alerts.length) {
    list.replaceChildren(el('li', { class: 'empty' }, 'No medicine refill alerts.'));
  } else {
    list.replaceChildren(
      ...alerts.map(({ user, due }) =>
        el(
          'li',
          {},
          el('strong', {}, user.name),
          el('span', { class: 'muted' }, ` · ${user.phone}`),
          el('div', {}, 'Refill: ', due.map((m) => `${m.name} (${formatDays(m.daysLeft)} left)`).join(', '))
        )
      )
    );
  }
  $('statCustomers').textContent = state.users.length;
  $('statMeds').textContent = state.users.reduce((n, u) => n + (u.medicines || []).length, 0);
  $('statAlerts').textContent = alerts.length;
}

function renderUsers() {
  const container = $('userCards');
  const q = state.query.trim().toLowerCase();
  const shown = q
    ? state.users.filter((u) => (u.name || '').toLowerCase().includes(q) || (u.phone || '').includes(q))
    : state.users;

  if (!state.users.length) {
    container.replaceChildren(
      el('div', { class: 'empty-card' }, el('h3', {}, 'No customers yet'), el('p', {}, 'Use “Add customer” to create the first one.'))
    );
    return;
  }
  if (!shown.length) {
    container.replaceChildren(el('div', { class: 'empty-card' }, el('p', {}, `No customers match “${state.query}”.`)));
    return;
  }

  container.replaceChildren(
    ...shown.map((u) => {
      const meds = u.medicines || [];
      return el(
        'article',
        { class: 'user-card' },
        el(
          'div',
          { class: 'card-head' },
          el('div', {}, el('h3', {}, u.name), el('p', { class: 'muted' }, u.phone)),
          el(
            'div',
            { class: 'card-actions' },
            el('button', { type: 'button', class: 'btn small ghost', dataset: { action: 'edit', phone: u.phone } }, 'Edit'),
            el('button', { type: 'button', class: 'btn small danger', dataset: { action: 'delete', phone: u.phone } }, 'Delete')
          )
        ),
        el(
          'dl',
          { class: 'meta' },
          el('dt', {}, 'Email'),
          el('dd', {}, u.email || '—'),
          el('dt', {}, 'Address'),
          el('dd', {}, u.address || '—')
        ),
        meds.length
          ? el(
              'ul',
              { class: 'med-list' },
              meds.map((m) =>
                el('li', { class: `med ${level(m.daysLeft)}` }, el('span', {}, m.name), el('span', { class: 'chip' }, formatDays(m.daysLeft)))
              )
            )
          : el('p', { class: 'muted' }, 'No medicines listed')
      );
    })
  );
}

function render() {
  renderAlerts();
  renderUsers();
}

// ---------------------------------------------------------------- data actions

async function loadUsers() {
  setStatus('Loading…');
  try {
    state.users = await state.store.list();
    setStatus('');
  } catch (err) {
    state.users = [];
    setStatus(`${err.message}. Check the server, or switch to demo data with ⚙.`, 'error');
  }
  render(); // alerts are computed after the data has arrived
}

async function deleteUser(phone) {
  const user = state.users.find((u) => u.phone === phone);
  if (!user || !confirm(`Delete ${user.name} (${user.phone})?`)) return;
  try {
    await state.store.remove(phone);
    await loadUsers();
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

// ---------------------------------------------------------------- dialogs

function openDialog(d) {
  if (typeof d.showModal === 'function') d.showModal();
  else d.setAttribute('open', '');
}

function closeDialog(d) {
  if (typeof d.close === 'function') d.close();
  else d.removeAttribute('open');
}

function addMedRow(name = '', days = '') {
  const row = el(
    'div',
    { class: 'med-row' },
    el('input', { type: 'text', class: 'form-input med-name', placeholder: 'Medicine name', 'aria-label': 'Medicine name', maxlength: '80' }),
    el('input', {
      type: 'number',
      class: 'form-input med-days',
      placeholder: 'Days',
      'aria-label': 'Days of supply left',
      min: '0',
      max: '365',
      step: '0.5',
    }),
    el('button', { type: 'button', class: 'icon-btn remove-med', 'aria-label': 'Remove medicine', title: 'Remove' }, '×')
  );
  row.querySelector('.med-name').value = name;
  row.querySelector('.med-days').value = days;
  $('medRows').append(row);
  return row;
}

function openUserForm(user = null) {
  state.editingPhone = user ? user.phone : null;
  $('modalTitle').textContent = user ? 'Edit customer' : 'Add customer';
  $('name').value = user ? user.name : '';
  $('phone').value = user ? user.phone : '';
  $('email').value = user ? user.email || '' : '';
  $('address').value = user ? user.address || '' : '';
  $('medRows').replaceChildren();
  const meds = user ? user.medicines || [] : [];
  if (meds.length) meds.forEach((m) => addMedRow(m.name, m.daysLeft));
  else addMedRow();
  $('formError').textContent = '';
  openDialog($('userModal'));
  $('name').focus();
}

// Returns { user } or { error }
function readForm() {
  const name = $('name').value.trim().replace(/\s+/g, ' ');
  const phone = $('phone').value.trim();
  const email = $('email').value.trim();
  const address = $('address').value.trim();

  if (!name) return { error: 'Name is required.', field: 'name' };
  if (!/^[A-Za-z][A-Za-z .'-]*$/.test(name)) return { error: 'Name can contain letters, spaces, dots, apostrophes and hyphens.', field: 'name' };
  if (!/^\d{10}$/.test(phone)) return { error: 'Phone number must be exactly 10 digits.', field: 'phone' };
  if (phone !== state.editingPhone && state.users.some((u) => u.phone === phone)) {
    return { error: 'A customer with this phone number already exists.', field: 'phone' };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Email address looks invalid.', field: 'email' };

  const medicines = [];
  for (const row of $('medRows').querySelectorAll('.med-row')) {
    const mName = row.querySelector('.med-name').value.trim();
    const mDays = row.querySelector('.med-days').value.trim();
    if (!mName && !mDays) continue; // blank row
    const days = Number(mDays);
    if (!mName) return { error: 'Each medicine needs a name.' };
    if (mDays === '' || !Number.isFinite(days) || days < 0 || days > 365) {
      return { error: `Enter days left (0–365) for ${mName}.` };
    }
    medicines.push({ name: mName, daysLeft: days });
  }

  return { user: { name, phone, email, address, medicines } };
}

async function submitUser(event) {
  event.preventDefault();
  const { user, error, field } = readForm();
  if (error) {
    $('formError').textContent = error;
    if (field) $(field).focus();
    return;
  }
  $('saveBtn').disabled = true;
  try {
    if (state.editingPhone) await state.store.update(state.editingPhone, user);
    else await state.store.create(user);
    closeDialog($('userModal'));
    await loadUsers();
  } catch (err) {
    $('formError').textContent = err.message;
  } finally {
    $('saveBtn').disabled = false;
  }
}

function openSettings() {
  const saved = readJSON(SETTINGS_KEY) || {};
  const source = state.store.kind;
  for (const r of document.querySelectorAll('input[name="source"]')) r.checked = r.value === source;
  $('apiUrl').value = saved.apiUrl || (state.store.kind === 'api' ? state.store.base : '');
  $('settingsError').textContent = '';
  openDialog($('settingsModal'));
}

async function applySettings(event) {
  event.preventDefault();
  const source = (document.querySelector('input[name="source"]:checked') || {}).value || 'demo';
  const apiUrl = $('apiUrl').value.trim();
  if (source === 'api' && !/^https?:\/\/\S+$/i.test(apiUrl)) {
    $('settingsError').textContent = 'Enter the server URL, for example https://localhost:3000';
    return;
  }
  writeJSON(SETTINGS_KEY, { source, apiUrl });
  state.store = source === 'api' ? new ApiStore(apiUrl) : new DemoStore();
  closeDialog($('settingsModal'));
  renderMode();
  await loadUsers();
}

// ---------------------------------------------------------------- wiring

function wire() {
  $('searchInput').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderUsers();
  });
  $('addBtn').addEventListener('click', () => openUserForm());
  $('refreshBtn').addEventListener('click', loadUsers);
  $('userCards').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const phone = btn.dataset.phone;
    if (btn.dataset.action === 'edit') openUserForm(state.users.find((u) => u.phone === phone));
    if (btn.dataset.action === 'delete') deleteUser(phone);
  });

  $('userForm').addEventListener('submit', submitUser);
  $('cancelBtn').addEventListener('click', () => closeDialog($('userModal')));
  $('addMedBtn').addEventListener('click', () => addMedRow().querySelector('.med-name').focus());
  $('medRows').addEventListener('click', (e) => {
    if (e.target.closest('.remove-med')) e.target.closest('.med-row').remove();
  });

  $('settingsBtn').addEventListener('click', openSettings);
  $('settingsForm').addEventListener('submit', applySettings);
  $('settingsCancel').addEventListener('click', () => closeDialog($('settingsModal')));
  $('resetDemoBtn').addEventListener('click', async () => {
    if (state.store.kind !== 'demo' || !confirm('Replace the demo data with the original sample customers?')) return;
    state.store.reset();
    await loadUsers();
  });

  // Close a dialog when its backdrop is clicked
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (e) => {
      if (e.target === d) closeDialog(d);
    });
  }
}

async function init() {
  wire();
  state.store = await chooseStore();
  renderMode();
  await loadUsers();
}

init();
