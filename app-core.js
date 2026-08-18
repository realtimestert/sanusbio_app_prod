// SanusBio v1.11.3 | 2026-08-18 | app-core.js
// v1.11.3: Dashboard boards collapsible (repro, care, vacc); Vaccinations Due
//          board; count badges on board headers; collapse state in localStorage
// v1.10.5: Assignments tab removed from navigation (feature unused); the
//          nav() loader map no longer routes to loadAssignments
// v1.10.6: (1) Weight & Grooming Alerts table is now sortable by Name,
//          Location, or Urgency (default); (2) dashboard "Overdue Tasks"
//          stat card removed — it was powered by the unused Assignments
//          feature and always read 0; (3) wired in the new Reports page
//          (loadReports, in app-reports.js) via the nav() loader map
// State, API, Auth, Init, Navigation, Dashboard, Helpers
// v1.9.4: added weeksSince() helper for light-schedule duration display
// v1.10.0: estrus board shows expected litter range for mated females;
//          dashboard surfaces females who died while active on the board
// v1.10.1: fixed stacked Bootstrap modal z-index (nested modals were covered)
// v1.10.2: FIX — Care Alerts functions (loadDashCareAlerts, setDashCareFilter,
//          openCareScheduleModal, etc.) were accidentally nested inside
//          loadDashboard(), so they were never callable from onclick=
//          handlers and loadDashCareAlerts() was never invoked, leaving the
//          Weight & Grooming Alerts card permanently hidden. Moved to
//          top-level scope and wired the call into loadDashboard().
// v1.10.4: FIX — Reproductive Status Board and Weight & Grooming Alerts row
//          clicks called loadFerretDetail(id) immediately followed by
//          nav('ferrets'), which re-ran the ferrets grid loader and switched
//          the page back to the grid, undoing the detail view that had just
//          been opened. Removed the nav('ferrets') call from both row
//          onclick handlers so clicking a row goes straight to that
//          ferret's detail page.

// ─── State ────────────────────────────────────────────────────────────────────
let TOKEN = localStorage.getItem('sb_token');
let USER = JSON.parse(localStorage.getItem('sb_user') || 'null');
let _editUserId = null, _editSupplierId = null, _currentFerretId = null;
let _ferretData = [], _searchTimer;

let _dashReproData = [], _dashReproFilter = null;
const DASH_REPRO_STATUS_META = {
  estrus:    { label: 'In Estrus',  color: 'danger' },
  mated:     { label: 'Mated',      color: 'warning' },
  littered:  { label: 'Littered',   color: 'success' },
  weaned:    { label: 'Weaned',     color: 'info' },
  no_litter: { label: 'No Litter',  color: 'secondary' },
};

let _dashCareData = [], _dashCareFilter = null, _dashCareSettings = null, _dashCareSort = 'urgency';
let _dashVaccData = [];

/** Toggle dashboard board collapse and remember preference. */
function toggleDashCollapse(bodyId, headerEl) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  // Bootstrap handles the collapse via data-bs-toggle; we just sync icon + storage after animation
  setTimeout(() => {
    const open = body.classList.contains('show');
    const icon = headerEl?.querySelector?.('.dash-collapse-icon')
      || headerEl?.closest?.('.card-header')?.querySelector?.('.dash-collapse-icon');
    if (icon) {
      icon.classList.toggle('bi-chevron-up', open);
      icon.classList.toggle('bi-chevron-down', !open);
    }
    try { localStorage.setItem('sb_collapse_' + bodyId, open ? '1' : '0'); } catch (_) {}
  }, 350);
}

