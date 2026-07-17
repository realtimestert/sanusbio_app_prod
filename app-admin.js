// SanusBio v1.9.2 | 2026-07-17 | app-admin.js
// Locations, Suppliers, Assignments, Users, Activity Log, Distribution Page

// ─── Locations ────────────────────────────────────────────────────────────────
async function loadLocations() {
  if (roleIs('admin', 'research')) document.getElementById('btnAddLocationMain').classList.remove('d-none');
  loadRoomLightSchedule();
  try {
    const addresses = await api('/addresses');
    const accordion = document.getElementById('locationAccordion');
    if (!addresses.length) { accordion.innerHTML = '<div class="text-muted mt-2">No locations yet.</div>'; return; }
    const canDeleteLoc = roleIs('admin', 'research');
    accordion.innerHTML = addresses.map((a, i) => `
  <div class="accordion-item">
    <h2 class="accordion-header d-flex align-items-center">
      <button class="accordion-button flex-grow-1 ${i === 0 ? '' : 'collapsed'}" type="button"
        data-bs-toggle="collapse" data-bs-target="#loc${a.address_id}">
        Room ${a.room_id}${a.room_name ? ' ' + a.room_name : ''} · Cage ${a.cage_address || '—'}
        ${a.room_lighting ? `<span class="text-muted small ms-2">(${a.room_lighting})</span>` : ''}
      </button>
      ${canDeleteLoc ? `<button class="btn btn-sm btn-outline-danger me-2 flex-shrink-0" style="z-index:1"
        onclick="deleteLocation(${a.address_id}, 'Room ${a.room_id} · Cage ${a.cage_address || '?'}')">
        <i class="bi bi-trash"></i>
      </button>` : ''}
    </h2>
    <div id="loc${a.address_id}" class="accordion-collapse collapse ${i === 0 ? 'show' : ''}">
      <div class="accordion-body p-2">
        <div id="locFerrets${a.address_id}" class="text-muted small">Loading…</div>
      </div>
    </div>
  </div>`).join('');
    for (const a of addresses) {
      try {
        const ferrets = await api(`/addresses/${a.address_id}/ferrets`);
        const el = document.getElementById(`locFerrets${a.address_id}`);
        if (!ferrets.length) { el.innerHTML = '<em>No active ferrets in this location.</em>'; }
        else {
          el.innerHTML = `<table class="table table-sm mb-0">
      <thead><tr><th>Name</th><th>ID</th><th>Sex</th><th>Weight</th></tr></thead>
      <tbody>${ferrets.map(f => `
        <tr style="cursor:pointer" onclick="loadFerretDetail(${f.id})">
          <td><strong>${f.name}</strong></td>
          <td class="text-muted">${f.animal_id || '—'}</td>
          <td>${f.sex ? f.sex.charAt(0).toUpperCase() + f.sex.slice(1) : '—'}</td>
          <td>${f.weight ? f.weight + ' g' : '—'}</td>
        </tr>`).join('')}
      </tbody></table>`;
        }
      } catch { /* skip */ }
    }
  } catch (err) { console.error(err); }
}

async function deleteLocation(id, label) {
  if (!confirm(`Delete "${label}"?\n\nThis will fail if any ferrets are assigned here.`)) return;
  try {
    await api(`/addresses/${id}`, { method: 'DELETE' });
    loadLocations();
  } catch (err) { alert(err.message); }
}

async function openMoveModal(ferretId) {
  document.getElementById('moveFerretId').value = ferretId;
  document.getElementById('movePosNone').checked = true;
  try {
    const addresses = await api('/addresses');
    document.getElementById('moveAddrId').innerHTML = addresses.map(a => {
      const label = `Room ${a.room_id}${a.room_name ? ' ' + a.room_name : ''} · Cage ${a.cage_address || '?'}${a.room_lighting ? ' · ' + a.room_lighting : ''}`;
      return `<option value="${a.address_id}">${label}</option>`;
    }).join('');
    new bootstrap.Modal(document.getElementById('moveModal')).show();
  } catch (err) { alert(err.message); }
}

