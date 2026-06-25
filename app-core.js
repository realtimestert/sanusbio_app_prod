// SanusBio v1.6.0 | 2026-06-25 | app-core.js
// State, API, Auth, Init, Navigation, Dashboard, Helpers

// ─── State ────────────────────────────────────────────────────────────────────
let TOKEN = localStorage.getItem('sb_token');
let USER = JSON.parse(localStorage.getItem('sb_user') || 'null');
let _editUserId = null, _editSupplierId = null, _currentFerretId = null;
let _ferretData = [], _searchTimer;

// ─── API Helper ───────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function apiUpload(path, formData) {
  const res = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + TOKEN },
    body: formData
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function roleIs(...r) { return r.includes(USER?.role); }
function canWrite() { return roleIs('admin', 'research', 'maternity', 'caretaker'); }
function canUpdate() { return roleIs('admin', 'research', 'maternity'); }
function canDelete() { return roleIs('admin', 'research'); }

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function doLogin() {
  const username = document.getElementById('iUser').value.trim();
  const password = document.getElementById('iPass').value;
  const errEl = document.getElementById('loginErr');
  errEl.classList.add('d-none');
  try {
    const data = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then(r => r.json().then(d => { if (!r.ok) throw new Error(d.error); return d; }));
    TOKEN = data.token; USER = data.user;
    localStorage.setItem('sb_token', TOKEN);
    localStorage.setItem('sb_user', JSON.stringify(USER));
    initApp();
  } catch (err) { errEl.textContent = err.message; errEl.classList.remove('d-none'); }
}

function doLogout() { localStorage.removeItem('sb_token'); localStorage.removeItem('sb_user'); location.reload(); }

// ─── Init ─────────────────────────────────────────────────────────────────────
function initApp() {
  if (!TOKEN || !USER) {
    document.getElementById('loginWrap').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    return;
  }

  document.getElementById('loginWrap').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('userInfo').innerHTML =
    `<div class="text-white fw-semibold small">${USER.full_name || USER.username}</div>
 <span class="badge role-${USER.role} role-badge">${USER.role}</span>`;
  if (USER.role !== 'admin') document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
  if (!['admin', 'research'].includes(USER.role)) document.querySelectorAll('.admin-research-only').forEach(el => el.style.display = 'none');
  document.getElementById('navLinks').querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => { e.preventDefault(); nav(link.dataset.page); });
  });
  nav(USER.role === 'cleaner' ? 'cleaning-reports' : 'dashboard');
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function nav(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('show'));
  document.querySelectorAll('#navLinks .nav-link').forEach(l => l.classList.remove('active'));
  const p = document.getElementById('page-' + page);
  if (p) p.classList.add('show');
  const link = document.querySelector(`#navLinks [data-page="${page}"]`);
  if (link) link.classList.add('active');
  const loaders = {
    dashboard: loadDashboard, ferrets: loadFerrets, litters: loadLitters,
    locations: loadLocations, suppliers: loadSuppliers, assignments: loadAssignments,
    users: loadUsers, activity: loadActivity, 'cleaning-reports': loadCleaningReports,
    distribution: loadDistribution, 'rfid-lookup': loadRfidLookupPage
  };
  if (loaders[page]) loaders[page]();
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const d = await api('/dashboard');
    document.getElementById('statCards').innerHTML = [
      { label: 'Active Ferrets', val: d.total, icon: 'bi-emoji-smile', color: 'primary' },
      { label: 'Overdue Tasks', val: d.overdue, icon: 'bi-exclamation-circle', color: 'danger' },
      { label: 'Vaccines Due 30d', val: d.vacc_due, icon: 'bi-syringe', color: 'warning' },
      { label: 'Litters This Month', val: d.litters_this_month, icon: 'bi-egg', color: 'success' }
    ].map(s => `
  <div class="col-md-3 col-6">
    <div class="card stat-card p-3 d-flex flex-row align-items-center gap-3">
      <div class="icon bg-${s.color} bg-opacity-10 text-${s.color}"><i class="bi ${s.icon}"></i></div>
      <div><div class="fs-3 fw-bold">${s.val}</div><div class="text-muted small">${s.label}</div></div>
    </div>
  </div>`).join('');
    const activityCard = document.getElementById('dashActivityCard');
    if (roleIs('admin')) {
      activityCard.style.display = '';
      document.getElementById('dashActivity').innerHTML = d.recent_activity.map(a => `
    <tr>
      <td class="text-muted small">${fmtDT(a.created_at)}</td>
      <td><strong>${a.username}</strong></td>
      <td><span class="badge bg-secondary action-type">${a.action}</span></td>
      <td class="small">${a.details || ''}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="text-muted text-center py-3">No activity yet</td></tr>';
    } else { activityCard.style.display = 'none'; }
  } catch (err) { console.error(err); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function today() { return new Date().toISOString().split('T')[0]; }
function nowTime() { return new Date().toTimeString().slice(0, 5); }
function fmtDate(d) {
  if (!d) return '—';
  const s = d.toString().split('T')[0];
  const [y, m, dy] = s.split('-');
  return `${m}-${dy}-${y}`;
}
function fmtTime(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  let h = d.getHours(), min = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min.toString().padStart(2, '0')} ${ampm}`;
}
function fmtDT(dt) { if (!dt) return '—'; return `${fmtDate(dt)} ${fmtTime(dt)}`; }

// ─── DOMContentLoaded bootstrap ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('ferretSearch')?.addEventListener('input', e => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => loadFerrets(e.target.value), 300);
  });
  document.getElementById('iPass')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  // Drag & drop for ferret photo zone
  const zone = document.getElementById('ferretPhotoZone');
  if (zone) {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) { document.getElementById('fPhotoFile').files = e.dataTransfer.files; previewPhoto(document.getElementById('fPhotoFile'), 'fPhotoPreview'); }
    });
  }
  initApp();
});
