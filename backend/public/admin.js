const $ = (s) => document.querySelector(s);
const money = (n) => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let token = sessionStorage.getItem('token');
const state = { offset: 0, q: '', role: '', status: '' };
const LIMIT = 25;

// Safe DOM builder: all text goes through textContent, never innerHTML.
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) el.append(kid instanceof Node ? kid : document.createTextNode(kid ?? ''));
  return el;
}

async function api(path, opts = {}) {
  const res = await fetch('/api/admin' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); throw new Error('Session expired'); }
  if (!res.ok) { alert(data.error || 'Request failed'); throw new Error(data.error); }
  return data;
}

function logout() { sessionStorage.removeItem('token'); token = null; $('#app').hidden = true; $('#login').hidden = false; }

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: $('#email').value, password: $('#password').value }) });
  const data = await res.json();
  if (!res.ok) { $('#loginError').textContent = data.error; return; }
  if (data.user.role !== 'admin') { $('#loginError').textContent = 'Admin access only'; return; }
  token = data.token; sessionStorage.setItem('token', token); start();
});
$('#logout').addEventListener('click', logout);

function pager(total, reload) {
  return h('div', { class: 'pager' },
    h('button', { disabled: state.offset === 0, onclick: () => { state.offset -= LIMIT; reload(); } }, 'Previous'),
    h('span', { class: 'muted' }, `${Math.min(state.offset + 1, total)}–${Math.min(state.offset + LIMIT, total)} of ${total}`),
    h('button', { disabled: state.offset + LIMIT >= total, onclick: () => { state.offset += LIMIT; reload(); } }, 'Next'));
}
const badge = (v) => h('span', { class: 'badge ' + v }, v);
const table = (heads, rows) => h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, heads.map((x) => h('th', {}, x)))), h('tbody', {}, rows)));
const date = (d) => new Date(d).toLocaleDateString();