async function submitMove() {
  const ferretId = document.getElementById('moveFerretId').value;
  const address_id = document.getElementById('moveAddrId').value;
  const position = document.querySelector('input[name="movePosition"]:checked')?.value || null;
  try {
    await api(`/ferrets/${ferretId}/location`, { method: 'PUT', body: { address_id: parseInt(address_id), position } });
    bootstrap.Modal.getInstance(document.getElementById('moveModal')).hide();
    loadFerretDetail(ferretId);
  } catch (err) { alert(err.message); }
}

async function submitAddress() {
  const room = document.getElementById('adRoom').value;
  if (!room) return alert('Room ID is required');
  const position = document.querySelector('input[name="adPosition"]:checked')?.value || null;
  try {
    await api('/addresses', {
      method: 'POST', body: {
        room_id: parseInt(room),
        room_name: document.getElementById('adRoomName').value || null,
        cage_address: document.getElementById('adCage').value || null,
        room_lighting: position || null
      }
    });
    bootstrap.Modal.getInstance(document.getElementById('addrModal')).hide();
    document.getElementById('adRoom').value = '';
    document.getElementById('adRoomName').value = '';
    document.getElementById('adCage').value = '';
    document.getElementById('adPosNone').checked = true;
    alert('Location added!');
  } catch (err) { alert(err.message); }
}

// ─── Room Light Schedule ──────────────────────────────────────────────────────
async function loadRoomLightSchedule() {
  const el = document.getElementById('roomLightList');
  if (!el) return;
  try {
    const rooms = await api('/rooms/light-schedule');
    if (!rooms.length) { el.innerHTML = '<span class="text-muted small">No rooms configured yet.</span>'; return; }
    const canToggle = roleIs('admin', 'research', 'maternity');
    el.innerHTML = rooms.map(r => `
      <div class="d-flex align-items-center gap-2 border rounded-3 px-3 py-2">
        <span class="fw-semibold small">Room ${r.room_id}${r.room_name ? ' ' + r.room_name : ''}</span>
        <div class="form-check form-switch mb-0">
          <input class="form-check-input" type="checkbox" ${r.eight_hour_light ? 'checked' : ''}
            ${canToggle ? '' : 'disabled'}
            onchange="toggleRoomLight(${r.room_id}, this.checked)"
            style="width:2.5em;height:1.4em;cursor:pointer;">
        </div>
      </div>`).join('');
  } catch (err) {
    console.error(err);
    el.innerHTML = '<span class="text-danger small">Failed to load room light schedule.</span>';
  }
}

async function toggleRoomLight(roomId, enabled) {
  try {
    await api(`/rooms/${roomId}/light`, { method: 'PUT', body: { eight_hour_light: enabled } });
    loadRoomLightSchedule();
  } catch (err) {
    alert(err.message);
    loadRoomLightSchedule();
  }
}

// ─── Suppliers Page ───────────────────────────────────────────────────────────
async function loadSuppliers() {
  if (roleIs('admin', 'research')) document.getElementById('btnAddSupplierMain').classList.remove('d-none');
  try {
    const suppliers = await api('/suppliers');
    const container = document.getElementById('supplierCards');
    if (!suppliers.length) { container.innerHTML = '<div class="col"><p class="text-muted">No suppliers yet.</p></div>'; return; }
    container.innerHTML = suppliers.map(s => `
  <div class="col-md-4">
    <div class="card h-100">
      <div class="card-body">
        <div class="d-flex align-items-start justify-content-between mb-2">
          <h6 class="fw-bold mb-0">${s.supplier_name}</h6>
          ${roleIs('admin', 'research') ? `<button class="btn btn-sm btn-outline-primary" onclick="openEditSupplier(${s.supplier_id})"><i class="bi bi-pencil"></i></button>` : ''}
        </div>
        <div class="small text-muted mb-1"><i class="bi bi-person me-1"></i>${s.contact_info || '—'}</div>
        <div class="small text-muted mb-1"><i class="bi bi-geo-alt me-1"></i>${s.supplier_address || '—'}</div>
        <div class="small text-muted mb-2"><i class="bi bi-telephone me-1"></i>${s.supplier_phone_number || '—'}</div>
        <span class="badge bg-primary bg-opacity-10 text-primary">${s.ferret_count || 0} ferret(s)</span>
      </div>
    </div>
  </div>`).join('');
  } catch (err) { console.error(err); }
}

