// SanusBio v2.1-beta.0 | 2026-08-21 | app-stats.js
// Statistics tab: Overview, Age Lists, Population Pyramid, Health, Genetics, Reproduction

let _statsTab = 'overview';
let _statsAgeResults = [];
let _pyramidChart = null;

function loadStatistics() {
  switchStatsTab(_statsTab || 'overview');
}

function switchStatsTab(tab) {
  _statsTab = tab;
  document.querySelectorAll('#statsTabs .nav-link').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.statsTab === tab);
  });
  document.querySelectorAll('.stats-panel').forEach(p => {
    p.style.display = p.id === 'stats-' + tab ? '' : 'none';
  });

  if (tab === 'overview') loadStatsOverview();
  else if (tab === 'age') { /* wait for Apply */ }
  else if (tab === 'population') loadStatsPopulation();
  else if (tab === 'health') loadStatsHealth();
  else if (tab === 'genetics') loadStatsGenetics();
  else if (tab === 'reproduction') loadStatsReproduction();
}

// ── Overview ────────────────────────────────────────────────────────────────
async function loadStatsOverview() {
  const el = document.getElementById('statsOverviewCards');
  if (!el) return;
  el.innerHTML = '<div class="col-12 text-center text-muted py-4"><div class="spinner-border spinner-border-sm"></div></div>';
  try {
    const d = await api('/stats/overview');
    const live = d.live || {};
    const ped = d.pedigree || {};
    const breed = d.active_breeding || {};
    el.innerHTML = `
      <div class="col-6 col-md-3">
        <div class="card h-100"><div class="card-body text-center">
          <div class="fs-3 fw-bold">${live.total ?? '—'}</div>
          <div class="text-muted small">Live Ferrets</div>
          <div class="small mt-1">${live.females ?? 0} ♀ · ${live.males ?? 0} ♂</div>
        </div></div>
      </div>
      <div class="col-6 col-md-3">
        <div class="card h-100"><div class="card-body text-center">
          <div class="fs-3 fw-bold">${live.sex_ratio_f_to_m != null ? live.sex_ratio_f_to_m : '—'}</div>
          <div class="text-muted small">Sex Ratio (F:M)</div>
          <div class="small mt-1">${live.littered ?? 0} littered · ${live.sourced ?? 0} sourced</div>
        </div></div>
      </div>
      <div class="col-6 col-md-3">
        <div class="card h-100"><div class="card-body text-center">
          <div class="fs-3 fw-bold">${ped.pct_complete ?? '—'}%</div>
          <div class="text-muted small">Pedigree Complete</div>
          <div class="small mt-1">${ped.both_parents ?? 0} both · ${ped.one_parent ?? 0} one · ${ped.no_parents ?? 0} none</div>
        </div></div>
      </div>
      <div class="col-6 col-md-3">
        <div class="card h-100"><div class="card-body text-center">
          <div class="fs-3 fw-bold">${breed.total ?? '—'}</div>
          <div class="text-muted small">Active Breeding</div>
          <div class="small mt-1">${breed.females ?? 0} ♀ · ${breed.males ?? 0} ♂</div>
        </div></div>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="col-12"><div class="alert alert-danger">${err.message}</div></div>`;
  }
}

