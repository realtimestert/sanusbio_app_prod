// SanusBio v2.0-beta.3 | 2026-08-19 | app-reports.js
// Reports tab: Ferrets by Room, Reproductive Status, Deaths, Infant Mortality,
// Distribution. Every report renders as a plain table inside #reportContent so
// the browser's native print (window.print()) produces a clean printout —
// .no-print elements are hidden via @media print rules in style.css.

let _reportTab = 'room';

function loadReports() {
  const from = document.getElementById('repDateFrom');
  const to = document.getElementById('repDateTo');
  if (from) from.value = '';
  if (to) to.value = '';
  switchReportTab('room');
}

function switchReportTab(tab) {
  _reportTab = tab;
  const order = ['room', 'repro', 'deaths', 'infant', 'distribution'];
  document.querySelectorAll('#reportTabs .nav-link').forEach((btn, i) => {
    btn.classList.toggle('active', order[i] === tab);
  });
  const dateCard = document.getElementById('reportDateFilterCard');
  if (dateCard) dateCard.style.display = (tab === 'deaths' || tab === 'infant' || tab === 'distribution') ? '' : 'none';
  loadCurrentReport();
}

async function loadCurrentReport() {
  const el = document.getElementById('reportContent');
  if (!el) return;
  el.innerHTML = '<div class="text-center py-5 text-muted"><div class="spinner-border" role="status"></div></div>';
  try {
    if (_reportTab === 'room') await renderRoomReport(el);
    else if (_reportTab === 'repro') await renderReproReport(el);
    else if (_reportTab === 'deaths') await renderDeathsReport(el);
    else if (_reportTab === 'infant') await renderInfantMortalityReport(el);
    else if (_reportTab === 'distribution') await renderDistributionReport(el);
  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
  }
}

// Age in weeks, one decimal place — matches ferretAge() in app-ferrets.js
function reportAgeWeeks(birthDate, endDate) {
  if (!birthDate) return '—';
  const birth = new Date(birthDate);
  const end = endDate ? new Date(endDate) : new Date();
  const totalDays = Math.floor((end - birth) / 864e5);
  if (totalDays < 0) return '—';
  return (totalDays / 7).toFixed(1);
}

function reportDateRangeLabel(from, to) {
  if (!from && !to) return 'All time';
  return `${from ? fmtDate(from) : 'Earliest'} – ${to ? fmtDate(to) : 'Present'}`;
}

// ─── Ferrets by Room ───────────────────────────────────────────────────────
async function renderRoomReport(el) {
  const rows = await api('/reports/ferrets-by-room');
  const total = rows.reduce((s, r) => s + r.ferret_count, 0);
  el.innerHTML = `
    <div class="card">
      <div class="card-header bg-white py-3 d-flex align-items-center">
        <span class="fw-semibold">Active Ferrets by Room</span>
        <span class="text-muted small ms-2">Generated ${fmtDate(today())}</span>
      </div>
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead><tr><th>Room</th><th>Ferret Count</th></tr></thead>
          <tbody>${rows.length ? rows.map(r => `
            <tr><td>Room ${r.room_id}${r.room_name ? ' ' + r.room_name : ''}</td><td>${r.ferret_count}</td></tr>`).join('')
      : '<tr><td colspan="2" class="text-muted text-center py-3">No rooms configured.</td></tr>'}
          </tbody>
          <tfoot><tr class="fw-semibold"><td>Total</td><td>${total}</td></tr></tfoot>
        </table>
      </div>
    </div>`;
}