function openSupplierModal() {
  _editSupplierId = null;
  document.getElementById('supplierModalTitle').textContent = 'Add Supplier';
  document.getElementById('supId').value = '';
  document.getElementById('supName').value = '';
  document.getElementById('supContact').value = '';
  document.getElementById('supAddr').value = '';
  document.getElementById('supPhone').value = '';
  new bootstrap.Modal(document.getElementById('supplierModal')).show();
}

async function openEditSupplier(id) {
  _editSupplierId = id;
  try {
    const suppliers = await api('/suppliers');
    const s = suppliers.find(x => x.supplier_id === id);
    if (!s) return;
    document.getElementById('supplierModalTitle').textContent = `Edit: ${s.supplier_name}`;
    document.getElementById('supId').value = id;
    document.getElementById('supName').value = s.supplier_name || '';
    document.getElementById('supContact').value = s.contact_info || '';
    document.getElementById('supAddr').value = s.supplier_address || '';
    document.getElementById('supPhone').value = s.supplier_phone_number || '';
    new bootstrap.Modal(document.getElementById('supplierModal')).show();
  } catch (err) { alert(err.message); }
}

async function submitSupplier() {
  const name = document.getElementById('supName').value.trim();
  if (!name) return alert('Supplier name is required');
  const body = {
    supplier_name: name,
    contact_info: document.getElementById('supContact').value || null,
    supplier_address: document.getElementById('supAddr').value || null,
    supplier_phone_number: document.getElementById('supPhone').value || null
  };
  try {
    if (_editSupplierId) {
      await api(`/suppliers/${_editSupplierId}`, { method: 'PUT', body });
    } else {
      await api('/suppliers', { method: 'POST', body });
    }
    bootstrap.Modal.getInstance(document.getElementById('supplierModal')).hide();
    loadSuppliers();
  } catch (err) { alert(err.message); }
}

// ─── Assignments ──────────────────────────────────────────────────────────────
async function loadAssignments() {
  if (roleIs('admin', 'research')) document.getElementById('btnAddAssign').classList.remove('d-none');
  try {
    const data = await api('/assignments');
    const tbody = document.getElementById('assignTable');
    if (!data.length) { tbody.innerHTML = '<tr><td colspan="6" class="text-muted text-center py-4">No assignments</td></tr>'; return; }
    tbody.innerHTML = data.map(a => {
      const overdue = !a.completed && a.due_date && new Date(a.due_date) < new Date();
      const canComplete = !a.completed && (roleIs('admin') || a.assigned_to === USER.user_id);
      return `<tr class="${a.completed ? 'text-muted' : ''}">
    <td><span class="badge bg-secondary">${a.assignment_type}</span></td>
    <td>${a.assigned_full_name || a.assigned_username}</td>
    <td>${a.description || '—'}</td>
    <td class="${overdue ? 'text-danger fw-bold' : ''}">${a.due_date || '—'}</td>
    <td>${a.completed ? `<span class="badge bg-success">Completed</span>` : `<span class="badge bg-warning text-dark">Pending</span>`}</td>
    <td>${canComplete ? `<button class="btn btn-sm btn-outline-success" onclick="completeAssign(${a.assignment_id})"><i class="bi bi-check2"></i></button>` : ''}</td>
  </tr>`;
    }).join('');
  } catch (err) { console.error(err); }
}

async function completeAssign(id) {
  try { await api(`/assignments/${id}/complete`, { method: 'PUT' }); loadAssignments(); }
  catch (err) { alert(err.message); }
}