function applySavedCollapse(bodyId) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  let saved = null;
  try { saved = localStorage.getItem('sb_collapse_' + bodyId); } catch (_) {}
  if (saved === null) return;
  const open = saved === '1';
  body.classList.toggle('show', open);
  const card = body.closest('.card');
  const icon = card?.querySelector?.('.dash-collapse-icon');
  if (icon) {
    icon.classList.toggle('bi-chevron-up', open);
    icon.classList.toggle('bi-chevron-down', !open);
  }
  const header = card?.querySelector?.('[data-bs-toggle="collapse"]');
  if (header) header.setAttribute('aria-expanded', open ? 'true' : 'false');
}

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
    locations: loadLocations, suppliers: loadSuppliers,
    users: loadUsers, activity: loadActivity, 'cleaning-reports': loadCleaningReports,
    distribution: loadDistribution, reports: loadReports
  };
  if (loaders[page]) loaders[page]();
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const d = await api('/dashboard');
    document.getElementById('statCards').innerHTML = [
      { label: 'Active Ferrets', val: d.total, icon: 'bi-emoji-smile', color: 'primary' },
      { label: 'Vaccines Due 30d', val: d.vacc_due, icon: 'bi-syringe', color: 'warning' },
      { label: 'Litters This Month', val: d.litters_this_month, icon: 'bi-egg', color: 'success' }
    ].map(s => `
  <div class="col-md-4 col-6">
    <div class="card stat-card p-3 d-flex flex-row align-items-center gap-3">
      <div class="icon bg-${s.color} bg-opacity-10 text-${s.color}"><i class="bi ${s.icon}"></i></div>
      <div><div class="fs-3 fw-bold">${s.val}</div><div class="text-muted small">${s.label}</div></div>
    </div>
  </div>`).join('');
  } catch (err) { console.error(err); }

  // Ferret lookup — all roles except cleaner
  if (USER?.role !== 'cleaner' && typeof initDashLookups === 'function') initDashLookups();

  // Estrus / Reproductive board — show to maternity, admin, research
  const estrusCard = document.getElementById('dashEstrusCard');
  if (estrusCard && roleIs('admin', 'research', 'maternity')) {
    estrusCard.style.display = '';
    try {
      _dashReproData = await api('/females/estrus');
      const cnt = document.getElementById('dashEstrusCount');
      if (cnt) cnt.textContent = _dashReproData.length;
      renderDashReproFilterBtns();
      renderDashReproTable();
      applySavedCollapse('dashEstrusBody');
    } catch (err) { console.error('Estrus board:', err); }
  } else if (estrusCard) {
    estrusCard.style.display = 'none';
  }

  // Weight & Grooming Care Alerts
  await loadDashCareAlerts();

  // Vaccinations Due board
  await loadDashVaccAlerts();

  // Females who died while active on the board
  const diedCard = document.getElementById('dashDiedOnBoardCard');
  if (diedCard && roleIs('admin', 'research', 'maternity')) {
    try {
      const died = await api('/females/died-on-board');
      if (died.length) {
        diedCard.style.display = '';
        const STATUS_LABEL = { estrus: 'In Estrus', mated: 'Mated', littered: 'Littered', weaned: 'Weaned' };
        document.getElementById('dashDiedOnBoardList').innerHTML = died.map(f => `
          <tr style="cursor:pointer" onclick="loadFerretDetail(${f.id})">
            <td><strong>${f.name}</strong><br><span class="text-muted small">${f.animal_id || '—'}</span></td>
            <td><span class="badge bg-danger">${STATUS_LABEL[f.death_female_status] || f.death_female_status}</span></td>
            <td>${fmtDate(f.death_date)}</td>
            <td class="small text-muted">Room ${f.room_id || '?'} · ${f.cage_address || '?'}</td>
          </tr>`).join('');
      } else {
        diedCard.style.display = 'none';
      }
    } catch (err) { console.error('Died-on-board:', err); }
  } else if (diedCard) {
    diedCard.style.display = 'none';
  }
}

function renderDashReproFilterBtns() {
  const wrap = document.getElementById('dashReproFilterBtns');
  if (!wrap) return;
  const counts = {};
  _dashReproData.forEach(f => { counts[f.status] = (counts[f.status] || 0) + 1; });
  const cats = ['estrus', 'mated', 'littered'];
  wrap.innerHTML = `
    <button class="btn btn-sm ${_dashReproFilter === null ? 'btn-primary' : 'btn-outline-secondary'}"
      onclick="setDashReproFilter(null)">
      All <span class="badge bg-light text-dark ms-1">${_dashReproData.length}</span>
    </button>
    ${cats.map(c => {
      const m = DASH_REPRO_STATUS_META[c];
      const active = _dashReproFilter === c;
      return `<button class="btn btn-sm ${active ? 'btn-' + m.color : 'btn-outline-secondary'}"
        onclick="setDashReproFilter('${c}')">
        ${m.label} <span class="badge bg-light text-dark ms-1">${counts[c] || 0}</span>
      </button>`;
    }).join('')}`;
}

