// SanusBio v1.8.7 | 2026-07-14 | app-core.js
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
  if (USER.role === 'cleaner') document.querySelectorAll('.hide-cleaner').forEach(el => el.style.display = 'none');
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
    distribution: loadDistribution
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
  } catch (err) { console.error(err); }

  // Ferret lookup — all roles except cleaner
  if (USER?.role !== 'cleaner' && typeof initDashLookups === 'function') initDashLookups();

  // Estrus board — show to maternity, admin, research
  const estrusCard = document.getElementById('dashEstrusCard');
  if (estrusCard && roleIs('admin', 'research', 'maternity')) {
    estrusCard.style.display = '';
    try {
      const females = await api('/females/estrus');
      const tbody = document.getElementById('dashEstrusList');
      if (!females.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-muted text-center py-3">No females currently tracked</td></tr>';
      } else {
        const statusMeta = {
          estrus:   { label: 'In Estrus',  color: 'danger' },
          mated:    { label: 'Mated',       color: 'warning' },
          littered: { label: 'Littered',    color: 'success' },
          weaned:   { label: 'Weaned',      color: 'info' },
          baseline: { label: 'Baseline',    color: 'secondary' },
        };
        tbody.innerHTML = females.map(f => {
          const m = statusMeta[f.female_status] || statusMeta.baseline;
          const daysSince = f.status_since
            ? Math.floor((Date.now() - new Date(f.status_since)) / 864e5)
            : null;
          const urgency = f.female_status === 'estrus' && daysSince !== null && daysSince >= 8;
          return `<tr class="${urgency ? 'table-danger' : ''}" style="cursor:pointer" onclick="loadFerretDetail(${f.id}); nav('ferrets');">
            <td><strong>${f.name}</strong><br><span class="text-muted small">${f.animal_id || '—'}</span></td>
            <td><span class="badge bg-${m.color}">${m.label}</span></td>
            <td>${f.status_since ? fmtDate(f.status_since) : '—'}</td>
            <td>${daysSince !== null ? daysSince + 'd' : '—'}${urgency ? ' <i class="bi bi-exclamation-triangle-fill text-danger ms-1"></i>' : ''}</td>
            <td class="small text-muted">Room ${f.room_id || '?'} · ${f.cage_address || '?'}</td>
            <td class="small text-muted">${f.status_notes || '—'}</td>
          </tr>`;
        }).join('');
      }
    } catch (err) { console.error('Estrus board:', err); }
  } else if (estrusCard) {
    estrusCard.style.display = 'none';
  }
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