async function openAssignModal() {
  try {
    const users = await api('/users');
    document.getElementById('aAssignTo').innerHTML = users
      .filter(u => u.active)
      .map(u => `<option value="${u.user_id}">${u.full_name || u.username} (${u.role})</option>`).join('');
    document.getElementById('aDue').value = today();
    document.getElementById('aDesc').value = '';
    new bootstrap.Modal(document.getElementById('assignModal')).show();
  } catch (err) { alert(err.message); }
}

async function submitAssign() {
  try {
    await api('/assignments', {
      method: 'POST', body: {
        assigned_to: parseInt(document.getElementById('aAssignTo').value),
        assignment_type: document.getElementById('aType').value,
        description: document.getElementById('aDesc').value,
        due_date: document.getElementById('aDue').value
      }
    });
    bootstrap.Modal.getInstance(document.getElementById('assignModal')).hide();
    loadAssignments();
  } catch (err) { alert(err.message); }
}

// ─── Users ────────────────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const data = await api('/users');
    const roleColors = { admin: 'danger', research: 'primary', maternity: 'success', caretaker: 'secondary', cleaner: 'warning' };
    document.getElementById('userTable').innerHTML = data.map(u => `
  <tr>
    <td><strong>${u.username}</strong></td>
    <td>${u.full_name || '—'}</td>
    <td>${u.email}</td>
    <td><span class="badge bg-${roleColors[u.role]} role-badge">${u.role}</span></td>
    <td>${u.active
        ? '<span class="badge bg-success-subtle text-success border border-success-subtle">Active</span>'
        : '<span class="badge bg-secondary-subtle text-secondary border">Inactive</span>'}</td>
    <td class="text-muted small">${u.last_login ? fmtDT(u.last_login) : 'Never'}</td>
    <td><button class="btn btn-sm btn-outline-primary" onclick="openEditUser(${u.user_id})"><i class="bi bi-pencil"></i></button></td>
  </tr>`).join('');
  } catch (err) { console.error(err); }
}

function openUserModal() {
  _editUserId = null;
  document.getElementById('userModalTitle').textContent = 'Add User';
  document.getElementById('uUsername').value = '';
  document.getElementById('uUsername').disabled = false;
  document.getElementById('uFullName').value = '';
  document.getElementById('uEmail').value = '';
  document.getElementById('uRole').value = 'caretaker';
  document.getElementById('uPassword').value = '';
  document.getElementById('uPassword').placeholder = 'Required — min 8 characters';
  document.getElementById('uPassReq').style.display = '';
  document.getElementById('uActiveWrap').style.display = 'none';
  new bootstrap.Modal(document.getElementById('userModal')).show();
}

async function openEditUser(id) {
  _editUserId = id;
  try {
    const users = await api('/users');
    const u = users.find(x => x.user_id === id);
    if (!u) return;
    document.getElementById('userModalTitle').textContent = `Edit: ${u.username}`;
    document.getElementById('uUsername').value = u.username;
    document.getElementById('uUsername').disabled = true;
    document.getElementById('uFullName').value = u.full_name || '';
    document.getElementById('uEmail').value = u.email;
    document.getElementById('uRole').value = u.role;
    document.getElementById('uPassword').value = '';
    document.getElementById('uPassword').placeholder = 'Leave blank to keep current';
    document.getElementById('uPassReq').style.display = 'none';
    document.getElementById('uActive').value = u.active ? '1' : '0';
    document.getElementById('uActiveWrap').style.display = '';
    new bootstrap.Modal(document.getElementById('userModal')).show();
  } catch (err) { alert(err.message); }
}

async function submitUser() {
  const body = {
    email: document.getElementById('uEmail').value,
    role: document.getElementById('uRole').value,
    full_name: document.getElementById('uFullName').value
  };
  const pw = document.getElementById('uPassword').value;
  if (pw) body.password = pw;
  try {
    if (_editUserId) {
      body.active = parseInt(document.getElementById('uActive').value);
      await api(`/users/${_editUserId}`, { method: 'PUT', body });
    } else {
      if (!pw) return alert('Password is required for new users');
      body.username = document.getElementById('uUsername').value;
      await api('/users', { method: 'POST', body });
    }
    document.getElementById('uUsername').disabled = false;
    bootstrap.Modal.getInstance(document.getElementById('userModal')).hide();
    loadUsers();
  } catch (err) { alert(err.message); }
}