function setDashReproFilter(cat) {
  _dashReproFilter = cat;
  renderDashReproFilterBtns();
  renderDashReproTable();
}

function renderDashReproTable() {
  const tbody = document.getElementById('dashEstrusList');
  if (!tbody) return;
  const filtered = _dashReproFilter ? _dashReproData.filter(f => f.status === _dashReproFilter) : _dashReproData;
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted text-center py-3">No females in this category</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(f => {
    const m = DASH_REPRO_STATUS_META[f.status] || DASH_REPRO_STATUS_META.estrus;
    const daysSince = f.status_since ? Math.floor((Date.now() - new Date(f.status_since)) / 864e5) : null;
    const urgency = f.status === 'estrus' && daysSince !== null && daysSince >= 8;
    let litterLabel = '—';
    if (f.status === 'mated') {
      const start = f.expected_litter_start, end = f.expected_litter_end;
      if (start && end) litterLabel = (fmtDate(start) === fmtDate(end)) ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
      else if (start) litterLabel = fmtDate(start) + ' (est.)';
    }
    // Mated with no litter: allow return to baseline without opening the full ferret page
    const noLitterBtn = (f.status === 'mated' && typeof canUpdate === 'function' && canUpdate())
      ? `<button class="btn btn-sm btn-outline-secondary py-0 px-1" title="No litter — return to baseline"
           onclick="event.stopPropagation(); returnToBaseline(${f.id}, '${(f.name || '').replace(/'/g, "\\'")}')">
           <i class="bi bi-arrow-counterclockwise"></i></button>`
      : '';
    return `<tr class="${urgency ? 'table-danger' : ''}" style="cursor:pointer" onclick="loadFerretDetail(${f.id});">
      <td><strong>${f.name}</strong><br><span class="text-muted small">${f.animal_id || '—'}</span></td>
      <td><span class="badge bg-${m.color}">${m.label}</span> ${noLitterBtn}</td>
      <td>${f.status_since ? fmtDate(f.status_since) : '—'}</td>
      <td>${daysSince !== null ? daysSince + 'd' : '—'}${urgency ? ' <i class="bi bi-exclamation-triangle-fill text-danger ms-1"></i>' : ''}</td>
      <td class="small">${litterLabel}</td>
      <td class="small text-muted">Room ${f.room_id || '?'} · ${f.cage_address || '?'}</td>
      <td class="small text-muted">${(f.status_notes || '—').toString().slice(0, 80)}</td>
    </tr>`;
  }).join('');
}

/** Record no_litter and refresh the Reproductive Status Board. */
async function returnToBaseline(ferretId, name) {
  if (!confirm(`Mark ${name || 'this female'} as no litter and return her to baseline?\n\nShe will leave the Reproductive Status Board.`)) return;
  try {
    await api(`/ferrets/${ferretId}/no-litter`, { method: 'POST', body: { notes: 'No litter — returned to baseline (board)' } });
    // Refresh board in place
    _dashReproData = await api('/females/estrus');
    renderDashReproFilterBtns();
    renderDashReproTable();
  } catch (err) { alert(err.message); }
}

// ─── Weight & Grooming Care Alerts ──────────────────────────────────────────────
// v1.10.2 FIX: these were previously nested inside loadDashboard(), which meant
// (a) they weren't in global scope, so onclick="setDashCareFilter(...)" and
//     onclick="openCareScheduleModal()" handlers in index.html threw
//     "is not defined" errors, and
// (b) loadDashCareAlerts() was never actually invoked, so the card never loaded.
async function loadDashCareAlerts() {
  const card = document.getElementById('dashCareCard');
  if (!card) return;
  if (USER?.role === 'cleaner') { card.style.display = 'none'; return; }
  card.style.display = '';
  try {
    const data = await api('/ferrets/care-alerts');
    _dashCareSettings = data.settings;
    _dashCareData = data.ferrets;
    const cnt = document.getElementById('dashCareCount');
    if (cnt) cnt.textContent = _dashCareData.length;
    renderDashCareFilterBtns();
    renderDashCareTable();
    applySavedCollapse('dashCareBody');
    const footer = document.getElementById('dashCareFooter');
    if (footer) footer.innerHTML = `<i class="bi bi-info-circle me-1"></i>Nail trim every ${_dashCareSettings.nail_trim_interval_days}d · Bath every ${_dashCareSettings.bath_interval_days}d · Weight check every ${_dashCareSettings.weight_warn_days}d (yellow) / ${_dashCareSettings.weight_critical_days}d (red)`;
  } catch (err) { console.error('Care alerts:', err); }
}