// ── Age Lists ───────────────────────────────────────────────────────────────
async function loadStatsAgeList() {
  const minVal = document.getElementById('statsAgeMin').value;
  const maxVal = document.getElementById('statsAgeMax').value;
  const unit = document.getElementById('statsAgeUnit').value;
  const sexRaw = document.getElementById('statsAgeSex').value;
  const status = document.getElementById('statsAgeStatus').value;
  const acq = document.getElementById('statsAgeAcq').value;

  const params = new URLSearchParams();
  if (minVal !== '') {
    if (unit === 'months') params.set('min_age_months', minVal);
    else params.set('min_age_weeks', minVal);
  }
  if (maxVal !== '') {
    if (unit === 'months') params.set('max_age_months', maxVal);
    else params.set('max_age_weeks', maxVal);
  }
  if (sexRaw === 'female' || sexRaw === 'male') params.set('sex', sexRaw);
  if (status) params.set('status', status);
  if (acq) params.set('acquisition_class', acq);

  const tbody = document.getElementById('statsAgeTable');
  const countEl = document.getElementById('statsAgeCount');
  tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4"><div class="spinner-border spinner-border-sm"></div></td></tr>';

  try {
    const data = await api('/stats/age-list?' + params.toString());
    _statsAgeResults = data.ferrets || [];
    countEl.textContent = data.count || 0;
    if (!_statsAgeResults.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-muted text-center py-4">No ferrets match these filters.</td></tr>';
      return;
    }
    tbody.innerHTML = _statsAgeResults.map(f => `
      <tr style="cursor:pointer" onclick="loadFerretDetail(${f.id})">
        <td class="font-monospace small">${f.animal_id || '—'}</td>
        <td><strong>${f.name || '—'}</strong></td>
        <td>${f.sex === 'female' ? '♀' : f.sex === 'male' ? '♂' : '—'}</td>
        <td>${f.age_weeks != null ? f.age_weeks : '—'}</td>
        <td>${f.age_months != null ? f.age_months : '—'}</td>
        <td><span class="badge bg-secondary bg-opacity-10 text-secondary">${f.status}</span></td>
        <td>${f.weight != null ? f.weight + ' g' : '—'}</td>
        <td class="small text-muted">${f.room_id != null ? 'R' + f.room_id + (f.cage_address ? ' ' + f.cage_address : '') : '—'}</td>
        <td><i class="bi bi-chevron-right text-muted"></i></td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-danger text-center py-3">${err.message}</td></tr>`;
  }
}

function exportStatsAgeCsv() {
  if (!_statsAgeResults.length) return alert('No results to export. Apply filters first.');
  const header = ['animal_id', 'name', 'sex', 'age_weeks', 'age_months', 'status', 'weight', 'room', 'acquisition_class'];
  const lines = [header.join(',')];
  for (const f of _statsAgeResults) {
    const room = f.room_id != null ? `R${f.room_id}${f.cage_address ? ' ' + f.cage_address : ''}` : '';
    lines.push([
      f.animal_id || '',
      csvEsc(f.name),
      f.sex || '',
      f.age_weeks ?? '',
      f.age_months ?? '',
      f.status || '',
      f.weight ?? '',
      csvEsc(room),
      f.acquisition_class || ''
    ].join(','));
  }
  downloadCsv('ferret-age-list.csv', lines.join('\n'));
}

function csvEsc(v) {
  if (v == null) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Population Pyramid ──────────────────────────────────────────────────────
async function loadStatsPopulation() {
  const cardsEl = document.getElementById('statsPopCards');
  if (cardsEl) cardsEl.innerHTML = '<div class="col-12 text-center text-muted py-2"><div class="spinner-border spinner-border-sm"></div></div>';

  try {
    const data = await api('/stats/population-pyramid');
    const bins = data.bins || [];
    const total = data.total_animals || 0;

    if (cardsEl) {
      const males = bins.reduce((s, b) => s + b.male, 0);
      const females = bins.reduce((s, b) => s + b.female, 0);
      cardsEl.innerHTML = `
        <div class="col-md-4"><div class="card"><div class="card-body text-center">
          <div class="fs-4 fw-bold">${total}</div><div class="text-muted small">Live animals in pyramid</div>
        </div></div></div>
        <div class="col-md-4"><div class="card"><div class="card-body text-center">
          <div class="fs-4 fw-bold">${females} ♀ · ${males} ♂</div><div class="text-muted small">Sex split</div>
        </div></div></div>
        <div class="col-md-4"><div class="card"><div class="card-body text-center">
          <div class="fs-4 fw-bold">8-wk bins · 256+</div><div class="text-muted small">As of ${data.as_of || 'today'}</div>
        </div></div></div>`;
    }

    renderPyramidChart(bins);
  } catch (err) {
    if (cardsEl) cardsEl.innerHTML = `<div class="col-12"><div class="alert alert-danger">${err.message}</div></div>`;
  }
}

function renderPyramidChart(bins) {
  const canvas = document.getElementById('pyramidChart');
  if (!canvas || typeof Chart === 'undefined') return;

  // Reverse so youngest is at top (classic pyramid feel) or keep chronological — show oldest at top
  // Standard population pyramid has youngest at bottom. Chart.js bar with indexAxis:'y' draws first label at top.
  // We'll put 256+ at top and 0–8 at bottom by reversing.
  const labels = bins.map(b => b.bin_label).reverse();
  const maleData = bins.map(b => -b.male).reverse();   // negative for left side
  const femaleData = bins.map(b => b.female).reverse();

  if (_pyramidChart) {
    _pyramidChart.destroy();
    _pyramidChart = null;
  }

  _pyramidChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Male',
          data: maleData,
          backgroundColor: 'rgba(54, 162, 235, 0.75)',
          borderColor: 'rgba(54, 162, 235, 1)',
          borderWidth: 1,
          borderSkipped: false
        },
        {
          label: 'Female',
          data: femaleData,
          backgroundColor: 'rgba(255, 99, 132, 0.75)',
          borderColor: 'rgba(255, 99, 132, 1)',
          borderWidth: 1,
          borderSkipped: false
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label(ctx) {
              const v = Math.abs(ctx.raw);
              return `${ctx.dataset.label}: ${v}`;
            }
          }
        }
      },
      scales: {
        x: {
          stacked: false,
          ticks: {
            callback(val) { return Math.abs(val); }
          },
          title: { display: true, text: 'Number of ferrets' }
        },
        y: {
          stacked: false,
          title: { display: true, text: 'Age (weeks)' }
        }
      }
    }
  });
}