// ─── Activity Log ─────────────────────────────────────────────────────────────
let _actPage = 1, _actUserId = null, _actDateFrom = null, _actDateTo = null;

async function loadActivity() {
  const filterEl = document.getElementById('actUserFilter');
  if (filterEl && filterEl.options.length === 1) {
    try {
      const users = await api('/users');
      users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.user_id;
        opt.textContent = u.full_name || u.username;
        filterEl.appendChild(opt);
      });
    } catch { /* non-fatal */ }
  }
  await fetchActPage(1);
}

async function fetchActPage(page) {
  _actPage = page;
  const params = new URLSearchParams({ page });
  if (_actUserId) params.set('user_id', _actUserId);
  if (_actDateFrom) params.set('date_from', _actDateFrom);
  if (_actDateTo) params.set('date_to', _actDateTo);

  const tbody = document.getElementById('actTable');
  tbody.innerHTML = '<tr><td colspan="5" class="text-center py-3 text-muted"><div class="spinner-border spinner-border-sm me-2"></div>Loading\u2026</td></tr>';

  try {
    const { rows, total, pages } = await api('/activity-log?' + params.toString());
    const actionColors = {
      CREATE: 'success', UPDATE: 'primary', DELETE: 'danger', MOVE: 'info',
      LOGIN: 'secondary', COMPLETE: 'success', PHOTO_UPLOAD: 'secondary',
      PROCEDURE: 'warning', CREATE_USER: 'success', UPDATE_USER: 'primary',
      CREATE_LOCATION: 'info', DELETE_LOCATION: 'danger'
    };
    tbody.innerHTML = rows.map(a =>
      `<tr>
        <td class="text-muted small">${fmtDT(a.created_at)}</td>
        <td><strong>${a.username}</strong></td>
        <td><span class="badge bg-${actionColors[a.action] || 'secondary'} action-type">${a.action}</span></td>
        <td class="text-muted small">${a.table_name || '\u2014'}</td>
        <td class="small">${a.details || '\u2014'}</td>
      </tr>`
    ).join('') || '<tr><td colspan="5" class="text-muted text-center py-4">No activity found</td></tr>';

    const badge = document.getElementById('actTotalBadge');
    if (badge) badge.textContent = total + ' record' + (total !== 1 ? 's' : '');

    const pageInfo = document.getElementById('actPageInfo');
    const pageBtns = document.getElementById('actPageBtns');
    const pagingBar = document.getElementById('actPagination');
    const start = (page - 1) * 100 + 1;
    const end = Math.min(page * 100, total);
    if (pageInfo) pageInfo.textContent = total ? `Showing ${start}\u2013${end} of ${total}` : '';
    if (pagingBar) pagingBar.style.display = total > 100 ? '' : 'none';

    if (pageBtns) {
      const btn = (label, pg, active = false, disabled = false) =>
        `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-outline-secondary'}"
          ${disabled ? 'disabled' : ''} onclick="fetchActPage(${pg})">${label}</button>`;
      const range = 3;
      const lo = Math.max(1, page - range);
      const hi = Math.min(pages, page + range);
      let html = btn('\u2039', page - 1, false, page === 1);
      if (lo > 1) html += btn('1', 1) + (lo > 2 ? '<span class="px-1 text-muted">\u2026</span>' : '');
      for (let p = lo; p <= hi; p++) html += btn(p, p, p === page);
      if (hi < pages) html += (hi < pages - 1 ? '<span class="px-1 text-muted">\u2026</span>' : '') + btn(pages, pages);
      html += btn('\u203a', page + 1, false, page === pages);
      pageBtns.innerHTML = html;
    }
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '<tr><td colspan="5" class="text-danger text-center py-3">Failed to load activity</td></tr>';
  }
}

