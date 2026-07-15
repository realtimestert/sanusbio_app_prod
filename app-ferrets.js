// SanusBio v1.9.0 | 2026-07-15 | app-ferrets.js
// Ferrets grid/detail, RFID, Distribution, Photo, Ferret Actions, Add Ferret Modal

// ─── Ferrets ──────────────────────────────────────────────────────────────────
async function loadFerrets(search = '') {
  if (canUpdate()) document.getElementById('btnAddFerret').classList.remove('d-none');
  if (roleIs('admin')) {
    document.getElementById('btnAddLocation').classList.remove('d-none');
    document.getElementById('btnAddSupplier').classList.remove('d-none');
  }
  try {
    _ferretData = await api('/ferrets' + (search ? `?search=${encodeURIComponent(search)}` : ''));
    renderFerretGrid();
  } catch (err) { console.error(err); }
}

let _ferretTab = 'active';

function switchFerretTab(tab) {
  _ferretTab = tab;
  document.getElementById('tabActive').classList.toggle('active', tab === 'active');
  document.getElementById('tabDeceased').classList.toggle('active', tab === 'deceased');
  document.getElementById('tabDistributed').classList.toggle('active', tab === 'distributed');
  renderFerretGrid();
}

function ferretAge(birthDate, endDate) {
  if (!birthDate) return '—';
  const birth = new Date(birthDate);
  const end = endDate ? new Date(endDate) : new Date();
  const totalDays = Math.floor((end - birth) / 864e5);
  if (totalDays < 0) return '—';
  const totalWeeks = Math.floor(totalDays / 7);
  if (totalWeeks < 52) return totalWeeks + 'wk';
  let years = end.getFullYear() - birth.getFullYear();
  let months = end.getMonth() - birth.getMonth();
  let days = end.getDate() - birth.getDate();
  if (days < 0) { months--; days += new Date(end.getFullYear(), end.getMonth(), 0).getDate(); }
  if (months < 0) { years--; months += 12; }
  const weeks = Math.floor(days / 7);
  let parts = [];
  if (years) parts.push(years + 'Y');
  if (months) parts.push(months + 'mo');
  if (weeks) parts.push(weeks + 'wk');
  return parts.length ? parts.join(' ') : years + 'Y';
}