// ─── Reproductive Status ─────────────────────────────────────────────────────
async function renderReproReport(el) {
  const rows = await api('/females/estrus');
  const META = { estrus: 'In Estrus', mated: 'Mated', littered: 'Littered', weaned: 'Weaned' };
  const counts = { estrus: 0, mated: 0, littered: 0, weaned: 0 };
  rows.forEach(f => { if (counts[f.status] !== undefined) counts[f.status]++; });
  el.innerHTML = `
    <div class="card mb-3">
      <div class="card-header bg-white py-3 d-flex align-items-center">
        <span class="fw-semibold">Reproductive Status Summary</span>
        <span class="text-muted small ms-2">Generated ${fmtDate(today())}</span>
      </div>
      <div class="card-body">
        <div class="row g-3 text-center">
          ${Object.keys(META).map(k => `
            <div class="col-6 col-md-3">
              <div class="fs-2 fw-bold">${counts[k]}</div>
              <div class="text-muted small">${META[k]}</div>
            </div>`).join('')}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-header bg-white py-3"><span class="fw-semibold">Females on Reproductive Status Board</span></div>
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead><tr><th>Female</th><th>Status</th><th>Since</th><th>Location</th><th>Notes</th></tr></thead>
          <tbody>${rows.length ? rows.map(f => `
            <tr>
              <td><strong>${f.name}</strong> <span class="text-muted small">${f.animal_id || ''}</span></td>
              <td>${META[f.status] || f.status}</td>
              <td>${fmtDate(f.status_since)}</td>
              <td class="small text-muted">Room ${f.room_id || '?'} · ${f.cage_address || '?'}</td>
              <td class="small text-muted">${f.status_notes || '—'}</td>
            </tr>`).join('') : '<tr><td colspan="5" class="text-muted text-center py-3">No females currently active on the board.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ─── Deaths ────────────────────────────────────────────────────────────────
async function renderDeathsReport(el) {
  const from = document.getElementById('repDateFrom').value;
  const to = document.getElementById('repDateTo').value;
  const params = new URLSearchParams();
  if (from) params.set('date_from', from);
  if (to) params.set('date_to', to);
  const rows = await api('/reports/deaths' + (params.toString() ? '?' + params.toString() : ''));
  el.innerHTML = `
    <div class="card">
      <div class="card-header bg-white py-3 d-flex align-items-center">
        <span class="fw-semibold">Deaths</span>
        <span class="badge bg-secondary ms-2">${rows.length}</span>
        <span class="text-muted small ms-2">${reportDateRangeLabel(from, to)}</span>
      </div>
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead><tr><th>Name</th><th>Age at Death (wk)</th><th>Date of Death</th><th>Notes / Cause</th></tr></thead>
          <tbody>${rows.length ? rows.map(f => `
            <tr>
              <td><strong>${f.name}</strong> <span class="text-muted small">${f.animal_id || ''}</span></td>
              <td>${reportAgeWeeks(f.birth_date, f.death_date)}</td>
              <td>${fmtDate(f.death_date)}</td>
              <td class="small">${f.cause_of_death || '—'}</td>
            </tr>`).join('') : '<tr><td colspan="4" class="text-muted text-center py-3">No deaths in this range.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ─── Distribution ────────────────────────────────────────────────────────────
async function renderDistributionReport(el) {
  const from = document.getElementById('repDateFrom')?.value;
  const to = document.getElementById('repDateTo')?.value;
  // Use existing distribution-events endpoint (limit high for report)
  let rows = await api('/distribution-events?limit=2000');
  if (from) rows = rows.filter(r => r.distribution_date && String(r.distribution_date).slice(0, 10) >= from);
  if (to) rows = rows.filter(r => r.distribution_date && String(r.distribution_date).slice(0, 10) <= to);

  // Group by distributor for summary
  const byDist = {};
  rows.forEach(r => {
    const k = r.distributor_name || 'Unknown';
    if (!byDist[k]) byDist[k] = { name: k, count: 0, total: 0 };
    byDist[k].count++;
    if (r.price != null) byDist[k].total += Number(r.price) || 0;
  });
  const summary = Object.values(byDist).sort((a, b) => b.count - a.count);

  el.innerHTML = `
    <div class="card mb-3">
      <div class="card-header bg-white py-3 d-flex align-items-center">
        <span class="fw-semibold">Distribution Summary</span>
        <span class="badge bg-secondary ms-2">${rows.length}</span>
        <span class="text-muted small ms-2">${reportDateRangeLabel(from, to)}</span>
      </div>
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead><tr><th>Distributor</th><th>Ferrets</th><th>Total Price</th></tr></thead>
          <tbody>${summary.length ? summary.map(s => `
            <tr>
              <td>${s.name}</td>
              <td>${s.count}</td>
              <td>${s.total ? '$' + s.total.toFixed(2) : '—'}</td>
            </tr>`).join('') : '<tr><td colspan="3" class="text-muted text-center py-3">No distributions in this range.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="card-header bg-white py-3">
        <span class="fw-semibold">Distribution Detail</span>
        <span class="text-muted small ms-2">Generated ${fmtDate(today())}</span>
      </div>
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead>
            <tr>
              <th>Date</th>
              <th>Ferret</th>
              <th>Sex</th>
              <th>Distributor</th>
              <th>Price</th>
              <th>Notes</th>
              <th>Recorded By</th>
            </tr>
          </thead>
          <tbody>${rows.length ? rows.map(r => `
            <tr>
              <td>${fmtDate(r.distribution_date)}</td>
              <td><strong>${r.ferret_name}</strong> <span class="text-muted small">${r.animal_id || ''}</span></td>
              <td>${r.sex || '—'}</td>
              <td>${r.distributor_name || '—'}</td>
              <td>${r.price != null ? '$' + Number(r.price).toFixed(2) : '—'}</td>
              <td class="small">${r.dist_notes || r.notes || '—'}</td>
              <td class="small text-muted">${r.recorded_by || '—'}</td>
            </tr>`).join('') : '<tr><td colspan="7" class="text-muted text-center py-3">No distributions in this range.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ─── Infant Mortality ────────────────────────────────────────────────────────
const IM_CAUSE_LABELS = {
  mother_ate: 'Mother ate / cannibalized',
  fell_from_cage: 'Fell from cage',
  crushed: 'Crushed / overlain',
  failure_to_thrive: 'Failure to thrive',
  unknown: 'Unknown',
  other: 'Other'
};

async function renderInfantMortalityReport(el) {
  const from = document.getElementById('repDateFrom').value;
  const to = document.getElementById('repDateTo').value;
  const params = new URLSearchParams();
  if (from) params.set('date_from', from);
  if (to) params.set('date_to', to);
  const { kit_deaths, stillborns } = await api('/reports/infant-mortality' + (params.toString() ? '?' + params.toString() : ''));

  const counts = {};
  kit_deaths.forEach(k => { counts[k.cause_category] = (counts[k.cause_category] || 0) + 1; });
  const totalStillborn = stillborns.reduce((s, l) => s + (l.stillborn || 0), 0);

  el.innerHTML = `
    <div class="card mb-3">
      <div class="card-header bg-white py-3 d-flex align-items-center">
        <span class="fw-semibold">Infant Mortality Summary</span>
        <span class="text-muted small ms-2">${reportDateRangeLabel(from, to)}</span>
      </div>
      <div class="card-body">
        <div class="row g-3 text-center">
          <div class="col-6 col-md-3"><div class="fs-2 fw-bold">${totalStillborn}</div><div class="text-muted small">Stillborn</div></div>
          ${Object.keys(IM_CAUSE_LABELS).map(k => `
            <div class="col-6 col-md-3"><div class="fs-2 fw-bold">${counts[k] || 0}</div><div class="text-muted small">${IM_CAUSE_LABELS[k]}</div></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="card mb-3">
      <div class="card-header bg-white py-3"><span class="fw-semibold">Post-Birth Kit Deaths</span><span class="badge bg-secondary ms-2">${kit_deaths.length}</span></div>
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead><tr><th>Date</th><th>Litter</th><th>Jill</th><th>Cause</th><th>Notes</th></tr></thead>
          <tbody>${kit_deaths.length ? kit_deaths.map(k => `
            <tr>
              <td>${fmtDate(k.death_date)}</td>
              <td>${k.litter_id || '—'}</td>
              <td>${k.jill_name}</td>
              <td>${IM_CAUSE_LABELS[k.cause_category] || k.cause_category}</td>
              <td class="small">${k.notes || '—'}</td>
            </tr>`).join('') : '<tr><td colspan="5" class="text-muted text-center py-3">No kit deaths in this range.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="card-header bg-white py-3"><span class="fw-semibold">Stillborn by Litter</span><span class="badge bg-secondary ms-2">${totalStillborn}</span></div>
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead><tr><th>Litter Date</th><th>Litter</th><th>Jill</th><th>Stillborn</th></tr></thead>
          <tbody>${stillborns.length ? stillborns.map(l => `
            <tr>
              <td>${fmtDate(l.litter_date)}</td>
              <td>${l.litter_id || '—'}</td>
              <td>${l.jill_name}</td>
              <td>${l.stillborn}</td>
            </tr>`).join('') : '<tr><td colspan="4" class="text-muted text-center py-3">No stillborn kits in this range.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}