function applyActFilters() {
  _actUserId = document.getElementById('actUserFilter').value || null;
  _actDateFrom = document.getElementById('actDateFrom').value || null;
  _actDateTo = document.getElementById('actDateTo').value || null;
  fetchActPage(1);
}

function clearActFilters() {
  document.getElementById('actUserFilter').value = '';
  document.getElementById('actDateFrom').value = '';
  document.getElementById('actDateTo').value = '';
  _actUserId = _actDateFrom = _actDateTo = null;
  fetchActPage(1);
}

// ─── Distribution Page ────────────────────────────────────────────────────────
let _distFilterId = null;
let _editDistributorId = null;

async function loadDistribution() {
  const canManage = roleIs('admin', 'research');
  if (canManage) document.getElementById('btnAddDistributor').classList.remove('d-none');
  else document.getElementById('btnAddDistributor').classList.add('d-none');

  try {
    const [distributors, events] = await Promise.all([
      api('/distributors'),
      api('/distribution-events')
    ]);

    const filterWrap = document.getElementById('distFilterBtns');
    filterWrap.innerHTML = `
      <button class="btn btn-sm ${_distFilterId === null ? 'btn-primary' : 'btn-outline-secondary'}" onclick="setDistFilter(null)">All</button>
      ${distributors.map(d => `
        <button class="btn btn-sm ${_distFilterId === d.distributor_id ? 'btn-primary' : 'btn-outline-secondary'}"
          onclick="setDistFilter(${d.distributor_id})">${d.distributor_name}</button>`).join('')}`;

    const cardsWrap = document.getElementById('distSummaryCards');
    cardsWrap.innerHTML = distributors.map(d => {
      const ferretCount = d.distribution_count || 0;
      const totalVal = d.total_value ? '$' + parseFloat(d.total_value).toFixed(2) : '—';
      const lastDate = d.last_distribution_date ? fmtDate(d.last_distribution_date) : 'Never';
      return `
        <div class="col-md-4 col-lg-3">
          <div class="card h-100">
            <div class="card-body">
              <div class="d-flex align-items-start justify-content-between mb-2">
                <div>
                  <h6 class="fw-bold mb-0">${d.distributor_name}</h6>
                  ${d.address ? `<div class="text-muted small"><i class="bi bi-geo-alt me-1"></i>${d.address}</div>` : ''}
                  ${d.contact_info ? `<div class="text-muted small"><i class="bi bi-person me-1"></i>${d.contact_info}</div>` : ''}
                  ${d.phone ? `<div class="text-muted small"><i class="bi bi-telephone me-1"></i>${d.phone}</div>` : ''}
                </div>
                ${canManage ? `
                <div class="d-flex flex-column gap-1">
                  <button class="btn btn-sm btn-outline-primary" onclick="openEditDistributor(${d.distributor_id})"><i class="bi bi-pencil"></i></button>
                  ${roleIs('admin', 'research') ? `<button class="btn btn-sm btn-outline-danger" onclick="deleteDistributor(${d.distributor_id})"><i class="bi bi-trash"></i></button>` : ''}
                </div>` : ''}
              </div>
              <div class="d-flex gap-2 flex-wrap mt-2">
                <span class="badge bg-primary bg-opacity-10 text-primary">${ferretCount} ferret(s)</span>
                <span class="badge bg-success bg-opacity-10 text-success">${totalVal}</span>
                <span class="badge bg-secondary bg-opacity-10 text-secondary small">Last: ${lastDate}</span>
              </div>
              <button class="btn btn-sm btn-outline-secondary w-100 mt-2" onclick="setDistFilter(${d.distributor_id})">
                <i class="bi bi-list me-1"></i>View Records
              </button>
            </div>
          </div>
        </div>`;
    }).join('') || '<div class="col"><p class="text-muted">No distributors yet.</p></div>';

    renderDistTable(events);
  } catch (err) { console.error(err); }
}