function renderFerretGrid() {
  const grid = document.getElementById('ferretGrid');
  if (!_ferretData.length) { grid.innerHTML = '<div class="col"><p class="text-muted mt-2">No ferrets found.</p></div>'; return; }

  const isDistributed = f => f.distributed == 1;
  const isDeceased = f => !isDistributed(f) && f.dead === '1';
  const isActive = f => !isDistributed(f) && f.dead !== '1';

  let filtered;
  if (_ferretTab === 'distributed') filtered = _ferretData.filter(isDistributed);
  else if (_ferretTab === 'deceased') filtered = _ferretData.filter(isDeceased);
  else filtered = _ferretData.filter(isActive);

  const tabAC = document.getElementById('tabActiveCount');
  const tabDC = document.getElementById('tabDeceasedCount');
  const tabDist = document.getElementById('tabDistributedCount');
  if (tabAC) tabAC.textContent = _ferretData.filter(isActive).length;
  if (tabDC) tabDC.textContent = _ferretData.filter(isDeceased).length || '';
  if (tabDist) tabDist.textContent = _ferretData.filter(isDistributed).length || '';

  if (!filtered.length) {
    const msgs = { active: 'No active ferrets.', deceased: 'No deceased ferrets.', distributed: 'No distributed ferrets.' };
    grid.innerHTML = `<div class="col"><p class="text-muted mt-2">${msgs[_ferretTab]}</p></div>`;
    return;
  }

  const sortBy = document.getElementById('ferretSort')?.value || 'name';
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'age') return new Date(a.birth_date || 0) - new Date(b.birth_date || 0);
    if (sortBy === 'sex') return (a.sex || 'zzz').localeCompare(b.sex || 'zzz');
    if (sortBy === 'room') return (a.room_id || 0) - (b.room_id || 0);
    if (sortBy === 'supplier') return (a.supplier_name || 'zzz').localeCompare(b.supplier_name || 'zzz');
    return (a.name || '').localeCompare(b.name || '');
  });
  const sexIcon = s => s === 'male' ? '<span class="badge bg-primary badge-pill small">♂ M</span>'
    : s === 'female' ? '<span class="badge bg-danger badge-pill small">♀ F</span>' : '';
  grid.innerHTML = sorted.map(f => {
    const vaccDue = f.next_rabies_vaccine_due &&
      new Date(f.next_rabies_vaccine_due) <= new Date(Date.now() + 30 * 864e5) && !isDistributed(f) && f.dead !== '1';
    let ageLabel;
    if (isDeceased(f)) {
      ageLabel = 'Lived ' + ferretAge(f.birth_date, f.death_date);
    } else {
      ageLabel = ferretAge(f.birth_date);
    }
    return `
  <div class="col-md-4 col-lg-3">
    <div class="card ferret-card" onclick="loadFerretDetail(${f.id})">
      ${f.photo_url
        ? `<img src="${f.photo_url}" class="ferret-avatar w-100" style="height:130px;object-fit:cover">`
        : `<div class="ferret-placeholder">🐾</div>`}
      <div class="card-body p-2">
        <div class="d-flex align-items-start justify-content-between">
          <div>
            <h6 class="mb-0 fw-semibold">${f.name}</h6>
            <div class="text-muted small">${ageLabel}</div>
          </div>
          <span class="status-dot mt-1 ${isDistributed(f) ? 'dot-dead' : f.dead === '1' ? 'dot-dead' : 'dot-active'}"
            style="${isDistributed(f) ? 'background:#7c3aed' : ''}"></span>
        </div>
        <div class="text-muted small mt-1">ID: ${f.animal_id || '—'}</div>
        <div class="small">Room ${f.room_id || '?'} · Cage ${f.cage_address || '?'}${f.room_lighting ? ' · ' + f.room_lighting : ''}</div>
        <div class="mt-1 d-flex flex-wrap gap-1">
          ${sexIcon(f.sex)}
          ${isDistributed(f) ? `<span class="badge badge-pill small" style="background:#7c3aed;color:#fff">Distributed</span>` : ''}
          ${f.dead === '1' && !isDistributed(f) ? `<span class="badge bg-danger badge-pill small">Deceased</span>` : ''}
          ${vaccDue ? `<span class="badge bg-warning text-dark badge-pill small">Vaccine Due</span>` : ''}
          ${f.eight_hour_light && !isDistributed(f) ? `<span class="badge bg-info text-dark badge-pill small">💡 8hr Light</span>` : ''}
          ${f.sex === 'female' && !isDistributed(f) && f.dead !== '1' && f.breeding_retired
        ? `<span class="badge bg-secondary badge-pill small">Retired (Breeding)</span>`
        : (f.sex === 'female' && f.female_status && f.female_status !== 'baseline' && !isDistributed(f) && f.dead !== '1' ? (
          f.female_status === 'estrus' ? `<span class="badge bg-danger badge-pill small">♥ Estrus</span>` :
            f.female_status === 'mated' ? `<span class="badge bg-warning text-dark badge-pill small">Mated</span>` :
              f.female_status === 'littered' ? `<span class="badge bg-success badge-pill small">Littered</span>` :
                f.female_status === 'weaned' ? `<span class="badge bg-info text-dark badge-pill small">Weaned</span>` : ''
        ) : '')}
        </div>
        ${isDistributed(f) && f.distributor_name ? `<div class="text-muted small mt-1" style="font-size:.75rem">→ ${f.distributor_name}</div>` : ''}
        ${f.color ? `<div class="text-muted small mt-1" style="font-size:.75rem">🎨 ${f.color}</div>` : ''}
        ${f.description ? `<div class="text-muted small mt-1" style="font-size:.75rem;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${f.description}</div>` : ''}
      </div>
    </div>
  </div>`;
  }).join('');
}

async function loadFerretDetail(id) {
  _currentFerretId = id;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('show'));
  document.querySelectorAll('#navLinks .nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('page-ferret-detail').classList.add('show');
  const el = document.getElementById('ferretDetail');
  el.innerHTML = '<div class="text-center py-5 text-muted"><div class="spinner-border" role="status"></div></div>';
  try {
    const [f, health, vacc, litters, history, repro, examNotes, matings] = await Promise.all([
      api(`/ferrets/${id}`),
      api(`/ferrets/${id}/health`),
      api(`/ferrets/${id}/vaccinations`),
      api(`/ferrets/${id}/litters`),
      api(`/ferrets/${id}/history`),
      api(`/ferrets/${id}/reproductive`).catch(() => []),
      api(`/ferrets/${id}/exam-notes`).catch(() => []),
      api(`/ferrets/${id}/matings`).catch(() => [])
    ]);
    const isAdmin = roleIs('admin', 'research');
    const isMat = roleIs('admin', 'maternity');
    const canEdit = roleIs('admin', 'research');
    el.innerHTML = `
  <div class="row g-3 mb-3">
    <div class="col-md-3">
      <div class="position-relative">
        ${f.photo_url
        ? `<img src="${f.photo_url}" class="img-fluid rounded-3 shadow-sm w-100" style="height:220px;object-fit:cover">`
        : `<div class="bg-light rounded-3 d-flex align-items-center justify-content-center" style="height:160px;font-size:3.5rem">🐾</div>`}
        ${canUpdate() ? `<button class="btn btn-sm btn-dark position-absolute bottom-0 end-0 m-2 opacity-75" onclick="openPhotoModal(${id})"><i class="bi bi-camera"></i></button>` : ''}
        ${f.photo_url ? `<a class="btn btn-sm btn-outline-light position-absolute bottom-0 start-0 m-2 opacity-75" href="/api/ferrets/${id}/photo/original" download title="Download original photo"><i class="bi bi-download"></i></a>` : ''}
      </div>
    </div>
    <div class="col-md-9">
      <div class="d-flex align-items-center gap-2 mb-1 flex-wrap">
        <h3 class="mb-0 fw-bold">${f.ferret_name}</h3>
        ${f.distributed == 1 ? `<span class="badge" style="background:#7c3aed">Distributed</span>` : f.dead === '1' ? `<span class="badge bg-danger">Deceased</span>` : `<span class="badge bg-success">Active</span>`}
        <div class="ms-auto d-flex gap-2 flex-wrap">
          ${canUpdate() && !f.distributed ? (f.dead === '1'
        ? `<button class="btn btn-sm btn-outline-secondary" onclick="toggleDead(${id},'1')">Mark Active</button>`
        : `<button class="btn btn-sm btn-outline-danger" onclick="openDeceasedModal(${id})"><i class="bi bi-heartbreak me-1"></i>Mark Deceased</button>`
      ) : ''}
          ${canUpdate() && f.dead !== '1' && !f.distributed ? `<button class="btn btn-sm btn-outline-primary" onclick="openDistributeModal(${id}, '${f.ferret_name.replace(/'/g, "\\'")}')"><i class="bi bi-box-arrow-right me-1"></i>Distribute</button>` : ''}
          ${canUpdate() && f.distributed ? `<button class="btn btn-sm btn-outline-secondary" onclick="undoDistribute(${id})">Undo Distribution</button>` : ''}
          ${isAdmin ? `<button class="btn btn-sm btn-outline-danger" onclick="deleteFerret(${id})">Delete</button>` : ''}
        </div>
      </div>
      <div class="text-muted mb-2">Animal ID: ${f.animal_id || '—'}</div>
      <div class="row g-2 small">
        <div class="col-6 col-md-4"><span class="text-muted">Birth Date</span><br>
          ${canEdit
        ? `<div class="d-flex align-items-center gap-2 mt-1">
                <input type="date" id="editBirthDate" class="form-control form-control-sm"
                  value="${f.birth_date ? String(f.birth_date).slice(0, 10) : ''}"
                  style="max-width:160px">
                <button class="btn btn-sm btn-outline-primary" onclick="saveBirthDate(${id})">
                  <i class="bi bi-check2"></i> Save
                </button>
               </div>`
        : `<strong>${fmtDate(f.birth_date)}</strong>`}
        </div>
        ${f.dead === '1' ? `
        <div class="col-6 col-md-4"><span class="text-muted">Death Date</span><br>
          ${canEdit
          ? `<div class="d-flex align-items-center gap-2 mt-1">
                <input type="date" id="editDeathDate" class="form-control form-control-sm"
                  value="${f.death_date ? String(f.death_date).slice(0, 10) : ''}"
                  style="max-width:160px">
                <button class="btn btn-sm btn-outline-primary" onclick="saveDeathDate(${id})">
                  <i class="bi bi-check2"></i> Save
                </button>
               </div>`
          : `<strong>${fmtDate(f.death_date)}</strong>`}
        </div>` : ''}
        <div class="col-6 col-md-4"><span class="text-muted">Sex</span><br>
          ${canEdit
        ? `<div class="d-flex align-items-center gap-2 mt-1">
              <select id="editSex" class="form-select form-select-sm" style="max-width:140px">
                <option value="" ${!f.sex ? 'selected' : ''}>— Unknown —</option>
                <option value="male" ${f.sex === 'male' ? 'selected' : ''}>Male</option>
                <option value="female" ${f.sex === 'female' ? 'selected' : ''}>Female</option>
              </select>
              <button class="btn btn-sm btn-outline-primary" onclick="saveSex(${id})">
                <i class="bi bi-check2"></i> Save
              </button>
            </div>`
        : `<strong>${f.sex ? f.sex.charAt(0).toUpperCase() + f.sex.slice(1) : '—'}</strong>`}
        </div>
        <div class="col-6 col-md-4"><span class="text-muted">Weight</span><br><strong>${f.weight ? f.weight + ' g' : '—'}</strong></div>
        <div class="col-6 col-md-4"><span class="text-muted">Location</span><br>
          <strong>Room ${f.room_id || '?'} · ${f.cage_address || '?'}${f.room_lighting ? ' · ' + f.room_lighting : ''}</strong>
          ${canUpdate() && f.dead !== '1' && !f.distributed ? `<button class="btn btn-link btn-sm p-0 ms-1" onclick="openMoveModal(${id})"><i class="bi bi-arrow-left-right"></i></button>` : ''}</div>
        <div class="col-6 col-md-4"><span class="text-muted">Supplier</span><br><strong>${f.supplier_name || '—'}</strong></div>
        <div class="col-6 col-md-4"><span class="text-muted">Mother</span><br><strong>${f.mother_name || '—'}</strong></div>
        <div class="col-6 col-md-4"><span class="text-muted">Father</span><br><strong>${f.father_name || '—'}</strong></div>
        <div class="col-6 col-md-4"><span class="text-muted">Next Rabies Vacc.</span><br><strong>${fmtDate(f.next_rabies_vaccine_due)}</strong></div>
        <div class="col-6 col-md-4"><span class="text-muted">Spayed/Castrated</span><br><strong>${f.castrated_or_spayed === 'y' ? 'Yes' : 'No'}</strong></div>
        <div class="col-6 col-md-4"><span class="text-muted">Last Exam</span><br><strong>${fmtDate(f.last_exam_date)}</strong></div>
        ${f.treatments ? `<div class="col-12"><span class="text-muted">Treatments</span><br><strong>${f.treatments}</strong></div>` : ''}
        ${f.orders ? `<div class="col-12"><span class="text-muted">Orders</span><br><strong>${f.orders}</strong></div>` : ''}
        ${f.color ? `<div class="col-6 col-md-4"><span class="text-muted">Color</span><br><strong>${f.color}</strong></div>` : ''}
        ${f.description ? `<div class="col-12"><span class="text-muted">Description</span><br><div class="mt-1 p-2 bg-light rounded small" style="white-space:pre-wrap;line-height:1.6">${f.description}</div></div>` : ''}
      </div>
    </div>
  </div>

  <!-- RFID + 8-Hour Light row -->
  <div class="row g-3 mb-3" id="rfidLightRow">
    <div class="col-md-6">
      <div class="card p-3 h-100">
        <div class="d-flex align-items-center justify-content-between mb-2">
          <span class="fw-semibold"><i class="bi bi-broadcast me-1 text-primary"></i>RFID Chip</span>
          ${canUpdate() ? `<button class="btn btn-sm btn-outline-primary" onclick="openRfidModal(${id})"><i class="bi bi-pencil me-1"></i>Assign</button>` : ''}
        </div>
        <div id="rfidDisplay">
          <div class="text-center text-muted py-2 small">
            <div class="spinner-border spinner-border-sm" role="status"></div> Loading…
          </div>
        </div>
      </div>
    </div>
    <div class="col-md-6">
      <div class="card p-3 h-100">
        <div class="d-flex align-items-center justify-content-between">
          <div>
            <span class="fw-semibold"><i class="bi bi-lightbulb me-1 text-warning"></i>8-Hour Light Schedule</span>
            <div class="text-muted small mt-1">Ferret is on an 8-hour light cycle</div>
          </div>
          ${canUpdate() ? `
          <div class="form-check form-switch ms-3">
            <input class="form-check-input" type="checkbox" id="eightHourLightToggle"
              ${f.eight_hour_light ? 'checked' : ''}
              onchange="toggleEightHourLight(${id}, this.checked)"
              style="width:2.5em;height:1.4em;cursor:pointer;">
          </div>` : `
          <span class="badge ${f.eight_hour_light ? 'bg-warning text-dark' : 'bg-secondary'}">
            ${f.eight_hour_light ? 'On' : 'Off'}
          </span>`}
        </div>
      </div>
    </div>
  </div>

  <ul class="nav nav-tabs mb-3" role="tablist">
    <li class="nav-item"><button class="nav-link active" data-bs-toggle="tab" data-bs-target="#tHealth">Health Events</button></li>
    <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tVacc">Vaccinations</button></li>
    <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tVacc">Vaccinations</button></li>
    <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tMating"><i class="bi bi-heart-fill me-1"></i>Mating History</button></li>
    ${isMat && f.sex === 'female' ? `<li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tLitter">Litters</button></li>` : ''}
    ${isMat ? `<li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tLitter">Litters</button></li>` : ''}
    ${canUpdate() ? `<li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tMed">Medical Info</button></li>` : ''}
    ${f.sex === 'female' ? `<li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tRepro"><i class="bi bi-heart me-1"></i>Estrus Status</button></li>` : ''}
    ${canUpdate() ? `<li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tMatingRestriction">Mating Restrictions</button></li>` : ''}
    <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tDist">Distribution</button></li>
    <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tHistory">History</button></li>
  </ul>

  <div class="tab-content">

    <!-- Health -->
    <div id="tHealth" class="tab-pane active">
      <div class="d-flex mb-2">
        ${canWrite() ? `<button class="btn btn-sm btn-primary ms-auto" onclick="openHealthModal(${id})"><i class="bi bi-plus-lg me-1"></i>Record Event</button>` : ''}
      </div>
      ${health.filter(h => h.event_type === 'weight' && h.weight).length > 1 ? `
      <div class="card mb-3 p-3">
        <div class="fw-semibold small mb-2 text-muted">Weight Over Time (g)</div>
        <canvas id="weightChart" height="90"></canvas>
      </div>` : ''}
      <table class="table table-sm">
        <thead><tr><th>Date</th><th>Time</th><th>Type</th><th>Weight</th><th>Notes</th><th>By</th></tr></thead>
        <tbody>${health.length ? health.map(h => `
          <tr>
            <td>${fmtDate(h.event_date)}</td>
            <td class="text-muted">${fmtTime(h.created_at)}</td>
            <td><span class="badge bg-info text-dark">${h.event_type.replace('_', ' ')}</span></td>
            <td>${h.weight ? h.weight + ' g' : '—'}</td>
            <td>${h.notes || '—'}</td>
            <td class="text-muted">${h.recorded_by || '—'}</td>
          </tr>`).join('') : '<tr><td colspan="6" class="text-muted text-center py-3">No health events</td></tr>'}
        </tbody>
      </table>
    </div>

    <!-- Vaccinations -->
    <div id="tVacc" class="tab-pane">
      <div class="d-flex mb-2">
        ${isMat ? `<button class="btn btn-sm btn-primary ms-auto" onclick="openVaccModal(${id})"><i class="bi bi-plus-lg me-1"></i>Record Vaccination</button>` : ''}
      </div>
      <table class="table table-sm">
        <thead><tr><th>Date</th><th>Type</th><th>Expires</th><th>Administered By</th><th>Notes</th><th>Recorded By</th></tr></thead>
        <tbody>${vacc.length ? vacc.map(v => `
          <tr>
            <td>${fmtDate(v.vaccination_date)}</td>
            <td>${v.vaccine_type}</td>
            <td>${fmtDate(v.expiration_date)}</td>
            <td><strong>${v.administered_by || '—'}</strong></td>
            <td>${v.notes || '—'}</td>
            <td class="text-muted">${v.recorded_by || '—'}</td>
          </tr>`).join('') : '<tr><td colspan="6" class="text-muted text-center py-3">No vaccinations</td></tr>'}
        </tbody>
      </table>
    </div>

    <!-- Mating History -->
    <div id="tMating" class="tab-pane">
      <div class="d-flex mb-2">
        ${canUpdate() ? `<button class="btn btn-sm btn-primary ms-auto" onclick="openMatingModal(${id})"><i class="bi bi-plus-lg me-1"></i>Record Mating</button>` : ''}
      </div>
      <table class="table table-sm">
        <thead><tr><th>Date</th><th>Female</th><th>Male</th><th>Notes</th><th>Recorded By</th>${roleIs('admin', 'research') ? '<th></th>' : ''}</tr></thead>
        <tbody>${matings.length ? matings.map(m => `
          <tr>
            <td>${fmtDate(m.event_date)}</td>
            <td><strong>${m.female_name}</strong></td>
            <td><strong>${m.male_name || '—'}</strong></td>
            <td class="small">${m.notes || '—'}</td>
            <td class="text-muted small">${m.recorded_by || '—'}</td>
            ${roleIs('admin', 'research') ? `<td><button class="btn btn-sm btn-outline-danger" onclick="deleteReproEvent(${m.female_id},${m.event_id})"><i class="bi bi-trash"></i></button></td>` : ''}
          </tr>`).join('') : `<tr><td colspan="${roleIs('admin', 'research') ? 6 : 5}" class="text-muted text-center py-3">No matings recorded</td></tr>`}
        </tbody>
      </table>
    </div>

    <!-- Litters -->
    ${isMat ? `
    <div id="tLitter" class="tab-pane">
      <div class="d-flex mb-2">
        <button class="btn btn-sm btn-primary ms-auto" onclick="openLitterModal(${id})"><i class="bi bi-plus-lg me-1"></i>Add Litter</button>
      </div>
      <table class="table table-sm">
        <thead><tr><th>Date</th><th>Litter ID</th><th>Kits</th><th>Stillborn</th><th>Father</th><th>Created</th><th>Notes</th><th></th></tr></thead>
        <tbody>${litters.length ? litters.map(l => `
          <tr>
            <td>${fmtDate(l.litter_date)}</td>
            <td>${l.litter_id || '—'}</td>
            <td>${l.kit_count ?? '—'}</td>
            <td>${l.stillborn ?? '—'}</td>
            <td>${l.father || '—'}</td>
            <td>${l.individuals_created ?? 0}</td>
            <td class="small">${l.anomalies_and_notes || '—'}</td>
            <td>
              ${canUpdate() && (!l.individuals_created || l.individuals_created < l.kit_count)
            ? `<button class="btn btn-xs btn-outline-success btn-sm" onclick="openCreateFromLitter(${l.litter_log_id})"><i class="bi bi-egg me-1"></i>Create Ferrets</button>` : ''}
            </td>
          </tr>`).join('') : '<tr><td colspan="8" class="text-muted text-center py-3">No litter records</td></tr>'}
        </tbody>
      </table>
    </div>` : ''}

    <!-- Medical Info -->
    ${canUpdate() ? `
    <div id="tMed" class="tab-pane">
      <div class="d-flex gap-2 mb-3">
        <button class="btn btn-sm btn-outline-primary ms-auto" onclick="openMedModal(${id},${f.medical_info_id})"><i class="bi bi-pencil me-1"></i>Edit Medical Info</button>
        <button class="btn btn-sm btn-primary" onclick="openProcedureModal(${id})"><i class="bi bi-plus-lg me-1"></i>Log Procedure</button>
      </div>
      <h6 class="fw-semibold text-muted small text-uppercase mb-2">Current Status</h6>
      <div class="row g-3 mb-3">
        <div class="col-md-4"><span class="text-muted small d-block">Vital Status</span>
          <strong>${f.dead === '1'
          ? '<span class=\"badge bg-danger fs-6 px-3 py-2\">Deceased</span>'
          : '<span class=\"badge bg-success fs-6 px-3 py-2\">Alive</span>'}</strong></div>
        ${f.dead === '1' ? `
        <div class="col-md-4"><span class="text-muted small d-block">Date of Death</span>
          <strong>${fmtDate(f.death_date)}</strong></div>
        <div class="col-md-4"><span class="text-muted small d-block">Cause of Death</span>
          <strong>${f.cause_of_death || '<span class=\"text-muted\">Not recorded</span>'}</strong></div>
        ` : ''}
      </div>
      <hr class="my-3">
      <h6 class="fw-semibold text-muted small text-uppercase mb-2">Spay / Castration</h6>
      <div class="row g-3 mb-3">
        <div class="col-md-4"><span class="text-muted small d-block">Status</span>
          <strong>${f.castrated_or_spayed === 'y' ? '<span class="badge bg-success">Yes</span>' : '<span class="badge bg-secondary">No</span>'}</strong></div>
        <div class="col-md-4"><span class="text-muted small d-block">Date</span><strong>${fmtDate(f.castration_or_spay_date)}</strong></div>
      </div>
      <div class="row g-3 mb-3">
        <div class="col-md-4"><span class="text-muted small d-block">Treatments</span><strong>${f.treatments || '—'}</strong></div>
        <div class="col-md-4"><span class="text-muted small d-block">Orders</span><strong>${f.orders || '—'}</strong></div>
      </div>
      <div class="d-flex align-items-center mb-2">
        <h6 class="fw-semibold text-muted small text-uppercase mb-0">Exam / Health Check History</h6>
        <button class="btn btn-sm btn-primary ms-auto" onclick="openExamNoteModal(${id})"><i class="bi bi-plus-lg me-1"></i>Add Exam Note</button>
      </div>
      ${examNotes.length ? `
      <div class="d-flex flex-column gap-2 mb-3">
        ${examNotes.map(n => `
          <div class="border rounded p-3 bg-light">
            <div class="d-flex flex-wrap align-items-center gap-2 mb-1">
              <strong>${fmtDate(n.exam_date)}</strong>
              ${n.weight_grams != null ? `<span class="badge bg-secondary">${n.weight_grams} g</span>` : ''}
              ${n.status ? `<span class="badge bg-info text-dark">${n.status}</span>` : ''}
              ${n.performed_by ? `<span class="text-muted small ms-auto">By: ${n.performed_by}</span>` : ''}
            </div>
            ${n.notes ? `<div class="small" style="white-space:pre-wrap;line-height:1.6">${n.notes}</div>` : ''}
          </div>`).join('')}
      </div>` : `<p class="text-muted small">No exam notes recorded yet.</p>`}
      <h6 class="fw-semibold text-muted small text-uppercase mb-2">Surgical Procedure Log</h6>
      ${f.surgical_procedure_log
          ? `<div class="border rounded p-3 bg-light small" style="white-space:pre-wrap;line-height:1.7">${f.surgical_procedure_log}</div>`
          : `<p class="text-muted small">No procedures logged yet.</p>`}
    </div>` : ''}

    <!-- Distribution -->
    <div id="tDist" class="tab-pane">
      <div id="distFerretHistory">
        <div class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm" role="status"></div> Loading…</div>
      </div>
    </div>

    <!-- Reproductive (females only) -->
    ${f.sex === 'female' ? `
    <div id="tRepro" class="tab-pane">
      <div class="d-flex align-items-center gap-2 mb-3">
        ${canUpdate() ? `<button class="btn btn-sm btn-primary ms-auto" onclick="openReproModal(${id})"><i class="bi bi-plus-lg me-1"></i>Record Event</button>` : ''}
      </div>
      <div class="row g-3 mb-3">
        <div class="col-12">
          <div class="card p-3" style="border-left:4px solid ${f.female_status && f.female_status !== 'baseline' ? '#dc3545' : '#dee2e6'}">
            <div class="d-flex align-items-center gap-3">
              <div>
                <div class="text-muted small mb-1">Current Estrus Status</div>
                <div class="row g-3 mb-3">
                  <div class="col-12">
                    <div class="card p-3 d-flex flex-row align-items-center justify-content-between">
                      <div>
                        <span class="fw-semibold"><i class="bi bi-slash-circle me-1 text-secondary"></i>Retired from Breeding</span>
                        <div class="text-muted small mt-1">Excludes this female from the Dashboard Reproductive Status Board (e.g. over-aged, retired breeder).</div>
                      </div>
                      ${canUpdate() ? `
                      <div class="form-check form-switch ms-3">
                        <input class="form-check-input" type="checkbox" id="breedingRetiredToggle"
                          ${f.breeding_retired ? 'checked' : ''}
                          onchange="toggleBreedingRetired(${id}, this.checked)"
                          style="width:2.5em;height:1.4em;cursor:pointer;">
                      </div>` : `
                      <span class="badge ${f.breeding_retired ? 'bg-secondary' : 'bg-success'}">${f.breeding_retired ? 'Retired' : 'Active'}</span>`}
                    </div>
                  </div>
                </div>
                ${(function () {
          const s = f.female_status || 'baseline';
          const meta = { baseline: { label: 'Baseline', color: 'secondary' }, estrus: { label: 'In Estrus', color: 'danger' }, mated: { label: 'Mated', color: 'warning' }, littered: { label: 'Littered', color: 'success' }, weaned: { label: 'Weaned', color: 'info' } };
          const m = meta[s] || meta.baseline;
          return `<span class="badge bg-${m.color} fs-6 px-3 py-2">${m.label}</span>`;
        })()}
              </div>
            </div>
          </div>
        </div>
      </div>
      ${repro.length ? `
      <table class="table table-sm table-hover">
        <thead><tr><th>Date</th><th>Event</th><th>Partner</th><th>Notes</th><th>Recorded By</th>${roleIs('admin', 'research') ? '<th></th>' : ''}</tr></thead>
        <tbody>${repro.map(e => {
          const meta = { estrus: { label: 'In Estrus', color: 'danger' }, mated: { label: 'Mated', color: 'warning' }, littered: { label: 'Littered', color: 'success' }, weaned: { label: 'Weaned', color: 'info' }, no_litter: { label: 'No Litter', color: 'secondary' } };
          const m = meta[e.event_type] || { label: e.event_type, color: 'secondary' };
          return `<tr>
            <td>${fmtDate(e.event_date)}</td>
            <td><span class="badge bg-${m.color}">${m.label}</span></td>
            <td>${e.partner_name ? `<strong>${e.partner_name}</strong>` : '—'}</td>
            <td class="small">${e.notes || '—'}</td>
            <td class="text-muted small">${e.recorded_by || '—'}</td>
            ${roleIs('admin', 'research') ? `<td><button class="btn btn-sm btn-outline-danger" onclick="deleteReproEvent(${id},${e.event_id})"><i class="bi bi-trash"></i></button></td>` : ''}
          </tr>`;
        }).join('')}</tbody>
      </table>` : '<p class="text-muted small">No reproductive events recorded.</p>'}
    </div>` : ''}

    <!-- Mating Restrictions -->
    ${canUpdate() ? (function () {
        const activeFlags = (f.mating_restriction_flags || '').split(',').map(s => s.trim()).filter(Boolean);
        const chk = flag => activeFlags.includes(flag) ? 'checked' : '';
        return `
    <div id="tMatingRestriction" class="tab-pane">
      <div class="card p-4" style="max-width:640px">
        <h6 class="fw-semibold mb-1">Mating Restrictions</h6>
        <p class="text-muted small mb-3">Select any restrictions that make this ferret ineligible for mating.</p>

        <div class="form-check mb-2">
          <input class="form-check-input mr-flag" type="checkbox" value="over_age" id="mrOverAge" ${chk('over_age')}>
          <label class="form-check-label" for="mrOverAge">Over Age</label>
        </div>
        <div class="form-check mb-2">
          <input class="form-check-input mr-flag" type="checkbox" value="under_age" id="mrUnderAge" ${chk('under_age')}>
          <label class="form-check-label" for="mrUnderAge">Under Age</label>
        </div>
        ${f.sex === 'male' ? `
        <div class="form-check mb-2">
          <input class="form-check-input mr-flag" type="checkbox" value="albino" id="mrAlbino" ${chk('albino')}>
          <label class="form-check-label" for="mrAlbino">Albino</label>
        </div>` : ''}
        <div class="form-check mb-2">
          <input class="form-check-input mr-flag" type="checkbox" value="other" id="mrOther" onchange="toggleMrOtherBox()" ${chk('other')}>
          <label class="form-check-label" for="mrOther">Other</label>
        </div>

        <div id="mrOtherBox" style="display:${chk('other') ? '' : 'none'}">
          <textarea id="matingRestrictionText" class="form-control mt-2 mb-3" rows="4"
            placeholder="Describe the restriction…">${f.mating_restriction || ''}</textarea>
        </div>

        <div class="d-flex align-items-center gap-3 mt-2">
          <button class="btn btn-primary" onclick="saveMatingRestriction(${id})"><i class="bi bi-floppy me-1"></i>Save</button>
          <span id="matingRestrictionSaved" class="text-success small" style="display:none"><i class="bi bi-check2 me-1"></i>Saved</span>
        </div>
      </div>
    </div>`;
      })() : ''}

    <!-- History -->
    <div id="tHistory" class="tab-pane">
      <div class="timeline ps-2">
        ${history.length ? history.map(h => {
        const { icon, color } = historyMeta(h.action);
        return `
        <div class="d-flex gap-3 mb-3 align-items-start">
          <div class="history-icon bg-${color} bg-opacity-10 text-${color}">${icon}</div>
          <div class="flex-grow-1">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <span class="badge bg-secondary action-type">${h.action}</span>
              <strong class="small">${h.username}</strong>
              <span class="text-muted small ms-auto">${fmtDT(h.created_at)}</span>
            </div>
            ${h.details ? `<div class="text-muted small mt-1">${h.details}</div>` : ''}
          </div>
        </div>`;
      }).join('') : '<p class="text-muted small">No history yet.</p>'}
      </div>
    </div>

  </div>`;

    // Weight chart
    const canvas = document.getElementById('weightChart');
    if (canvas) {
      const weightData = health.filter(h => h.event_type === 'weight' && h.weight)
        .sort((a, b) => new Date(a.event_date) - new Date(b.event_date));
      new Chart(canvas, {
        type: 'line',
        data: {
          labels: weightData.map(h => fmtDate(h.event_date)),
          datasets: [{
            label: 'Weight (g)', data: weightData.map(h => h.weight),
            borderColor: '#0d6efd', backgroundColor: 'rgba(13,110,253,.08)', tension: .3, fill: true, pointRadius: 4
          }]
        },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: false } } }
      });
    }

    loadRfidDisplay(id);
    loadFerretDistHistory(id);
  } catch (err) { el.innerHTML = `<div class="alert alert-danger">${err.message}</div>`; }
}

function historyMeta(action) {
  const map = {
    CREATE: { icon: '＋', color: 'success' },
    UPDATE: { icon: '✏', color: 'primary' },
    DELETE: { icon: '✕', color: 'danger' },
    MOVE: { icon: '→', color: 'info' },
    COMPLETE: { icon: '✓', color: 'success' },
    PHOTO_UPLOAD: { icon: '📷', color: 'secondary' },
    PROCEDURE: { icon: '🏥', color: 'warning' },
    LOGIN: { icon: '🔑', color: 'secondary' },
  };
  return map[action] || { icon: '•', color: 'secondary' };
}

function toggleMrOtherBox() {
  const checked = document.getElementById('mrOther').checked;
  document.getElementById('mrOtherBox').style.display = checked ? '' : 'none';
}

// ─── RFID ─────────────────────────────────────────────────────────────────────
async function loadRfidDisplay(ferretId) {
  const el = document.getElementById('rfidDisplay');
  if (!el) return;
  try {
    const rfids = await api(`/ferrets/${ferretId}/rfid`);
    const active = rfids.find(r => !r.unassigned_date);
    const history = rfids.filter(r => r.unassigned_date);
    if (!active && !history.length) {
      el.innerHTML = '<div class="text-muted small text-center py-2">No RFID chip assigned</div>';
      return;
    }
    el.innerHTML = `
  ${active ? `
    <div class="d-flex align-items-center gap-2 mb-2">
      <span class="badge bg-success">Active</span>
      <code class="fs-6 fw-bold">${active.rfid}</code>
      ${canUpdate() ? `<button class="btn btn-sm btn-outline-danger ms-auto" onclick="unassignRfid(${ferretId})"><i class="bi bi-x-circle me-1"></i>Unassign</button>` : ''}
    </div>
    <div class="text-muted small">Assigned ${fmtDate(active.assigned_date)}${active.reason ? ' · ' + active.reason : ''}${active.notes ? '<br>' + active.notes : ''}</div>
  ` : '<div class="text-muted small mb-2">No active chip</div>'}
  ${history.length ? `
    <details class="mt-2">
      <summary class="text-muted small" style="cursor:pointer">History (${history.length})</summary>
      <table class="table table-sm mt-1 mb-0">
        <thead><tr><th>RFID</th><th>Assigned</th><th>Unassigned</th><th>Reason</th></tr></thead>
        <tbody>${history.map(r => `
          <tr class="text-muted small">
            <td><code>${r.rfid}</code></td>
            <td>${fmtDate(r.assigned_date)}</td>
            <td>${fmtDate(r.unassigned_date)}</td>
            <td>${r.reason || '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </details>` : ''}`;
  } catch (err) {
    el.innerHTML = '<div class="text-danger small">Failed to load RFID data</div>';
  }
}

function openRfidModal(ferretId) {
  document.getElementById('rfidFerretId').value = ferretId;
  document.getElementById('rfidValue').value = '';
  document.getElementById('rfidReason').value = '';
  document.getElementById('rfidNotes').value = '';
  new bootstrap.Modal(document.getElementById('rfidModal')).show();
}

async function submitRfid() {
  const ferretId = document.getElementById('rfidFerretId').value;
  const rfid = document.getElementById('rfidValue').value.trim();
  if (!rfid) return alert('Please enter an RFID value.');
  try {
    await api(`/ferrets/${ferretId}/rfid`, {
      method: 'POST', body: {
        rfid,
        reason: document.getElementById('rfidReason').value || null,
        notes: document.getElementById('rfidNotes').value || null
      }
    });
    bootstrap.Modal.getInstance(document.getElementById('rfidModal')).hide();
    loadRfidDisplay(ferretId);
  } catch (err) { alert(err.message); }
}

async function unassignRfid(ferretId) {
  if (!confirm('Unassign the active RFID chip from this ferret?')) return;
  try {
    await api(`/ferrets/${ferretId}/rfid/unassign`, { method: 'PUT', body: { reason: 'manual_unassign' } });
    loadRfidDisplay(ferretId);
  } catch (err) { alert(err.message); }
}

// ─── Dashboard Ferret Lookup (Name + RFID) ────────────────────────────────────
let _nfcReader = null, _nfcActive = false;

function initDashLookups() {
  const nameInput = document.getElementById('dashNameLookupInput');
  const rfidInput = document.getElementById('dashRfidLookupInput');
  if (!nameInput || !rfidInput) return;

  document.getElementById('dashNameLookupResult').innerHTML = '';
  nameInput.value = '';
  document.getElementById('dashRfidLookupResult').innerHTML = '';
  rfidInput.value = '';

  const banner = document.getElementById('dashNfcStatusBanner');
  banner.classList.add('d-none');
  if ('NDEFReader' in window) {
    document.getElementById('dashNfcScanWrap').classList.remove('d-none');
    banner.textContent = '✅ Web NFC is supported on this device.';
    banner.className = 'alert alert-success py-2 small mb-2';
    banner.classList.remove('d-none');
  } else {
    document.getElementById('dashNfcScanWrap').classList.add('d-none');
    banner.innerHTML = '⚠️ Web NFC is not available in this browser. Use a USB RFID wedge reader or type the chip value manually.';
    banner.className = 'alert alert-warning py-2 small mb-2';
    banner.classList.remove('d-none');
  }
}

async function doDashNameLookup() {
  const val = document.getElementById('dashNameLookupInput').value.trim();
  if (!val) return;
  const resultEl = document.getElementById('dashNameLookupResult');
  resultEl.innerHTML = '<div class="text-center text-muted py-2"><div class="spinner-border spinner-border-sm me-2"></div>Searching…</div>';
  try {
    const matches = await api('/ferrets?search=' + encodeURIComponent(val));
    if (!matches.length) {
      resultEl.innerHTML = `
        <div class="alert alert-danger d-flex align-items-center gap-2 py-2 small mb-0">
          <i class="bi bi-exclamation-octagon-fill"></i>
          <div>No ferret found matching "${val}".</div>
        </div>`;
    } else if (matches.length === 1) {
      resultEl.innerHTML = '';
      loadFerretDetail(matches[0].id);
    } else {
      resultEl.innerHTML = `
        <div class="text-muted small mb-2">${matches.length} matches — pick one:</div>
        <div class="list-group">
          ${matches.slice(0, 8).map(f => `
            <button type="button" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
              onclick="loadFerretDetail(${f.id})">
              <span><strong>${f.name}</strong> ${f.animal_id ? `<span class="text-muted small">· ID ${f.animal_id}</span>` : ''}</span>
              <i class="bi bi-chevron-right text-muted"></i>
            </button>`).join('')}
        </div>`;
    }
  } catch (err) {
    resultEl.innerHTML = `<div class="alert alert-warning py-2 small mb-0">Error: ${err.message}</div>`;
  }
}

async function doDashRfidLookup(rfidOverride) {
  const val = (rfidOverride || document.getElementById('dashRfidLookupInput').value).trim();
  if (!val) return;
  const resultEl = document.getElementById('dashRfidLookupResult');
  resultEl.innerHTML = '<div class="text-center text-muted py-2"><div class="spinner-border spinner-border-sm me-2"></div>Looking up…</div>';
  try {
    const f = await api(`/rfid/lookup/${encodeURIComponent(val)}`);
    resultEl.innerHTML = '';
    loadFerretDetail(f.id);
  } catch (err) {
    if (err.message === 'unassigned' || err.message.includes('404') || err.message.includes('not found')) {
      resultEl.innerHTML = `
        <div class="alert alert-danger d-flex align-items-center gap-2 py-2 small mb-0">
          <i class="bi bi-exclamation-octagon-fill"></i>
          <div>No ferret is currently assigned to a chip ending in <code>${val}</code>.</div>
        </div>`;
    } else if (err.message.includes('Multiple active chips')) {
      resultEl.innerHTML = `
        <div class="alert alert-warning d-flex align-items-center gap-2 py-2 small mb-0">
          <i class="bi bi-exclamation-triangle-fill"></i>
          <div>${err.message}</div>
        </div>`;
    } else {
      resultEl.innerHTML = `<div class="alert alert-warning py-2 small mb-0">Error: ${err.message}</div>`;
    }
  }
}

async function toggleDashNfcScan() {
  if (_nfcActive) {
    _nfcActive = false;
    _nfcReader = null;
    document.getElementById('dashNfcScanBtn').innerHTML = '<i class="bi bi-broadcast me-1"></i>Start NFC Scan';
    document.getElementById('dashNfcScanBtn').classList.remove('btn-danger');
    document.getElementById('dashNfcScanBtn').classList.add('btn-outline-primary');
    document.getElementById('dashNfcScanStatus').textContent = '';
    return;
  }
  try {
    _nfcReader = new NDEFReader();
    await _nfcReader.scan();
    _nfcActive = true;
    document.getElementById('dashNfcScanBtn').innerHTML = '<i class="bi bi-stop-circle me-1"></i>Stop Scanning';
    document.getElementById('dashNfcScanBtn').classList.remove('btn-outline-primary');
    document.getElementById('dashNfcScanBtn').classList.add('btn-danger');
    document.getElementById('dashNfcScanStatus').innerHTML = '<span class="spinner-grow spinner-grow-sm text-danger me-1"></span>Scanning…';

    _nfcReader.addEventListener('reading', ({ serialNumber }) => {
      const rfid = (serialNumber || '').replace(/:/g, '').toUpperCase();
      if (!rfid) return;
      document.getElementById('dashRfidLookupInput').value = rfid;
      doDashRfidLookup(rfid);
      _nfcActive = false;
      _nfcReader = null;
      document.getElementById('dashNfcScanBtn').innerHTML = '<i class="bi bi-broadcast me-1"></i>Start NFC Scan';
      document.getElementById('dashNfcScanBtn').classList.remove('btn-danger');
      document.getElementById('dashNfcScanBtn').classList.add('btn-outline-primary');
      document.getElementById('dashNfcScanStatus').textContent = `Read: ${rfid}`;
    });

    _nfcReader.addEventListener('error', (e) => {
      document.getElementById('dashNfcScanStatus').textContent = 'NFC error: ' + e.message;
      _nfcActive = false;
    });
  } catch (err) {
    document.getElementById('dashNfcScanStatus').textContent = 'NFC unavailable: ' + err.message;
    _nfcActive = false;
  }
}

// ─── Distribution (ferret-level) ──────────────────────────────────────────────
async function openDistributeModal(ferretId, ferretName) {
  document.getElementById('distFerretId').value = ferretId;
  document.getElementById('distFerretName').textContent = `Distributing: ${ferretName}`;
  document.getElementById('distDate').value = today();
  document.getElementById('distPrice').value = '';
  document.getElementById('distNotes').value = '';
  try {
    const distributors = await api('/distributors');
    document.getElementById('distDistributorId').innerHTML =
      distributors.map(d => `<option value="${d.distributor_id}">${d.distributor_name}</option>`).join('');
    new bootstrap.Modal(document.getElementById('distributeModal')).show();
  } catch (err) { alert(err.message); }
}

async function submitDistribute() {
  const ferretId = document.getElementById('distFerretId').value;
  const distId = document.getElementById('distDistributorId').value;
  const date = document.getElementById('distDate').value;
  const price = document.getElementById('distPrice').value;
  const notes = document.getElementById('distNotes').value;
  if (!distId || !date) return alert('Distributor and date are required.');
  try {
    await api(`/ferrets/${ferretId}/distribute`, {
      method: 'POST',
      body: {
        distributor_id: parseInt(distId), distribution_date: date,
        price: price ? parseFloat(price) : null, notes: notes || null
      }
    });
    bootstrap.Modal.getInstance(document.getElementById('distributeModal')).hide();
    loadFerretDetail(ferretId);
  } catch (err) { alert(err.message); }
}

async function undoDistribute(ferretId) {
  if (!confirm('Undo this distribution? The ferret will be returned to active status.')) return;
  try {
    await api(`/ferrets/${ferretId}/distribute/undo`, { method: 'PUT', body: {} });
    loadFerretDetail(ferretId);
  } catch (err) { alert(err.message); }
}

async function loadFerretDistHistory(ferretId) {
  const el = document.getElementById('distFerretHistory');
  if (!el) return;
  try {
    const events = await api(`/ferrets/${ferretId}/distribution`);
    if (!events.length) {
      el.innerHTML = '<p class="text-muted small">This ferret has no distribution records.</p>';
      return;
    }
    el.innerHTML = `
      <table class="table table-sm">
        <thead><tr><th>Date</th><th>Distributor</th><th>Price</th><th>Notes</th><th>Recorded By</th></tr></thead>
        <tbody>
          ${events.map(e => `
            <tr>
              <td>${fmtDate(e.distribution_date)}</td>
              <td><strong>${e.distributor_name}</strong><br><span class="text-muted small">${e.distributor_address || ''}</span></td>
              <td>${e.price != null ? '$' + parseFloat(e.price).toFixed(2) : '—'}</td>
              <td class="small">${e.notes || '—'}</td>
              <td class="text-muted small">${e.recorded_by || '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    el.innerHTML = '<div class="text-danger small">Failed to load distribution records.</div>';
  }
}

// ─── 8-Hour Light Toggle ──────────────────────────────────────────────────────
async function toggleEightHourLight(ferretId, enabled) {
  try {
    await api(`/ferrets/${ferretId}`, { method: 'PUT', body: { eight_hour_light: enabled ? 1 : 0 } });
  } catch (err) {
    alert(err.message);
    const toggle = document.getElementById('eightHourLightToggle');
    if (toggle) toggle.checked = !enabled;
  }
}

async function toggleBreedingRetired(ferretId, enabled) {
  try {
    await api(`/ferrets/${ferretId}/breeding-retired`, { method: 'PUT', body: { breeding_retired: enabled } });
    loadFerretDetail(ferretId);
  } catch (err) {
    alert(err.message);
    const toggle = document.getElementById('breedingRetiredToggle');
    if (toggle) toggle.checked = !enabled;
  }
}

// ─── Photo ────────────────────────────────────────────────────────────────────
function previewPhoto(input, previewId) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById(previewId).innerHTML =
      `<img src="${e.target.result}" style="max-height:120px;max-width:100%;border-radius:8px">`;
  };
  reader.readAsDataURL(file);
}

function openPhotoModal(ferretId) {
  document.getElementById('photoFerretId').value = ferretId;
  document.getElementById('photoPreviewBox').innerHTML = '';
  document.getElementById('photoFileInput').value = '';
  document.getElementById('photoCameraInput').value = '';
  new bootstrap.Modal(document.getElementById('photoModal')).show();
}

async function submitPhoto() {
  const ferretId = document.getElementById('photoFerretId').value;
  const file = document.getElementById('photoCameraInput').files[0]
    || document.getElementById('photoFileInput').files[0];
  if (!file) return alert('Please take or select a photo first.');
  const fd = new FormData();
  fd.append('photo', file);
  try {
    await apiUpload(`/ferrets/${ferretId}/photo`, fd);
    bootstrap.Modal.getInstance(document.getElementById('photoModal')).hide();
    loadFerretDetail(ferretId);
  } catch (err) { alert(err.message); }
}

// ─── Ferret Actions ───────────────────────────────────────────────────────────
async function saveBirthDate(id) {
  const val = document.getElementById('editBirthDate').value;
  if (!val) return alert('Please enter a valid date.');
  try {
    await api(`/ferrets/${id}`, { method: 'PUT', body: { birth_date: val } });
    loadFerretDetail(id);
  } catch (err) { alert(err.message); }
}

async function saveDeathDate(id) {
  const val = document.getElementById('editDeathDate').value;
  try {
    await api(`/ferrets/${id}`, { method: 'PUT', body: { death_date: val || null } });
    loadFerretDetail(id);
  } catch (err) { alert(err.message); }
}

async function saveSex(id) {
  const val = document.getElementById('editSex').value;
  try {
    await api(`/ferrets/${id}`, { method: 'PUT', body: { sex: val || null } });
    loadFerretDetail(id);
  } catch (err) { alert(err.message); }
}

function openDeceasedModal(ferretId) {
  document.getElementById('deceasedFerretId').value = ferretId;
  document.getElementById('deceasedDate').value = today();
  document.getElementById('deceasedCause').value = '';
  new bootstrap.Modal(document.getElementById('deceasedModal')).show();
}

async function submitMarkDeceased() {
  const id = document.getElementById('deceasedFerretId').value;
  const death_date = document.getElementById('deceasedDate').value;
  const cause_of_death = document.getElementById('deceasedCause').value.trim();
  if (!death_date) return alert('Please enter a date of death.');
  try {
    await api(`/ferrets/${id}/deceased`, { method: 'PUT', body: { death_date, cause_of_death: cause_of_death || null } });
    bootstrap.Modal.getInstance(document.getElementById('deceasedModal')).hide();
    loadFerretDetail(id);
  } catch (err) { alert(err.message); }
}

async function toggleDead(id, current) {
  if (!confirm('Mark this ferret as active? This will clear the deceased status.')) return;
  try {
    await api(`/ferrets/${id}`, { method: 'PUT', body: { dead: '0', death_date: null } });
    loadFerretDetail(id);
  } catch (err) { alert(err.message); }
}

async function deleteFerret(id) {
  if (!confirm('Permanently delete this ferret and all related records?')) return;
  try { await api(`/ferrets/${id}`, { method: 'DELETE' }); nav('ferrets'); }
  catch (err) { alert(err.message); }
}

// ─── Add Ferret Modal ─────────────────────────────────────────────────────────
async function openFerretModal() {
  try {
    const [addresses, suppliers] = await Promise.all([api('/addresses'), api('/suppliers')]);
    document.getElementById('fAddrId').innerHTML =
      '<option value="">— Unassigned —</option>' +
      addresses.map(a => `<option value="${a.address_id}">Room ${a.room_id}${a.room_name ? ' ' + a.room_name : ''} · ${a.cage_address || '?'}${a.room_lighting ? ' · ' + a.room_lighting : ''}</option>`).join('');
    document.getElementById('fSupplierId').innerHTML =
      '<option value="">— Unknown —</option>' +
      suppliers.map(s => `<option value="${s.supplier_id}">${s.supplier_name}</option>`).join('');
    ['fName', 'fAnimalId', 'fDesc', 'fMother', 'fFather', 'fAcqBy'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('fBirthDate').value = today();
    document.getElementById('fWeight').value = '0';
    document.getElementById('fVaccine').value = '';
    document.getElementById('fSex').value = '';
    document.getElementById('fSpayed').value = 'n';
    document.getElementById('fSpayDate').value = '';
    document.getElementById('fSpayDateRow').style.display = 'none';
    document.getElementById('fPhotoPreview').innerHTML = '';
    document.getElementById('fPhotoFile').value = '';
    document.getElementById('fSpayed').onchange = function () {
      document.getElementById('fSpayDateRow').style.display = this.value === 'y' ? '' : 'none';
    };
    new bootstrap.Modal(document.getElementById('ferretModal')).show();
  } catch (err) { alert(err.message); }
}

async function submitFerret() {
  const name = document.getElementById('fName').value.trim();
  const bd = document.getElementById('fBirthDate').value;
  if (!name || !bd) return alert('Name and birth date are required.');
  try {
    const r = await api('/ferrets', {
      method: 'POST', body: {
        ferret_name: name,
        animal_id: document.getElementById('fAnimalId').value || null,
        birth_date: bd,
        weight: parseInt(document.getElementById('fWeight').value) || 0,
        description: document.getElementById('fDesc').value || null,
        address_id: document.getElementById('fAddrId').value || null,
        supplier_id: document.getElementById('fSupplierId').value || null,
        mother_name: document.getElementById('fMother').value || null,
        father_name: document.getElementById('fFather').value || null,
        next_rabies_vaccine_due: document.getElementById('fVaccine').value || null,
        acquisition_by: document.getElementById('fAcqBy').value || null,
        sex: document.getElementById('fSex').value || null,
        castrated_or_spayed: document.getElementById('fSpayed').value,
        castration_or_spay_date: document.getElementById('fSpayDate').value || null
      }
    });
    const photoFile = document.getElementById('fPhotoFile').files[0];
    if (photoFile && r.id) {
      const fd = new FormData(); fd.append('photo', photoFile);
      await apiUpload(`/ferrets/${r.id}/photo`, fd);
    }
    bootstrap.Modal.getInstance(document.getElementById('ferretModal')).hide();
    loadFerrets();
  } catch (err) { alert(err.message); }
}