async function loadDashVaccAlerts() {
  const card = document.getElementById('dashVaccCard');
  if (!card) return;
  if (USER?.role === 'cleaner') { card.style.display = 'none'; return; }
  try {
    _dashVaccData = await api('/ferrets/vaccinations-due?days=30');
    if (!_dashVaccData.length) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';
    const cnt = document.getElementById('dashVaccCount');
    if (cnt) cnt.textContent = _dashVaccData.length;
    const tbody = document.getElementById('dashVaccList');
    if (!tbody) return;
    tbody.innerHTML = _dashVaccData.map(f => {
      const overdue = f.days_until != null && f.days_until < 0;
      const dueToday = f.days_until === 0;
      const daysLabel = f.days_until == null ? '—'
        : overdue ? `${Math.abs(f.days_until)}d overdue`
        : dueToday ? 'Due today'
        : `in ${f.days_until}d`;
      return `<tr class="${overdue ? 'table-danger' : (dueToday ? 'table-warning' : '')}"
                  style="cursor:pointer" onclick="loadFerretDetail(${f.id})">
        <td><strong>${f.name}</strong><br><span class="text-muted small">${f.animal_id || '—'}</span></td>
        <td>${fmtDate(f.next_rabies_vaccine_due)}</td>
        <td>${daysLabel}</td>
        <td class="small text-muted">Room ${f.room_id || '?'} · ${f.cage_address || '?'}</td>
        <td class="small">${canUpdate() ? '<span class="text-muted">Open to record →</span>' : ''}</td>
      </tr>`;
    }).join('');
    applySavedCollapse('dashVaccBody');
  } catch (err) {
    console.error('Vaccinations due:', err);
    card.style.display = 'none';
  }
}

const DASH_CARE_FILTERS = {
  weight_never:  f => f.weight_status === 'never',
  weight_red:    f => f.weight_status === 'red',
  weight_yellow: f => f.weight_status === 'yellow',
  nail_overdue:  f => f.nail_status === 'overdue',
  bath_overdue:  f => f.bath_status === 'overdue'
};

function renderDashCareFilterBtns() {
  const wrap = document.getElementById('dashCareFilterBtns');
  if (!wrap) return;
  const counts = Object.fromEntries(Object.entries(DASH_CARE_FILTERS).map(([k, fn]) => [k, _dashCareData.filter(fn).length]));
  const btn = (key, label, color) => `<button class="btn btn-sm ${_dashCareFilter === key ? 'btn-' + color : 'btn-outline-secondary'}"
    onclick="setDashCareFilter('${key}')">${label} <span class="badge bg-light text-dark ms-1">${counts[key]}</span></button>`;
  wrap.innerHTML =
    `<button class="btn btn-sm ${_dashCareFilter === null ? 'btn-primary' : 'btn-outline-secondary'}" onclick="setDashCareFilter(null)">
      All <span class="badge bg-light text-dark ms-1">${_dashCareData.length}</span></button>` +
    btn('weight_never', 'Never Weighed', 'dark') +
    btn('weight_red', 'Weight 45d+', 'danger') +
    btn('weight_yellow', 'Weight 30d+', 'warning') +
    btn('nail_overdue', 'Nail Trim Overdue', 'secondary') +
    btn('bath_overdue', 'Bath Overdue', 'secondary');
}

function setDashCareFilter(key) {
  _dashCareFilter = key;
  renderDashCareFilterBtns();
  renderDashCareTable();
}

function setDashCareSort(val) {
  _dashCareSort = val;
  renderDashCareTable();
}

function sortDashCareData(arr) {
  const sorted = [...arr];
  if (_dashCareSort === 'name') {
    sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } else if (_dashCareSort === 'location') {
    sorted.sort((a, b) => {
      const ra = a.room_id ?? 9999, rb = b.room_id ?? 9999;
      if (ra !== rb) return ra - rb;
      return (a.cage_address || '').localeCompare(b.cage_address || '');
    });
  }
  // 'urgency' — leave in the order the API returned (already worst-first)
  return sorted;
}