const pages = {
  async dashboard() {
    const s = await api('/stats');
    const stat = (label, v) => h('div', { class: 'card stat' }, h('b', {}, v), h('span', {}, label));
    return h('div', { class: 'grid' },
      stat('Total users', s.users.users), stat('Billable members', s.users.billable || 0), stat('Blessings members', s.users.blessings || 0),
      stat('Suspended', s.users.suspended || 0), stat('New this week', s.users.new_week || 0), stat('Bills posted', s.bills.bills),
      stat('Pending review', s.bills.pending || 0), stat('Total bill value', money(s.bills.total_value)),
      stat('Blessings given', s.blessings.blessings), stat('Amount blessed', money(s.blessings.blessed_total)));
  },
  async users() {
    const load = () => show('users');
    const search = h('input', { placeholder: 'Search name or email', value: state.q });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { state.q = search.value; state.offset = 0; load(); } });
    const role = h('select', { onchange: (e) => { state.role = e.target.value; state.offset = 0; load(); } },
      ['', 'billable', 'blessings', 'admin'].map((r) => h('option', { value: r, selected: r === state.role }, r || 'All roles')));
    $('#toolbar').append(search, role, h('button', { class: 'primary', onclick: addUser }, 'Add user'));
    const qs = new URLSearchParams({ limit: LIMIT, offset: state.offset, q: state.q, role: state.role });
    const d = await api('/users?' + qs);
    const rows = d.users.map((u) => h('tr', {},
      h('td', {}, u.name), h('td', {}, u.email), h('td', {}, badge(u.role)),
      h('td', {}, u.annual_income == null ? '—' : money(u.annual_income)), h('td', {}, badge(u.status)), h('td', {}, date(u.created_at)),
      h('td', {}, h('div', { class: 'actions' },
        h('button', { onclick: async () => { await api('/users/' + u.id, { method: 'PATCH', body: { status: u.status === 'active' ? 'suspended' : 'active' } }); load(); } }, u.status === 'active' ? 'Suspend' : 'Activate'),
        h('button', { onclick: async () => { const r = prompt('New role (billable, blessings, admin)', u.role); if (r) { await api('/users/' + u.id, { method: 'PATCH', body: { role: r } }); load(); } } }, 'Role'),
        h('button', { onclick: async () => { const p = prompt('New password (8+ chars)'); if (p) { await api('/users/' + u.id, { method: 'PATCH', body: { password: p } }); alert('Password updated'); } } }, 'Reset PW'),
        h('button', { class: 'danger', onclick: async () => { if (confirm('Delete ' + u.email + ' and all their data?')) { await api('/users/' + u.id, { method: 'DELETE' }); load(); } } }, 'Delete')))));
    return h('div', {}, table(['Name', 'Email', 'Role', 'Yearly income', 'Status', 'Joined', ''], rows), pager(d.total, load));
  },
  async bills() {
    const load = () => show('bills');
    $('#toolbar').append(h('select', { onchange: (e) => { state.status = e.target.value; state.offset = 0; load(); } },
      ['', 'pending', 'approved', 'rejected', 'blessed'].map((s) => h('option', { value: s, selected: s === state.status }, s || 'All statuses'))));
    const d = await api('/bills?' + new URLSearchParams({ limit: LIMIT, offset: state.offset, status: state.status }));
    const setStatus = async (b, status) => { const note = status === 'rejected' ? prompt('Reason (optional)') || '' : ''; await api('/bills/' + b.id, { method: 'PATCH', body: { status, note } }); load(); };
    const rows = d.bills.map((b) => h('tr', {},
      h('td', {}, '#' + b.id), h('td', {}, b.merchant || '—'), h('td', {}, b.owner_email), h('td', {}, money(b.total)), h('td', {}, badge(b.status)), h('td', {}, date(b.created_at)),
      h('td', {}, h('div', { class: 'actions' },
        h('button', { onclick: () => viewBill(b) }, 'View'),
        h('button', { onclick: () => setStatus(b, 'approved') }, 'Approve'),
        h('button', { onclick: () => setStatus(b, 'rejected') }, 'Reject'),
        h('button', { class: 'danger', onclick: async () => { if (confirm('Delete bill #' + b.id + '?')) { await api('/bills/' + b.id, { method: 'DELETE' }); load(); } } }, 'Delete')))));
    return h('div', {}, table(['ID', 'Merchant', 'Owner', 'Total', 'Status', 'Posted', ''], rows), pager(d.total, load));
  },
  async blessings() {
    const d = await api('/blessings?limit=100');
    return table(['Bill', 'Blesser', 'Amount', 'Message', 'Date'], d.blessings.map((k) =>
      h('tr', {}, h('td', {}, '#' + k.bill_id), h('td', {}, k.blesser_email), h('td', {}, money(k.amount)), h('td', {}, k.message || ''), h('td', {}, date(k.created_at)))));
  },
  async settings() {
    const s = await api('/settings');
    const bool = (k, label) => h('label', {}, label, h('select', { id: k }, ['true', 'false'].map((v) => h('option', { value: v, selected: s[k] === v }, v === 'true' ? 'Enabled' : 'Disabled'))));
    const num = (k, label) => h('label', {}, label, h('input', { id: k, type: 'number', min: 0, value: s[k] }));
    return h('div', { class: 'card settings' },
      h('label', {}, 'Site name', h('input', { id: 'site_name', value: s.site_name })),
      bool('signups_enabled', 'New sign ups'), bool('uploads_enabled', 'Bill uploads'), bool('require_bill_approval', 'Require admin approval before bills are visible'),
      num('max_bill_total', 'Maximum bill total ($)'), num('min_blessing_income', 'Minimum yearly income for Blessings sign up ($)'),
      h('button', { class: 'primary', onclick: async () => {
        const body = {}; for (const k of Object.keys(s)) body[k] = $('#' + k).value;
        await api('/settings', { method: 'PUT', body }); alert('Settings saved');
      } }, 'Save settings'));
  },
};

async function viewBill(b) {
  const d = await api('/bills/' + b.id);
  const dlg = h('dialog', {}, h('h3', {}, 'Bill #' + b.id + ' — ' + (b.merchant || 'Unknown merchant')),
    h('img', { src: b.imageUrl, alt: 'Bill image' }),
    table(['Item', 'Qty', 'Price'], d.items.map((i) => h('tr', {}, h('td', {}, i.name), h('td', {}, i.quantity), h('td', {}, money(i.price))))),
    h('p', {}, h('b', {}, 'Total: ' + money(b.total))),
    h('p', { class: 'muted' }, d.blessings.length + ' blessing(s): ' + money(d.blessings.reduce((s, k) => s + Number(k.amount), 0))),
    h('button', { onclick: () => dlg.close() }, 'Close'));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}

async function addUser() {
  const email = prompt('Email'); if (!email) return;
  const name = prompt('Name'); const password = prompt('Password (8+ chars)'); const role = prompt('Role (billable, blessings, admin)', 'billable');
  await api('/users', { method: 'POST', body: { email, name, password, role } }); show('users');
}

async function show(page) {
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  $('#title').textContent = page[0].toUpperCase() + page.slice(1);
  $('#toolbar').replaceChildren();
  const view = await pages[page]();
  $('#content').replaceChildren(view);
}

window.addEventListener('hashchange', () => { state.offset = 0; state.q = ''; state.role = ''; state.status = ''; route(); });
function route() { const p = location.hash.slice(1); show(pages[p] ? p : 'dashboard').catch(() => {}); }
function start() { $('#login').hidden = true; $('#app').hidden = false; route(); }
if (token) start();
