const state = {
  summary: null,
  migrants: [],
  alerts: []
};

const nodes = {
  metricsGrid: document.querySelector('#metricsGrid'),
  recordsBody: document.querySelector('#recordsBody'),
  searchInput: document.querySelector('#searchInput'),
  districtFilter: document.querySelector('#districtFilter'),
  riskFilter: document.querySelector('#riskFilter'),
  refreshButton: document.querySelector('#refreshButton'),
  registrationForm: document.querySelector('#registrationForm'),
  formMessage: document.querySelector('#formMessage'),
  visitForm: document.querySelector('#visitForm'),
  visitMigrant: document.querySelector('#visitMigrant'),
  visitMessage: document.querySelector('#visitMessage'),
  signalList: document.querySelector('#signalList'),
  districtLoad: document.querySelector('#districtLoad'),
  alertList: document.querySelector('#alertList'),
  sdgGrid: document.querySelector('#sdgGrid')
};

const formatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric'
});

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadDashboard();
});

function bindEvents() {
  nodes.refreshButton.addEventListener('click', loadDashboard);
  nodes.searchInput.addEventListener('input', debounce(loadMigrants, 250));
  nodes.districtFilter.addEventListener('change', loadMigrants);
  nodes.riskFilter.addEventListener('change', loadMigrants);
  nodes.registrationForm.addEventListener('submit', handleRegistration);
  nodes.visitForm.addEventListener('submit', handleVisit);

  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      document.querySelectorAll('.nav-link').forEach(item => item.classList.remove('active'));
      link.classList.add('active');
    });
  });
}

async function loadDashboard() {
  try {
    const [summary, migrants, alerts] = await Promise.all([
      api('/api/summary'),
      api('/api/migrants'),
      api('/api/alerts')
    ]);

    state.summary = summary;
    state.migrants = migrants;
    state.alerts = alerts;

    renderMetrics(summary);
    renderRecords(migrants);
    renderDistrictOptions(summary.districtLoad);
    renderSignals(summary.diseaseSignals);
    renderDistrictLoad(summary.districtLoad);
    renderAlerts(alerts);
    renderSdg(summary.sdg);
    renderVisitOptions(migrants);
  } catch (error) {
    showMessage(nodes.formMessage, error.message, true);
  }
}

async function loadMigrants() {
  const params = new URLSearchParams({
    search: nodes.searchInput.value.trim(),
    district: nodes.districtFilter.value,
    risk: nodes.riskFilter.value
  });

  state.migrants = await api(`/api/migrants?${params}`);
  renderRecords(state.migrants);
  renderVisitOptions(state.migrants);
}

async function handleRegistration(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(nodes.registrationForm).entries());
  payload.facility = 'Digital registration desk';
  payload.diagnosis = payload.symptoms ? 'Initial screening recorded' : 'Initial screening pending';
  payload.disease_category = payload.symptoms ? 'General care' : 'General care';
  payload.test_status = 'Not required';
  payload.vaccination_status = 'Review due';

  try {
    await api('/api/migrants', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    nodes.registrationForm.reset();
    showMessage(nodes.formMessage, 'Health record created.');
    await loadDashboard();
  } catch (error) {
    showMessage(nodes.formMessage, error.message, true);
  }
}

async function handleVisit(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(nodes.visitForm).entries());
  payload.referral_needed = Boolean(payload.referral_needed);

  try {
    await api('/api/visits', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    nodes.visitForm.reset();
    showMessage(nodes.visitMessage, 'Care visit saved.');
    await loadDashboard();
  } catch (error) {
    showMessage(nodes.visitMessage, error.message, true);
  }
}

function renderMetrics(summary) {
  const metrics = [
    ['Portable records', summary.totalRecords, 'Registered workers with consent-based care history'],
    ['High-risk follow-up', summary.highRisk, 'Cases that need tighter clinical review'],
    ['Immunization known', `${summary.immunizationCoverage}%`, 'Workers with complete or current vaccine status'],
    ['Active alerts', summary.activeAlerts, 'District signals under surveillance']
  ];

  nodes.metricsGrid.innerHTML = metrics.map(([label, value, detail]) => `
    <article class="metric-card">
      <div>
        <span class="metric-label">${escapeHtml(label)}</span>
        <div class="metric-value">${escapeHtml(String(value))}</div>
        <span class="mini-label">${escapeHtml(detail)}</span>
      </div>
      <span class="metric-strip" aria-hidden="true"></span>
    </article>
  `).join('');
}