function renderDashCareTable() {
  const tbody = document.getElementById('dashCareList');
  if (!tbody) return;
  const base = _dashCareFilter ? _dashCareData.filter(DASH_CARE_FILTERS[_dashCareFilter]) : _dashCareData;
  const filtered = sortDashCareData(base);
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted text-center py-3">No ferrets need attention 🎉</td></tr>';
    return;
  }
  const weightBadge = f => {
    if (f.weight_status === 'never') return '<span class="badge bg-dark">Never Weighed</span>';
    if (f.weight_status === 'red') return `<span class="badge bg-danger">${f.weight_days}d ago</span>`;
    if (f.weight_status === 'yellow') return `<span class="badge bg-warning text-dark">${f.weight_days}d ago</span>`;
    return `<span class="text-muted small">${f.weight_days}d ago</span>`;
  };
  const groomBadge = (status, days) => status === 'overdue'
    ? `<span class="badge bg-danger">${days !== null ? days + 'd ago' : 'Never'}</span>`
    : (days !== null ? `<span class="text-muted small">${days}d ago</span>` : '<span class="text-muted small">—</span>');
  tbody.innerHTML = filtered.map(f => `
    <tr style="cursor:pointer" onclick="loadFerretDetail(${f.id});">
      <td><strong>${f.name}</strong><br><span class="text-muted small">${f.animal_id || '—'}</span></td>
      <td>${weightBadge(f)}</td>
      <td>${groomBadge(f.nail_status, f.nail_days)}</td>
      <td>${groomBadge(f.bath_status, f.bath_days)}</td>
      <td class="small text-muted">Room ${f.room_id || '?'} · ${f.cage_address || '?'}</td>
    </tr>`).join('');
}

async function openCareScheduleModal() {
  try {
    const s = _dashCareSettings || await api('/care-schedule');
    document.getElementById('csNailInterval').value = s.nail_trim_interval_days;
    document.getElementById('csBathInterval').value = s.bath_interval_days;
    document.getElementById('csWeightWarn').value = s.weight_warn_days;
    document.getElementById('csWeightCritical').value = s.weight_critical_days;
    new bootstrap.Modal(document.getElementById('careScheduleModal')).show();
  } catch (err) { alert(err.message); }
}

async function submitCareSchedule() {
  try {
    await api('/care-schedule', {
      method: 'PUT', body: {
        nail_trim_interval_days: parseInt(document.getElementById('csNailInterval').value) || 180,
        bath_interval_days: parseInt(document.getElementById('csBathInterval').value) || 180,
        weight_warn_days: parseInt(document.getElementById('csWeightWarn').value) || 30,
        weight_critical_days: parseInt(document.getElementById('csWeightCritical').value) || 45
      }
    });
    bootstrap.Modal.getInstance(document.getElementById('careScheduleModal')).hide();
    loadDashCareAlerts();
  } catch (err) { alert(err.message); }
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
function weeksSince(dateStr) {
  if (!dateStr) return null;
  const start = new Date(dateStr);
  const days = Math.floor((Date.now() - start) / 864e5);
  return days < 0 ? 0 : Math.floor(days / 7);
}

// ─── Stacked Modal Fix ─────────────────────────────────────────────────────────
// Bootstrap doesn't bump z-index for a modal opened from within another modal
// (e.g. Log Kit Death opened on top of Litter Care Details), so the new modal
// and its backdrop can end up rendering *behind* the modal it was opened from.
// Give each successively-opened modal (and its backdrop) a higher z-index.
document.addEventListener('show.bs.modal', e => {
  const openCount = document.querySelectorAll('.modal.show').length;
  if (!openCount) return;
  const zIndex = 1055 + openCount * 20;
  e.target.style.zIndex = zIndex;
  setTimeout(() => {
    const backdrops = document.querySelectorAll('.modal-backdrop');
    const topBackdrop = backdrops[backdrops.length - 1];
    if (topBackdrop) topBackdrop.style.zIndex = zIndex - 5;
  }, 0);
});

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