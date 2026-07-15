// SanusBio v1.9.0 | 2026-07-15 | app-medical.js
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
    // Sort: mated females first, then by name
    const mated = females.filter(f => f.female_status === 'mated');
    const others = females.filter(f => f.female_status !== 'mated');
    const sorted = [...mated, ...others];
    document.getElementById('litJillSelect').innerHTML =
      (mated.length ? `<optgroup label="── Mated (priority) ──">` +
        mated.map(f => `<option value="${f.id}">${f.name} (ID: ${f.animal_id || '—'}) ★ Mated</option>`).join('') +
        `</optgroup>` : '') +
      (others.length ? `<optgroup label="── Other Females ──">` +
        others.map(f => `<option value="${f.id}">${f.name} (ID: ${f.animal_id || '—'})${f.female_status && f.female_status !== 'baseline' ? ' [' + f.female_status + ']' : ''}</option>`).join('') +
        `</optgroup>` : '');
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
        orders: document.getElementById('medOrders').value || null,
        treatments: document.getElementById('medTreatments').value || null
      }
    });
    bootstrap.Modal.getInstance(document.getElementById('medModal')).hide();
    loadFerretDetail(ferretId);
  } catch (err) { alert(err.message); }
}

// ─── Exam / Health Check Notes ────────────────────────────────────────────────
function openExamNoteModal(ferretId) {
  document.getElementById('enFerretId').value = ferretId;
  document.getElementById('enDate').value = today();
  document.getElementById('enWeight').value = '';
  document.getElementById('enStatus').value = '';
  document.getElementById('enPerformedBy').value = '';
  document.getElementById('enNotes').value = '';
  new bootstrap.Modal(document.getElementById('examNoteModal')).show();
}

