// SanusBio v1.2.0 | app-medical.js
// Health Events, Vaccinations, Litters, Medical Info, Procedures

// ─── Health Event Modal ───────────────────────────────────────────────────────
function openHealthModal(ferretId) {
  document.getElementById('heFerretId').value = ferretId;
  document.getElementById('heDate').value = today();
  document.getElementById('heTime').value = nowTime();
  document.getElementById('heWeight').value = '';
  document.getElementById('heNotes').value = '';
  document.getElementById('heType').value = 'weight';
  toggleWeightRow();
  new bootstrap.Modal(document.getElementById('healthModal')).show();
}

function toggleWeightRow() {
  document.getElementById('heWeightRow').style.display =
    document.getElementById('heType').value === 'weight' ? '' : 'none';
}

async function submitHealthEvent() {
  const ferret_id = document.getElementById('heFerretId').value;
  const wt = parseFloat(document.getElementById('heWeight').value);
  if (isNaN(wt) && document.getElementById('heType').value === 'weight') return alert('Please enter a valid weight.');
  try {
    await api('/health-events', {
      method: 'POST', body: {
        ferret_id: parseInt(ferret_id),
        event_type: document.getElementById('heType').value,
        weight: document.getElementById('heType').value === 'weight' ? wt : null,
        event_date: document.getElementById('heDate').value,
        event_time: document.getElementById('heTime').value,
        notes: document.getElementById('heNotes').value
      }
    });
    bootstrap.Modal.getInstance(document.getElementById('healthModal')).hide();
    loadFerretDetail(ferret_id);
  } catch (err) { alert(err.message); }
}

// ─── Vaccination ──────────────────────────────────────────────────────────────
function toggleRabiesDue() {
  document.getElementById('vNextRabiesRow').style.display =
    document.getElementById('vType').value === 'rabies' ? '' : 'none';
}

function openVaccModal(ferretId) {
  document.getElementById('vFerretId').value = ferretId;
  document.getElementById('vDate').value = today();
  document.getElementById('vExpiry').value = '';
  document.getElementById('vNextRabies').value = '';
  document.getElementById('vNotes').value = '';
  document.getElementById('vAdministeredBy').value = '';
  document.getElementById('vType').value = 'rabies';
  toggleRabiesDue();
  new bootstrap.Modal(document.getElementById('vaccModal')).show();
}

async function submitVaccination() {
  const ferret_id = document.getElementById('vFerretId').value;
  const administered_by = document.getElementById('vAdministeredBy').value.trim();
  if (!administered_by) return alert('Please enter who administered the vaccination.');
  try {
    await api('/vaccinations', {
      method: 'POST', body: {
        ferret_id: parseInt(ferret_id),
        vaccine_type: document.getElementById('vType').value,
        vaccination_date: document.getElementById('vDate').value,
        expiration_date: document.getElementById('vExpiry').value || null,
        next_rabies_due: document.getElementById('vNextRabies').value || null,
        administered_by,
        notes: document.getElementById('vNotes').value
      }
    });
    bootstrap.Modal.getInstance(document.getElementById('vaccModal')).hide();
    loadFerretDetail(ferret_id);
  } catch (err) { alert(err.message); }
}

// ─── Litters Page ─────────────────────────────────────────────────────────────
async function loadLitters() {
  if (canUpdate()) document.getElementById('btnAddLitterMain').classList.remove('d-none');
  try {
    const litters = await api('/litters');
    const tbody = document.getElementById('litterTable');
    if (!litters.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-muted text-center py-4">No litter records yet.</td></tr>';
      return;
    }
    tbody.innerHTML = litters.map(l => `
  <tr>
    <td>${fmtDate(l.litter_date)}</td>
    <td>${l.litter_id || '—'}</td>
    <td><strong>${l.jill_name || '—'}</strong></td>
    <td>${l.father || '—'}</td>
    <td>${l.kit_count ?? '—'}</td>
    <td>${l.stillborn ?? '—'}</td>
    <td>${l.individuals_created ?? 0} / ${l.kit_count ?? '?'}</td>
    <td class="small text-muted">${l.anomalies_and_notes || '—'}</td>
    <td>
      ${canUpdate() ? `<button class="btn btn-sm btn-outline-success" onclick="openCreateFromLitter(${l.litter_log_id})"><i class="bi bi-egg me-1"></i>Create Ferrets</button>` : ''}
    </td>
  </tr>`).join('');
  } catch (err) { console.error(err); }
}