function setDistFilter(id) {
  _distFilterId = id;
  document.querySelectorAll('#distFilterBtns button').forEach((btn, i) => {
    const isAll = (id === null && i === 0);
    btn.className = `btn btn-sm ${(isAll || btn.onclick?.toString().includes(`(${id})`)) ? 'btn-primary' : 'btn-outline-secondary'}`;
  });
  api('/distribution-events' + (id ? `?distributor_id=${id}` : ''))
    .then(events => renderDistTable(events))
    .catch(console.error);
}

function renderDistTable(events) {
  const tbody = document.getElementById('distTable');
  const titleEl = document.getElementById('distTableTitle');
  const countEl = document.getElementById('distTableCount');
  titleEl.textContent = _distFilterId ? 'Records for Selected Distributor' : 'All Distribution Records';
  countEl.textContent = events.length;
  if (!events.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-muted text-center py-4">No distribution records found.</td></tr>';
    return;
  }
  tbody.innerHTML = events.map(e => `
    <tr style="cursor:pointer" onclick="loadFerretDetail(${e.ferret_id})">
      <td>${fmtDate(e.distribution_date)}</td>
      <td><strong>${e.ferret_name}</strong></td>
      <td class="text-muted">${e.animal_id || '—'}</td>
      <td>${e.sex ? e.sex.charAt(0).toUpperCase() + e.sex.slice(1) : '—'}</td>
      <td>${e.distributor_name}</td>
      <td>${e.price != null ? '$' + parseFloat(e.price).toFixed(2) : '—'}</td>
      <td class="small text-muted">${e.dist_notes || '—'}</td>
      <td class="text-muted small">${e.recorded_by || '—'}</td>
      <td><i class="bi bi-chevron-right text-muted"></i></td>
    </tr>`).join('');
}

// ─── Distributor CRUD ─────────────────────────────────────────────────────────
function openDistributorModal() {
  _editDistributorId = null;
  document.getElementById('distributorModalTitle').textContent = 'Add Distributor';
  document.getElementById('distMgrId').value = '';
  document.getElementById('distMgrName').value = '';
  document.getElementById('distMgrContact').value = '';
  document.getElementById('distMgrAddr').value = '';
  document.getElementById('distMgrPhone').value = '';
  document.getElementById('distMgrNotes').value = '';
  new bootstrap.Modal(document.getElementById('distributorModal')).show();
}

async function openEditDistributor(id) {
  _editDistributorId = id;
  try {
    const distributors = await api('/distributors');
    const d = distributors.find(x => x.distributor_id === id);
    if (!d) return;
    document.getElementById('distributorModalTitle').textContent = `Edit: ${d.distributor_name}`;
    document.getElementById('distMgrId').value = id;
    document.getElementById('distMgrName').value = d.distributor_name || '';
    document.getElementById('distMgrContact').value = d.contact_info || '';
    document.getElementById('distMgrAddr').value = d.address || '';
    document.getElementById('distMgrPhone').value = d.phone || '';
    document.getElementById('distMgrNotes').value = d.notes || '';
    new bootstrap.Modal(document.getElementById('distributorModal')).show();
  } catch (err) { alert(err.message); }
}

async function submitDistributor() {
  const name = document.getElementById('distMgrName').value.trim();
  if (!name) return alert('Distributor name is required.');
  const body = {
    distributor_name: name,
    contact_info: document.getElementById('distMgrContact').value || null,
    address: document.getElementById('distMgrAddr').value || null,
    phone: document.getElementById('distMgrPhone').value || null,
    notes: document.getElementById('distMgrNotes').value || null
  };
  try {
    if (_editDistributorId) {
      await api(`/distributors/${_editDistributorId}`, { method: 'PUT', body });
    } else {
      await api('/distributors', { method: 'POST', body });
    }
    bootstrap.Modal.getInstance(document.getElementById('distributorModal')).hide();
    loadDistribution();
  } catch (err) { alert(err.message); }
}

async function deleteDistributor(id) {
  if (!confirm('Delete this distributor? This will fail if any distribution records reference it.')) return;
  try {
    await api(`/distributors/${id}`, { method: 'DELETE' });
    loadDistribution();
  } catch (err) { alert(err.message); }
}