async function submitExamNote() {
  const ferretId = document.getElementById('enFerretId').value;
  const exam_date = document.getElementById('enDate').value;
  if (!exam_date) return alert('Exam date is required.');
  try {
    await api(`/ferrets/${ferretId}/exam-notes`, {
      method: 'POST', body: {
        exam_date,
        weight_grams: document.getElementById('enWeight').value || null,
        status: document.getElementById('enStatus').value || null,
        notes: document.getElementById('enNotes').value || null,
        performed_by: document.getElementById('enPerformedBy').value || null
      }
    });
    bootstrap.Modal.getInstance(document.getElementById('examNoteModal')).hide();
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

// ─── Reproductive Events ──────────────────────────────────────────────────────
const REPRO_STATUS_META = {
  baseline: { label: 'Baseline', color: 'secondary', icon: 'bi-circle' },
  estrus: { label: 'In Estrus', color: 'danger', icon: 'bi-heart-fill' },
  mated: { label: 'Mated', color: 'warning', icon: 'bi-arrow-through-heart-fill' },
  littered: { label: 'Littered', color: 'success', icon: 'bi-egg-fill' },
  weaned: { label: 'Weaned', color: 'info', icon: 'bi-check-circle-fill' },
};

function reproStatusBadge(status) {
  if (!status || status === 'baseline') return '';
  const m = REPRO_STATUS_META[status] || { label: status, color: 'secondary', icon: 'bi-circle' };
  return `<span class="badge bg-${m.color} badge-pill small"><i class="bi ${m.icon} me-1"></i>${m.label}</span>`;
}

function openReproModal(ferretId) {
  document.getElementById('reproFerretId').value = ferretId;
  document.getElementById('reproDate').value = today();
  document.getElementById('reproType').value = 'estrus';
  document.getElementById('reproPartnerRow').style.display = 'none';
  document.getElementById('reproNotes').value = '';
  document.getElementById('reproPartnerSelect').innerHTML = '<option value="">— None —</option>';
  new bootstrap.Modal(document.getElementById('reproModal')).show();
}

async function onReproTypeChange() {
  const type = document.getElementById('reproType').value;
  const partnerRow = document.getElementById('reproPartnerRow');
  if (type === 'mated') {
    partnerRow.style.display = '';
    try {
      const ferrets = await api('/ferrets');
      const males = ferrets.filter(f => f.sex === 'male' && f.dead !== '1');
      document.getElementById('reproPartnerSelect').innerHTML =
        '<option value="">— Unknown / Not recorded —</option>' +
        males.map(m => `<option value="${m.id}">${m.name} (ID: ${m.animal_id || '—'})</option>`).join('');
    } catch { /* non-fatal */ }
  } else {
    partnerRow.style.display = 'none';
  }
}

async function submitReproEvent() {
  const ferretId = document.getElementById('reproFerretId').value;
  const event_type = document.getElementById('reproType').value;
  const event_date = document.getElementById('reproDate').value;
  const partner_id = document.getElementById('reproPartnerSelect').value || null;
  const notes = document.getElementById('reproNotes').value.trim();
  if (!event_date) return alert('Date is required.');
  try {
    const r = await api(`/ferrets/${ferretId}/reproductive`, {
      method: 'POST', body: { event_type, event_date, partner_id: partner_id ? parseInt(partner_id) : null, notes: notes || null }
    });
    bootstrap.Modal.getInstance(document.getElementById('reproModal')).hide();
    loadFerretDetail(ferretId);
  } catch (err) { alert(err.message); }
}

async function deleteReproEvent(ferretId, eventId) {
  if (!confirm('Delete this reproductive event? The ferret status will be recalculated.')) return;
  try {
    await api(`/ferrets/${ferretId}/reproductive/${eventId}`, { method: 'DELETE' });
    loadFerretDetail(ferretId);
  } catch (err) { alert(err.message); }
}

// ─── Mating History ───────────────────────────────────────────────────────────
async function openMatingModal(ferretId) {
  document.getElementById('matingFerretId').value = ferretId;
  document.getElementById('matingDate').value = today();
  document.getElementById('matingNotes').value = '';
  try {
    const ferrets = await api('/ferrets');
    const current = ferrets.find(f => f.id === ferretId);
    if (!current?.sex) return alert("This ferret's sex must be set before recording a mating.");
    const partnerSex = current.sex === 'male' ? 'female' : 'male';
    const partners = ferrets.filter(f => f.sex === partnerSex && f.dead !== '1' && !f.distributed);
    document.getElementById('matingPartnerLabel').textContent = partnerSex === 'male' ? 'Male Partner' : 'Female Partner';
    document.getElementById('matingPartnerSelect').innerHTML =
      '<option value="">— Select —</option>' +
      partners.map(p => `<option value="${p.id}">${p.name} (ID: ${p.animal_id || '—'})</option>`).join('');
    new bootstrap.Modal(document.getElementById('matingModal')).show();
  } catch (err) { alert(err.message); }
}

async function submitMatingRecord() {
  const ferretId = document.getElementById('matingFerretId').value;
  const partner_id = document.getElementById('matingPartnerSelect').value;
  const event_date = document.getElementById('matingDate').value;
  const notes = document.getElementById('matingNotes').value.trim();
  if (!partner_id) return alert('Please select a partner.');
  if (!event_date) return alert('Date is required.');
  try {
    await api(`/ferrets/${ferretId}/matings`, {
      method: 'POST', body: { partner_id: parseInt(partner_id), event_date, notes: notes || null }
    });
    bootstrap.Modal.getInstance(document.getElementById('matingModal')).hide();
    loadFerretDetail(ferretId);
  } catch (err) { alert(err.message); }
}

// ─── Mating Restrictions ──────────────────────────────────────────────────────
async function saveMatingRestriction(ferretId) {
  const flags = [...document.querySelectorAll('.mr-flag:checked')].map(el => el.value);
  const otherText = flags.includes('other')
    ? (document.getElementById('matingRestrictionText')?.value.trim() || '')
    : '';
  try {
    await api(`/ferrets/${ferretId}/mating-restriction`, {
      method: 'PUT', body: {
        mating_restriction_flags: flags.length ? flags.join(',') : null,
        mating_restriction: otherText || null
      }
    });
    document.getElementById('matingRestrictionSaved').style.display = '';
    setTimeout(() => { const el = document.getElementById('matingRestrictionSaved'); if (el) el.style.display = 'none'; }, 2500);
  } catch (err) { alert(err.message); }
}