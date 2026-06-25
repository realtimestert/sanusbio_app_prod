// SanusBio v1.2.0 | app-cleaning.js
// Cleaning Report Form, Speech Input, Signature Pad, Report History

// ─── State ────────────────────────────────────────────────────────────────────
let _crSigCanvas, _crSigCtx, _crSigDrawing = false, _crSigHasData = false;
let _crSpeechRecognition = null, _crSpeechActive = false;
let _crSelectedRooms = new Set();
let _crIssueTagsSelected = new Set();

// ─── Load Page ────────────────────────────────────────────────────────────────
async function loadCleaningReports() {
  if (['admin', 'research'].includes(USER?.role)) {
    document.getElementById('crHistorySection').classList.remove('d-none');
    loadCrHistory();
  }
  try {
    const rooms = await api('/rooms');
    const container = document.getElementById('crRoomList');
    if (!rooms.length) {
      container.innerHTML = '<span class="text-muted small">No rooms configured yet. Ask an admin to add locations.</span>';
    } else {
      container.innerHTML = rooms.map(r => `
    <button type="button" class="btn btn-outline-secondary px-4 py-2 fw-semibold cr-room-btn"
      data-room="${r}" onclick="toggleCrRoom(this, ${r})"
      style="border-radius:10px; font-size:1rem;">
      Room ${r}
    </button>`).join('');
    }
  } catch (err) { console.error(err); }

  const nameEl = document.getElementById('crReporterName');
  if (nameEl && (USER?.full_name || USER?.username)) {
    nameEl.value = USER.full_name || USER.username;
  }

  setTimeout(initCrSigPad, 80);
}

// ─── Room Selection ───────────────────────────────────────────────────────────
function toggleCrRoom(btn, roomId) {
  if (_crSelectedRooms.has(roomId)) {
    _crSelectedRooms.delete(roomId);
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-outline-secondary');
  } else {
    _crSelectedRooms.add(roomId);
    btn.classList.remove('btn-outline-secondary');
    btn.classList.add('btn-primary');
  }
}

// ─── Checkbox Toggles ─────────────────────────────────────────────────────────
function toggleCrCheck(checkId, boxId) {
  const cb = document.getElementById(checkId);
  const box = document.getElementById(boxId);
  const checkEl = document.getElementById(checkId + 'Check');
  cb.checked = !cb.checked;
  if (cb.checked) {
    box.style.borderColor = '#198754';
    box.style.background = '#f0fff4';
    checkEl.style.background = '#198754';
    checkEl.style.borderColor = '#198754';
    checkEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="white"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/></svg>';
  } else {
    box.style.borderColor = '#dee2e6';
    box.style.background = '#f8f9fa';
    checkEl.style.background = '#fff';
    checkEl.style.borderColor = '#adb5bd';
    checkEl.innerHTML = '';
  }
}

// ─── Issue Tags ───────────────────────────────────────────────────────────────
function toggleCrIssueTag(btn, tag) {
  if (_crIssueTagsSelected.has(tag)) {
    _crIssueTagsSelected.delete(tag);
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-outline-secondary');
  } else {
    _crIssueTagsSelected.add(tag);
    btn.classList.remove('btn-outline-secondary');
    btn.classList.add('btn-primary');
  }
  const textarea = document.getElementById('crIssues');
  const tagPrefix = _crIssueTagsSelected.size ? [..._crIssueTagsSelected].join(', ') + ': ' : '';
  const withoutPrefix = textarea.value.replace(/^[^:]+: /, '');
  textarea.value = tagPrefix + (withoutPrefix && _crIssueTagsSelected.size ? withoutPrefix : (!_crIssueTagsSelected.size ? withoutPrefix : ''));
}

// ─── Speech Input ─────────────────────────────────────────────────────────────
function toggleCrSpeech() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    alert('Speech recognition is not supported in this browser. Please type your answer.');
    return;
  }
  if (_crSpeechActive) { _crSpeechRecognition && _crSpeechRecognition.stop(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  _crSpeechRecognition = new SR();
  _crSpeechRecognition.continuous = true;
  _crSpeechRecognition.interimResults = true;
  _crSpeechRecognition.lang = 'en-US';
  const textarea = document.getElementById('crIssues');
  const micBtn = document.getElementById('crMicBtn');
  const micStatus = document.getElementById('crMicStatus');
  const baseText = textarea.value;
  _crSpeechActive = true;
  micBtn.style.color = '#dc3545';
  micStatus.style.display = 'block';
  _crSpeechRecognition.onresult = e => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    textarea.value = baseText + final + interim;
  };
  _crSpeechRecognition.onend = () => { _crSpeechActive = false; micBtn.style.color = '#6c757d'; micStatus.style.display = 'none'; };
  _crSpeechRecognition.onerror = () => { _crSpeechActive = false; micBtn.style.color = '#6c757d'; micStatus.style.display = 'none'; };
  _crSpeechRecognition.start();
}