async function openGlobalLitterModal() {
  try {
    const ferrets = await api('/ferrets');
    const females = ferrets.filter(f => f.sex === 'female' && f.dead !== '1');
    document.getElementById('litJillSelect').innerHTML =
      females.map(f => `<option value="${f.id}">${f.name} (ID: ${f.animal_id || '—'})</option>`).join('');
    document.getElementById('litJillRow').style.display = '';
    document.getElementById('litFerretId').value = '';
    document.getElementById('litDate').value = today();
    document.getElementById('litId').value = '';
    document.getElementById('litKits').value = '';
    document.getElementById('litStillborn').value = 0;
    document.getElementById('litFather').value = '';
    document.getElementById('litMother').value = '';
    document.getElementById('litNotes').value = '';
    new bootstrap.Modal(document.getElementById('litterModal')).show();
  } catch (err) { alert(err.message); }
}

function openLitterModal(ferretId) {
  document.getElementById('litFerretId').value = ferretId;
  document.getElementById('litJillRow').style.display = 'none';
  document.getElementById('litDate').value = today();
  document.getElementById('litId').value = '';
  document.getElementById('litKits').value = '';
  document.getElementById('litStillborn').value = 0;
  document.getElementById('litFather').value = '';
  document.getElementById('litMother').value = '';
  document.getElementById('litNotes').value = '';
  new bootstrap.Modal(document.getElementById('litterModal')).show();
}

async function submitLitter() {
  let ferretId = document.getElementById('litFerretId').value;
  if (!ferretId) ferretId = document.getElementById('litJillSelect').value;
  if (!ferretId) return alert('Please select a jill (mother).');
  try {
    await api('/litters', {
      method: 'POST', body: {
        Ferret_QR005_id: parseInt(ferretId),
        litter_id: document.getElementById('litId').value || null,
        litter_date: document.getElementById('litDate').value,
        kit_count: parseInt(document.getElementById('litKits').value) || null,
        stillborn: parseInt(document.getElementById('litStillborn').value) || null,
        father: document.getElementById('litFather').value || null,
        mother: document.getElementById('litMother').value || null,
        anomalies_and_notes: document.getElementById('litNotes').value || null
      }
    });
    bootstrap.Modal.getInstance(document.getElementById('litterModal')).hide();
    if (_currentFerretId) loadFerretDetail(_currentFerretId);
    else loadLitters();
  } catch (err) { alert(err.message); }
}

// ─── Create Ferrets from Litter ───────────────────────────────────────────────
async function openCreateFromLitter(litterId) {
  document.getElementById('cflLitterId').value = litterId;
  try {
    const litters = await api('/litters');
    const litter = litters.find(l => l.litter_log_id === litterId);
    if (!litter) return;
    const remaining = (litter.kit_count || 0) - (litter.individuals_created || 0);
    document.getElementById('cflLitterInfo').innerHTML =
      `<strong>Litter:</strong> ${litter.litter_id || '—'} &nbsp;|&nbsp;
   <strong>Date:</strong> ${fmtDate(litter.litter_date)} &nbsp;|&nbsp;
   <strong>Jill:</strong> ${litter.jill_name} &nbsp;|&nbsp;
   <strong>Father:</strong> ${litter.father || '—'} &nbsp;|&nbsp;
   <strong>Kits remaining to create:</strong> ${remaining}`;
    document.getElementById('cflKitList').innerHTML = '';
    for (let i = 0; i < Math.max(1, remaining); i++) addKitRow();
    new bootstrap.Modal(document.getElementById('createFromLitterModal')).show();
  } catch (err) { alert(err.message); }
}