function renderRecords(records) {
  if (!records.length) {
    nodes.recordsBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">No records match the current filters.</td>
      </tr>
    `;
    return;
  }

  nodes.recordsBody.innerHTML = records.map(record => `
    <tr>
      <td>
        <span class="record-id">${escapeHtml(record.record_no)}</span>
        <span class="record-meta">${formatDate(record.created_at)}</span>
      </td>
      <td>
        <span class="record-name">${escapeHtml(record.full_name)}</span>
        <span class="record-meta">${record.age} years | ${escapeHtml(record.gender)} | ${escapeHtml(record.origin_state)}</span>
      </td>
      <td>${escapeHtml(record.current_district)}</td>
      <td>
        ${escapeHtml(record.workplace_sector)}
        <span class="record-meta">${escapeHtml(record.preferred_language || 'Language not listed')}</span>
      </td>
      <td>
        ${escapeHtml(record.last_diagnosis || 'No visit yet')}
        <span class="record-meta">${formatDate(record.last_visit)}</span>
      </td>
      <td><span class="risk-pill risk-${escapeHtml(record.risk_level)}">${escapeHtml(record.risk_level)}</span></td>
    </tr>
  `).join('');
}

function renderDistrictOptions(districts) {
  const selected = nodes.districtFilter.value || 'all';
  const districtNames = new Set([
    'Ernakulam',
    'Kozhikode',
    'Thiruvananthapuram',
    'Kollam',
    'Malappuram',
    'Thrissur',
    'Kannur',
    'Palakkad'
  ]);

  districts.forEach(item => districtNames.add(item.district));
  nodes.districtFilter.innerHTML = '<option value="all">All districts</option>'
    + [...districtNames].sort().map(district => `<option>${escapeHtml(district)}</option>`).join('');
  nodes.districtFilter.value = [...districtNames].has(selected) ? selected : 'all';
}

function renderSignals(signals) {
  nodes.signalList.innerHTML = signals.map(signal => `
    <article class="signal-item">
      <strong>${escapeHtml(signal.disease)}</strong>
      <span>${signal.cases} linked visit${signal.cases === 1 ? '' : 's'}</span>
    </article>
  `).join('');
}

function renderDistrictLoad(districts) {
  const max = Math.max(1, ...districts.map(item => item.records));
  nodes.districtLoad.innerHTML = districts.map(item => {
    const width = Math.max(10, Math.round((item.records / max) * 100));
    return `
      <div class="bar-row">
        <div class="bar-label">
          <span>${escapeHtml(item.district)}</span>
          <span>${item.records}</span>
        </div>
        <div class="bar-meter"><span style="width: ${width}%"></span></div>
      </div>
    `;
  }).join('');
}

function renderAlerts(alerts) {
  nodes.alertList.innerHTML = alerts.map(alert => `
    <article class="alert-item">
      <strong>${escapeHtml(alert.title)}</strong>
      <span>${escapeHtml(alert.disease)} | ${escapeHtml(alert.district)} | ${alert.case_count} case${alert.case_count === 1 ? '' : 's'}</span>
      <div class="record-meta">
        <span class="severity-pill severity-${escapeHtml(alert.severity)}">${escapeHtml(alert.severity)}</span>
        ${escapeHtml(alert.status)}
      </div>
    </article>
  `).join('');
}

function renderSdg(items) {
  nodes.sdgGrid.innerHTML = items.map(item => `
    <article class="sdg-card">
      <div>
        <span>${escapeHtml(item.goal)}</span>
        <strong>${escapeHtml(item.label)}</strong>
      </div>
      <p>${escapeHtml(item.value)}</p>
    </article>
  `).join('');
}

function renderVisitOptions(records) {
  if (!records.length) {
    nodes.visitMigrant.innerHTML = '<option value="">No worker records</option>';
    return;
  }

  nodes.visitMigrant.innerHTML = records.map(record => `
    <option value="${record.id}">${escapeHtml(record.record_no)} - ${escapeHtml(record.full_name)}</option>
  `).join('');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }
  return payload;
}

function showMessage(node, message, isError = false) {
  node.textContent = message;
  node.classList.toggle('error', isError);
}

function formatDate(value) {
  if (!value) {
    return 'No date';
  }
  let safeDate = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(safeDate)) {
    safeDate = `${safeDate}T00:00:00`;
  } else {
    safeDate = safeDate.replace(' ', 'T');
  }

  const parsed = new Date(safeDate);
  return Number.isNaN(parsed.getTime()) ? String(value) : formatter.format(parsed);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function debounce(callback, delay) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
}