// ─── Signature Pad ────────────────────────────────────────────────────────────
function initCrSigPad() {
  _crSigCanvas = document.getElementById('crSigCanvas');
  if (!_crSigCanvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = _crSigCanvas.getBoundingClientRect();
  _crSigCanvas.width = (rect.width || 640) * dpr;
  _crSigCanvas.height = (rect.height || 180) * dpr;
  _crSigCtx = _crSigCanvas.getContext('2d');
  _crSigCtx.scale(dpr, dpr);
  _crSigCtx.strokeStyle = '#1a1a2e';
  _crSigCtx.lineWidth = 2.5;
  _crSigCtx.lineCap = 'round';
  _crSigCtx.lineJoin = 'round';
  _crSigHasData = false;

  function getPos(e) {
    const r = _crSigCanvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  }
  function start(e) {
    e.preventDefault(); _crSigDrawing = true;
    const { x, y } = getPos(e);
    _crSigCtx.beginPath(); _crSigCtx.moveTo(x, y);
    document.getElementById('crSigPlaceholder').style.display = 'none';
    _crSigHasData = true;
  }
  function move(e) { e.preventDefault(); if (!_crSigDrawing) return; const { x, y } = getPos(e); _crSigCtx.lineTo(x, y); _crSigCtx.stroke(); }
  function end(e) { e.preventDefault(); _crSigDrawing = false; }

  _crSigCanvas.addEventListener('mousedown', start);
  _crSigCanvas.addEventListener('mousemove', move);
  _crSigCanvas.addEventListener('mouseup', end);
  _crSigCanvas.addEventListener('mouseleave', end);
  _crSigCanvas.addEventListener('touchstart', start, { passive: false });
  _crSigCanvas.addEventListener('touchmove', move, { passive: false });
  _crSigCanvas.addEventListener('touchend', end, { passive: false });
}

function clearCrSignature() {
  if (!_crSigCanvas || !_crSigCtx) return;
  _crSigCtx.clearRect(0, 0, _crSigCanvas.width, _crSigCanvas.height);
  _crSigHasData = false;
  document.getElementById('crSigPlaceholder').style.display = '';
}

// ─── Submit ───────────────────────────────────────────────────────────────────
async function submitCleaningReport() {
  const errEl = document.getElementById('crFormError');
  errEl.classList.add('d-none');

  const reporterName = document.getElementById('crReporterName').value.trim();
  if (!reporterName) { errEl.textContent = 'Please enter your name.'; errEl.classList.remove('d-none'); return; }
  if (!_crSelectedRooms.size) { errEl.textContent = 'Please select at least one room.'; errEl.classList.remove('d-none'); return; }
  if (!document.getElementById('crCage').checked) { errEl.textContent = 'Please confirm inside cage cleaning.'; errEl.classList.remove('d-none'); return; }
  if (!document.getElementById('crTray').checked) { errEl.textContent = 'Please confirm tray cleaning.'; errEl.classList.remove('d-none'); return; }
  if (!document.getElementById('crFloor').checked) { errEl.textContent = 'Please confirm sweeping, scraping, and mopping.'; errEl.classList.remove('d-none'); return; }
  if (!document.getElementById('crFood').checked) { errEl.textContent = 'Please confirm food and water check.'; errEl.classList.remove('d-none'); return; }
  if (!_crSigHasData) { errEl.textContent = 'Please sign the form before submitting.'; errEl.classList.remove('d-none'); return; }

  const issueText = document.getElementById('crIssues').value.trim();
  const hadIssues = issueText.length > 0 || _crIssueTagsSelected.size > 0;
  const sigData = _crSigCanvas.toDataURL('image/png');

  try {
    await api('/cleaning-reports', {
      method: 'POST', body: {
        reporter_name: reporterName,
        rooms_cleaned: [..._crSelectedRooms],
        inside_cage_cleaning: true,
        tray_cleaning: true,
        sweeping_mopping: true,
        food_water_check: true,
        had_issues: hadIssues,
        issue_description: issueText || null,
        signature_data: sigData
      }
    });
    document.getElementById('crFormWrap').style.display = 'none';
    document.getElementById('crSuccess').classList.remove('d-none');
    if (['admin', 'research'].includes(USER?.role)) loadCrHistory();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('d-none');
  }
}

// ─── Reset Form ───────────────────────────────────────────────────────────────
function resetCleaningForm() {
  _crSelectedRooms.clear();
  _crIssueTagsSelected.clear();
  document.getElementById('crSuccess').classList.add('d-none');
  document.getElementById('crFormWrap').style.display = '';
  document.getElementById('crIssues').value = '';
  document.getElementById('crFormError').classList.add('d-none');
  const nameEl = document.getElementById('crReporterName');
  if (nameEl) nameEl.value = USER?.full_name || USER?.username || '';
  document.querySelectorAll('.cr-room-btn').forEach(b => {
    b.classList.remove('btn-primary'); b.classList.add('btn-outline-secondary');
  });
  document.querySelectorAll('.cr-issue-tag').forEach(b => {
    b.classList.remove('btn-primary'); b.classList.add('btn-outline-secondary');
  });
  ['crCage', 'crTray', 'crFloor', 'crFood'].forEach(id => {
    const cb = document.getElementById(id); if (cb) cb.checked = false;
    const box = document.getElementById(id + 'Box');
    if (box) { box.style.borderColor = '#dee2e6'; box.style.background = '#f8f9fa'; }
    const checkEl = document.getElementById(id + 'Check');
    if (checkEl) { checkEl.style.background = '#fff'; checkEl.style.borderColor = '#adb5bd'; checkEl.innerHTML = ''; }
  });
  clearCrSignature();
  setTimeout(initCrSigPad, 50);
}

// ─── Report History (admin/research) ─────────────────────────────────────────
async function loadCrHistory() {
  try {
    const rooms = await api('/rooms');
    const filterEl = document.getElementById('crRoomFilter');
    if (filterEl) {
      const currentVal = filterEl.value;
      filterEl.innerHTML = '<option value="">All Rooms</option>' +
        rooms.map(r => `<option value="${r}" ${currentVal == r ? 'selected' : ''}>Room ${r}</option>`).join('');
    }
    const room = filterEl?.value || '';
    const reports = await api('/cleaning-reports' + (room ? `?room=${room}` : ''));
    const tbody = document.getElementById('crTable');
    if (!reports.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-muted text-center py-4">No cleaning reports found.</td></tr>';
      return;
    }
    const check = v => v ? '<span class="text-success fw-bold">✓</span>' : '<span class="text-danger">✗</span>';
    tbody.innerHTML = reports.map(r => `
  <tr>
    <td class="small text-muted">${fmtDT(r.submitted_at)}</td>
    <td><strong>${r.reported_by_name}</strong></td>
    <td>${r.rooms_cleaned.split(',').map(n => `<span class="badge bg-secondary me-1">Room ${n}</span>`).join('')}</td>
    <td class="text-center">${check(r.inside_cage_cleaning)}</td>
    <td class="text-center">${check(r.tray_cleaning)}</td>
    <td class="text-center">${check(r.sweeping_mopping)}</td>
    <td class="text-center">${check(r.food_water_check)}</td>
    <td>${r.had_issues
        ? `<span class="badge bg-warning text-dark">Yes</span><div class="small text-muted mt-1" style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.issue_description || ''}</div>`
        : '<span class="badge bg-success-subtle text-success border border-success-subtle">None</span>'}</td>
    <td><button class="btn btn-sm btn-outline-primary" onclick="viewCleaningReport(${r.report_id})"><i class="bi bi-eye"></i></button></td>
  </tr>`).join('');
  } catch (err) { console.error(err); }
}