let _kitRowCount = 0;
function addKitRow() {
  _kitRowCount++;
  const div = document.createElement('div');
  div.className = 'kit-row d-flex gap-2 align-items-center flex-wrap';
  div.id = `kit-${_kitRowCount}`;
  div.innerHTML = `
<div style="flex:2;min-width:140px"><label class="form-label small mb-1">Name *</label>
  <input class="form-control form-control-sm kit-name" placeholder="Ferret name"></div>
<div style="flex:1;min-width:100px"><label class="form-label small mb-1">Animal ID</label>
  <input class="form-control form-control-sm kit-animalid" placeholder="Optional"></div>
<div style="flex:1;min-width:100px"><label class="form-label small mb-1">Sex</label>
  <select class="form-select form-select-sm kit-sex">
    <option value="">Unknown</option><option value="male">Male</option><option value="female">Female</option>
  </select></div>
<div style="flex:1;min-width:100px"><label class="form-label small mb-1">Weight (g)</label>
  <input class="form-control form-control-sm kit-weight" type="number" value="0"></div>
<button class="btn btn-sm btn-outline-danger mt-3" onclick="this.parentElement.remove()"><i class="bi bi-trash"></i></button>`;
  document.getElementById('cflKitList').appendChild(div);
}

async function submitCreateFromLitter() {
  const litterId = document.getElementById('cflLitterId').value;
  const rows = document.querySelectorAll('#cflKitList .kit-row');
  const kits = [];
  for (const row of rows) {
    const name = row.querySelector('.kit-name').value.trim();
    if (!name) return alert('Each kit must have a name.');
    kits.push({
      ferret_name: name,
      animal_id: row.querySelector('.kit-animalid').value || null,
      sex: row.querySelector('.kit-sex').value || null,
      weight: parseInt(row.querySelector('.kit-weight').value) || 0
    });
  }
  if (!kits.length) return alert('Add at least one kit.');
  try {
    const r = await api(`/litters/${litterId}/create-ferrets`, { method: 'POST', body: { kits } });
    bootstrap.Modal.getInstance(document.getElementById('createFromLitterModal')).hide();
    alert(`${r.created_ids.length} ferret(s) created successfully!`);
    loadLitters();
  } catch (err) { alert(err.message); }
}

// ─── Medical Info ─────────────────────────────────────────────────────────────
function openMedModal(ferretId, medInfoId) {
  document.getElementById('medFerretId').value = ferretId;
  document.getElementById('medInfoId').value = medInfoId;
  document.getElementById('medSpayed').value = 'n';
  document.getElementById('medSpayDate').value = '';
  document.getElementById('medExamDate').value = today();
  document.getElementById('medPerformedBy').value = '';
  document.getElementById('medExamLog').value = '';
  document.getElementById('medOrders').value = '';
  document.getElementById('medTreatments').value = '';
  new bootstrap.Modal(document.getElementById('medModal')).show();
}

async function submitMedicalInfo() {
  const ferretId = document.getElementById('medFerretId').value;
  try {
    await api(`/ferrets/${ferretId}/medical`, {
      method: 'PUT', body: {
        castrated_or_spayed: document.getElementById('medSpayed').value,
        castration_or_spay_date: document.getElementById('medSpayDate').value || null,
        last_exam_date: document.getElementById('medExamDate').value || null,
        performed_by: document.getElementById('medPerformedBy').value || null,
        exam_log: document.getElementById('medExamLog').value || null,
        orders: document.getElementById('medOrders').value || null,
        treatments: document.getElementById('medTreatments').value || null
      }
    });
    bootstrap.Modal.getInstance(document.getElementById('medModal')).hide();
    loadFerretDetail(ferretId);
  } catch (err) { alert(err.message); }
}

// ─── Procedure Modal ──────────────────────────────────────────────────────────
function openProcedureModal(ferretId) {
  document.getElementById('procFerretId').value = ferretId;
  document.getElementById('procName').value = '';
  document.getElementById('procDate').value = today();
  document.getElementById('procPerformedBy').value = '';
  document.getElementById('procNotes').value = '';
  new bootstrap.Modal(document.getElementById('procedureModal')).show();
}

async function submitProcedure() {
  const ferretId = document.getElementById('procFerretId').value;
  const name = document.getElementById('procName').value.trim();
  const date = document.getElementById('procDate').value;
  if (!name || !date) return alert('Procedure name and date are required.');
  try {
    await api(`/ferrets/${ferretId}/procedure`, {
      method: 'POST', body: {
        procedure_name: name,
        procedure_date: date,
        performed_by: document.getElementById('procPerformedBy').value || null,
        notes: document.getElementById('procNotes').value || null
      }
    });
    bootstrap.Modal.getInstance(document.getElementById('procedureModal')).hide();
    loadFerretDetail(ferretId);
  } catch (err) { alert(err.message); }
}