// ── Health ──────────────────────────────────────────────────────────────────
async function loadStatsHealth() {
  loadStatsDeathSummary();
  // Weight alerts wait for Apply (thresholds already filled with defaults)
}

async function loadStatsDeathSummary() {
  const ageEl = document.getElementById('statsDeathSummary');
  const codEl = document.getElementById('statsCodSummary');
  try {
    const d = await api('/stats/death-summary');
    const ov = d.overall || {};
    const st = d.by_stage || {};

    if (ageEl) {
      ageEl.innerHTML = `
        <div class="mb-3">
          <div class="text-muted small">Overall (n=${d.total_deaths || 0})</div>
          <div><strong>Avg</strong> ${ov.avg_age_weeks ?? '—'} wk &nbsp;·&nbsp; <strong>Median</strong> ${ov.median_age_weeks ?? '—'} wk</div>
        </div>
        <div class="row g-2 small">
          <div class="col-4">
            <div class="border rounded p-2 text-center">
              <div class="fw-semibold">Kit</div>
              <div>${st.kit?.count ?? 0}</div>
              <div class="text-muted">avg ${st.kit?.avg_age_weeks ?? '—'} wk</div>
            </div>
          </div>
          <div class="col-4">
            <div class="border rounded p-2 text-center">
              <div class="fw-semibold">Juvenile</div>
              <div>${st.juvenile?.count ?? 0}</div>
              <div class="text-muted">avg ${st.juvenile?.avg_age_weeks ?? '—'} wk</div>
            </div>
          </div>
          <div class="col-4">
            <div class="border rounded p-2 text-center">
              <div class="fw-semibold">Adult</div>
              <div>${st.adult?.count ?? 0}</div>
              <div class="text-muted">avg ${st.adult?.avg_age_weeks ?? '—'} wk</div>
            </div>
          </div>
        </div>
        <div class="text-muted small mt-2">${d.life_stage_note || ''}</div>
        ${d.mortality_by_year?.length ? `
          <hr>
          <div class="fw-semibold small mb-1">Mortality by year</div>
          <div class="table-responsive">
            <table class="table table-sm mb-0">
              <thead><tr><th>Year</th><th>Deaths</th><th>Avg age (wk)</th></tr></thead>
              <tbody>
                ${d.mortality_by_year.slice(0, 10).map(y => `
                  <tr><td>${y.year}</td><td>${y.deaths}</td><td>${y.avg_age_weeks ?? '—'}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>` : ''}`;
    }

    if (codEl) {
      const causes = d.causes || [];
      if (!causes.length) {
        codEl.innerHTML = '<div class="text-muted text-center py-3">No cause-of-death data recorded.</div>';
      } else {
        codEl.innerHTML = `
          <div class="table-responsive">
            <table class="table table-sm mb-0">
              <thead><tr><th>Cause</th><th>Count</th></tr></thead>
              <tbody>
                ${causes.slice(0, 20).map(c => `
                  <tr><td class="small">${c.cause}</td><td>${c.count}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>`;
      }
    }
  } catch (err) {
    if (ageEl) ageEl.innerHTML = `<div class="text-danger">${err.message}</div>`;
    if (codEl) codEl.innerHTML = `<div class="text-danger">${err.message}</div>`;
  }
}

async function loadStatsWeightAlerts() {
  const suddenPct = document.getElementById('statsSuddenPct').value || 10;
  const suddenDays = document.getElementById('statsSuddenDays').value || 14;
  const gradualPct = document.getElementById('statsGradualPct').value || 5;
  const gradualDays = document.getElementById('statsGradualDays').value || 28;
  const tbody = document.getElementById('statsWeightTable');
  tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3"><div class="spinner-border spinner-border-sm"></div></td></tr>';

  try {
    const params = new URLSearchParams({
      sudden_pct: suddenPct,
      sudden_days: suddenDays,
      gradual_pct: gradualPct,
      gradual_days: gradualDays
    });
    const data = await api('/stats/weight-alerts?' + params.toString());
    const alerts = data.alerts || [];
    if (!alerts.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-muted text-center py-3">No weight-change alerts with current thresholds.</td></tr>';
      return;
    }
    const label = {
      sudden_drop: '<span class="badge bg-danger">Sudden drop</span>',
      sudden_gain: '<span class="badge bg-warning text-dark">Sudden gain</span>',
      gradual_decline: '<span class="badge bg-secondary">Gradual decline</span>'
    };
    tbody.innerHTML = alerts.map(a => `
      <tr style="cursor:pointer" onclick="loadFerretDetail(${a.id})">
        <td class="font-monospace small">${a.animal_id || '—'}</td>
        <td><strong>${a.name}</strong></td>
        <td>${label[a.alert] || a.alert}</td>
        <td class="${a.delta_pct < 0 ? 'text-danger' : 'text-success'}">${a.delta_pct > 0 ? '+' : ''}${a.delta_pct}%</td>
        <td>${a.window_days} d</td>
        <td>${a.current_weight != null ? a.current_weight + ' g' : '—'}</td>
        <td><i class="bi bi-chevron-right text-muted"></i></td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-danger text-center py-3">${err.message}</td></tr>`;
  }
}

// ── Genetics ────────────────────────────────────────────────────────────────
async function loadStatsGenetics() {
  loadStatsHighCoi();
}

async function loadStatsCoi() {
  const q = (document.getElementById('statsCoiAid').value || '').trim();
  const el = document.getElementById('statsCoiResult');
  if (!q) return;
  el.innerHTML = '<div class="spinner-border spinner-border-sm"></div>';
  try {
    // Resolve AID or name → internal id
    const id = await resolveFerretId(q);
    if (!id) {
      el.innerHTML = '<span class="text-danger">Ferret not found.</span>';
      return;
    }
    const d = await api('/stats/genetics/coi/' + id);
    const interp = d.interpretation || {};
    el.innerHTML = `
      <div class="mb-1"><strong>${d.name}</strong> <span class="text-muted">(${d.animal_id || id})</span></div>
      <div class="fs-5">CoI = <strong>${d.coi_pct}%</strong>
        <span class="badge bg-secondary ms-1">${interp.label || interp.level || ''}</span>
      </div>
      <div class="text-muted">${interp.detail || ''}</div>
      <div class="small mt-1">Parents known: ${d.parents_known}/2</div>`;
  } catch (err) {
    el.innerHTML = `<span class="text-danger">${err.message}</span>`;
  }
}

async function loadStatsRelatedness() {
  const aQ = (document.getElementById('statsRelA').value || '').trim();
  const bQ = (document.getElementById('statsRelB').value || '').trim();
  const el = document.getElementById('statsRelResult');
  if (!aQ || !bQ) return;
  el.innerHTML = '<div class="spinner-border spinner-border-sm"></div>';
  try {
    const idA = await resolveFerretId(aQ);
    const idB = await resolveFerretId(bQ);
    if (!idA || !idB) {
      el.innerHTML = '<span class="text-danger">One or both ferrets not found.</span>';
      return;
    }
    const d = await api(`/stats/genetics/relatedness?a=${idA}&b=${idB}`);
    const interp = typeof d.interpretation === 'string' ? d.interpretation : (d.interpretation?.label || d.interpretation?.detail || '');
    el.innerHTML = `
      <div class="mb-1">${d.a.name} ↔ ${d.b.name}</div>
      <div class="fs-5">R = <strong>${d.relatedness_pct}%</strong></div>
      <div class="text-muted small">${interp}</div>
      <div class="small mt-1">CoI A: ${d.a.coi_pct}% · CoI B: ${d.b.coi_pct}%</div>`;
  } catch (err) {
    el.innerHTML = `<span class="text-danger">${err.message}</span>`;
  }
}

async function loadStatsHighCoi() {
  const threshold = document.getElementById('statsCoiThreshold')?.value || '0.125';
  const tbody = document.getElementById('statsHighCoiTable');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3"><div class="spinner-border spinner-border-sm"></div></td></tr>';
  try {
    const data = await api(`/stats/genetics/high-coi?threshold=${threshold}&live_only=1`);
    const animals = data.animals || [];
    if (!animals.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-muted text-center py-3">No live animals above this threshold.</td></tr>';
      return;
    }
    tbody.innerHTML = animals.map(a => `
      <tr style="cursor:pointer" onclick="loadFerretDetail(${a.id})">
        <td class="font-monospace small">${a.animal_id || '—'}</td>
        <td><strong>${a.name}</strong></td>
        <td>${a.sex === 'female' ? '♀' : a.sex === 'male' ? '♂' : '—'}</td>
        <td>${a.coi_pct}%</td>
        <td><span class="badge bg-secondary bg-opacity-10 text-secondary">${a.interpretation || ''}</span></td>
        <td class="small text-muted">${(a.mother_id ? 1 : 0) + (a.father_id ? 1 : 0)}/2</td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-danger text-center py-3">${err.message}</td></tr>`;
  }
}

function exportStatsCoiCsv() {
  const threshold = document.getElementById('statsCoiThreshold')?.value || '0';
  // Trigger download via the API endpoint
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  const url = `/api/stats/genetics/export-coi?threshold=${threshold}&live_only=0`;
  // Use fetch + blob so auth header is sent
  fetch(url, { headers: { Authorization: 'Bearer ' + token } })
    .then(r => {
      if (!r.ok) throw new Error('Export failed');
      return r.text();
    })
    .then(text => downloadCsv('coi-export.csv', text))
    .catch(err => alert(err.message));
}

/** Resolve animal_id, name, or numeric id to Ferret_QR005_id */
async function resolveFerretId(query) {
  if (!query) return null;
  // Numeric internal id
  if (/^\d+$/.test(query) && query.length < 6) {
    // Could be either animal_id or internal id — try detail first
    try {
      const f = await api('/ferrets/' + query);
      if (f && f.Ferret_QR005_id) return f.Ferret_QR005_id;
    } catch (_) { /* fall through */ }
  }
  // Search by name or animal_id
  try {
    const list = await api('/ferrets?search=' + encodeURIComponent(query));
    if (Array.isArray(list) && list.length) {
      // Prefer exact animal_id or name match
      const exact = list.find(f =>
        String(f.animal_id) === query ||
        (f.ferret_name && f.ferret_name.toLowerCase() === query.toLowerCase()) ||
        (f.name && f.name.toLowerCase() === query.toLowerCase())
      );
      const hit = exact || list[0];
      return hit.Ferret_QR005_id || hit.id;
    }
  } catch (_) {}
  return null;
}

// ── Reproduction ────────────────────────────────────────────────────────────
async function loadStatsReproduction() {
  const cardsEl = document.getElementById('statsReproCards');
  const jillsEl = document.getElementById('statsTopJills');
  const hobsEl = document.getElementById('statsTopHobs');
  try {
    const d = await api('/stats/reproduction');
    const afl = d.age_at_first_litter || {};
    const ls = d.litter_stats || {};

    if (cardsEl) {
      cardsEl.innerHTML = `
        <div class="col-md-3"><div class="card"><div class="card-body text-center">
          <div class="fs-4 fw-bold">${afl.avg_weeks ?? '—'}</div>
          <div class="text-muted small">Avg age at first litter (wk)</div>
          <div class="small">median ${afl.median_weeks ?? '—'} · n=${afl.count ?? 0}</div>
        </div></div></div>
        <div class="col-md-3"><div class="card"><div class="card-body text-center">
          <div class="fs-4 fw-bold">${ls.avg_kits_born ?? '—'}</div>
          <div class="text-muted small">Avg kits born / litter</div>
          <div class="small">${ls.litter_count ?? 0} litters</div>
        </div></div></div>
        <div class="col-md-3"><div class="card"><div class="card-body text-center">
          <div class="fs-4 fw-bold">${ls.avg_surviving ?? '—'}</div>
          <div class="text-muted small">Avg surviving / litter</div>
        </div></div></div>
        <div class="col-md-3"><div class="card"><div class="card-body text-center">
          <div class="fs-4 fw-bold">${ls.avg_stillborn ?? '—'}</div>
          <div class="text-muted small">Avg stillborn / litter</div>
        </div></div></div>`;
    }

    if (jillsEl) {
      const jills = d.top_jills || [];
      jillsEl.innerHTML = jills.length
        ? jills.map((j, i) => `
          <tr style="cursor:pointer" onclick="loadFerretDetail(${j.id})">
            <td>${i + 1}</td>
            <td class="font-monospace small">${j.animal_id || '—'}</td>
            <td><strong>${j.name}</strong></td>
            <td>${j.offspring}</td>
          </tr>`).join('')
        : '<tr><td colspan="4" class="text-muted text-center py-3">No data.</td></tr>';
    }
    if (hobsEl) {
      const hobs = d.top_hobs || [];
      hobsEl.innerHTML = hobs.length
        ? hobs.map((h, i) => `
          <tr style="cursor:pointer" onclick="loadFerretDetail(${h.id})">
            <td>${i + 1}</td>
            <td class="font-monospace small">${h.animal_id || '—'}</td>
            <td><strong>${h.name}</strong></td>
            <td>${h.offspring}</td>
          </tr>`).join('')
        : '<tr><td colspan="4" class="text-muted text-center py-3">No data.</td></tr>';
    }
  } catch (err) {
    if (cardsEl) cardsEl.innerHTML = `<div class="col-12"><div class="alert alert-danger">${err.message}</div></div>`;
  }
}