async function viewCleaningReport(id) {
  try {
    const r = await api('/cleaning-reports/' + id);
    const check = v => v ? '<span class="badge bg-success">✓ Done</span>' : '<span class="badge bg-danger">✗ Not done</span>';
    document.getElementById('crDetailBody').innerHTML = `
  <div class="row g-3">
    <div class="col-md-6"><strong>Name:</strong> ${r.reported_by_name}</div>
    <div class="col-md-6"><strong>Submitted:</strong> ${fmtDT(r.submitted_at)}</div>
    <div class="col-12"><strong>Rooms:</strong> ${r.rooms_cleaned.split(',').map(n => `<span class="badge bg-secondary me-1">Room ${n}</span>`).join('')}</div>
    <div class="col-md-6"><strong>Inside Cage Cleaning:</strong> ${check(r.inside_cage_cleaning)}</div>
    <div class="col-md-6"><strong>Tray Cleaning:</strong> ${check(r.tray_cleaning)}</div>
    <div class="col-md-6"><strong>Sweeping &amp; Mopping:</strong> ${check(r.sweeping_mopping)}</div>
    <div class="col-md-6"><strong>Food &amp; Water Check:</strong> ${check(r.food_water_check)}</div>
    ${r.had_issues ? `
    <div class="col-12">
      <strong>Issues Reported:</strong>
      <div class="border rounded p-3 bg-light mt-1" style="white-space:pre-wrap">${r.issue_description || '(no description)'}</div>
    </div>` : '<div class="col-12"><strong>Issues:</strong> <span class="text-success">None reported</span></div>'}
    <div class="col-12">
      <strong>Signature:</strong>
      <div class="border rounded p-2 mt-1 bg-white" style="text-align:center">
        <img src="${r.signature_data}" style="max-width:100%;max-height:180px;border-radius:6px;">
      </div>
    </div>
  </div>`;
    new bootstrap.Modal(document.getElementById('crDetailModal')).show();
  } catch (err) { alert(err.message); }
}
