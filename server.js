const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'health-records.sqlite');
const SCHEMA_PATH = path.join(ROOT, 'sql', 'schema.sql');
const PORT = Number(process.env.PORT || 3200);

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
seedDatabase();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(res, error.status || 500, { error: error.status ? error.message : 'Unexpected server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Kerala Migrant Health Record System running at http://localhost:${PORT}`);
});

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/summary') {
    sendJson(res, 200, getSummary());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/migrants') {
    sendJson(res, 200, getMigrants(url.searchParams));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/migrants') {
    const body = await readJson(req);
    const created = createMigrant(body);
    sendJson(res, 201, created);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/visits') {
    const body = await readJson(req);
    const created = createVisit(body);
    sendJson(res, 201, created);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/alerts') {
    sendJson(res, 200, getAlerts());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/alerts') {
    const body = await readJson(req);
    const created = createAlert(body);
    sendJson(res, 201, created);
    return;
  }

  sendJson(res, 404, { error: 'API route not found' });
}

function serveStatic(res, pathname) {
  const cleanPath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const requestedPath = path.normalize(path.join(PUBLIC_DIR, cleanPath));

  if (!requestedPath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden path' });
    return;
  }

  fs.readFile(requestedPath, (error, content) => {
    if (error) {
      sendJson(res, 404, { error: 'Page not found' });
      return;
    }

    const ext = path.extname(requestedPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
    });
    res.end(content);
  });
}

function getSummary() {
  const totalRecords = scalar('SELECT COUNT(*) FROM migrants');
  const highRisk = scalar("SELECT COUNT(*) FROM migrants WHERE risk_level = 'high'");
  const activeAlerts = scalar("SELECT COUNT(*) FROM alerts WHERE status != 'resolved'");
  const pendingReferrals = scalar('SELECT COUNT(*) FROM health_visits WHERE referral_needed = 1');
  const completedVaccinations = scalar(`
    SELECT COUNT(DISTINCT migrant_id)
    FROM health_visits
    WHERE vaccination_status IN ('Complete', 'Up to date')
  `);
  const screenings = scalar("SELECT COUNT(*) FROM health_visits WHERE test_status IN ('Completed', 'Pending lab')");
  const immunizationCoverage = totalRecords ? Math.round((completedVaccinations / totalRecords) * 100) : 0;

  const riskBreakdown = db.prepare(`
    SELECT risk_level AS label, COUNT(*) AS value
    FROM migrants
    GROUP BY risk_level
  `).all();

  const districtLoad = db.prepare(`
    SELECT current_district AS district, COUNT(*) AS records
    FROM migrants
    GROUP BY current_district
    ORDER BY records DESC, district ASC
  `).all();

  const diseaseSignals = db.prepare(`
    SELECT COALESCE(NULLIF(disease_category, ''), 'General care') AS disease, COUNT(*) AS cases
    FROM health_visits
    GROUP BY disease
    ORDER BY cases DESC
    LIMIT 6
  `).all();

  return {
    totalRecords,
    highRisk,
    activeAlerts,
    pendingReferrals,
    immunizationCoverage,
    screenings,
    riskBreakdown,
    districtLoad,
    diseaseSignals,
    sdg: [
      { goal: 'SDG 3', label: 'Good Health', value: `${screenings} screenings logged` },
      { goal: 'SDG 10', label: 'Reduced Inequalities', value: `${totalRecords} portable records` },
      { goal: 'SDG 16', label: 'Trusted Institutions', value: `${immunizationCoverage}% vaccine status known` },
      { goal: 'SDG 17', label: 'Partnerships', value: `${districtLoad.length} districts coordinated` }
    ]
  };
}

function getMigrants(searchParams) {
  const filters = [];
  const params = [];
  const search = (searchParams.get('search') || '').trim().toLowerCase();
  const district = (searchParams.get('district') || '').trim();
  const risk = (searchParams.get('risk') || '').trim();

  if (search) {
    filters.push(`(
      LOWER(m.record_no) LIKE ?
      OR LOWER(m.full_name) LIKE ?
      OR LOWER(m.origin_state) LIKE ?
      OR LOWER(m.workplace_sector) LIKE ?
    )`);
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (district && district !== 'all') {
    filters.push('m.current_district = ?');
    params.push(district);
  }

  if (risk && risk !== 'all') {
    filters.push('m.risk_level = ?');
    params.push(risk);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  return db.prepare(`
    SELECT
      m.*,
      (
        SELECT visit_date
        FROM health_visits
        WHERE migrant_id = m.id
        ORDER BY visit_date DESC, id DESC
        LIMIT 1
      ) AS last_visit,
      (
        SELECT diagnosis
        FROM health_visits
        WHERE migrant_id = m.id
        ORDER BY visit_date DESC, id DESC
        LIMIT 1
      ) AS last_diagnosis,
      (
        SELECT vaccination_status
        FROM health_visits
        WHERE migrant_id = m.id
        ORDER BY visit_date DESC, id DESC
        LIMIT 1
      ) AS vaccination_status
    FROM migrants m
    ${where}
    ORDER BY m.created_at DESC, m.id DESC
  `).all(...params);
}

function getAlerts() {
  return db.prepare(`
    SELECT *
    FROM alerts
    ORDER BY
      CASE severity WHEN 'high' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END,
      created_at DESC
  `).all();
}

function createMigrant(body) {
  const required = ['full_name', 'age', 'gender', 'origin_state', 'current_district', 'workplace_sector'];
  for (const field of required) {
    if (!String(body[field] || '').trim()) {
      const error = new Error(`${field} is required`);
      error.status = 400;
      throw error;
    }
  }

  const recordNo = body.record_no || makeRecordNo();
  const statement = db.prepare(`
    INSERT INTO migrants (
      record_no, full_name, age, gender, origin_state, current_district,
      workplace_sector, employer, mobile, preferred_language, risk_level, consent_status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = statement.run(
    recordNo,
    body.full_name.trim(),
    Number(body.age),
    body.gender,
    body.origin_state.trim(),
    body.current_district,
    body.workplace_sector,
    body.employer || '',
    body.mobile || '',
    body.preferred_language || '',
    body.risk_level || 'low',
    body.consent_status || 'consented'
  );

  if (body.facility || body.symptoms || body.diagnosis) {
    createVisit({
      migrant_id: result.lastInsertRowid,
      visit_date: body.visit_date || today(),
      facility: body.facility || 'Registration camp',
      symptoms: body.symptoms || 'Baseline registration',
      diagnosis: body.diagnosis || 'Initial screening pending',
      disease_category: body.disease_category || 'General care',
      test_status: body.test_status || 'Not required',
      vaccination_status: body.vaccination_status || 'Review due',
      referral_needed: body.referral_needed ? 1 : 0,
      follow_up_date: body.follow_up_date || '',
      notes: body.notes || ''
    });
  }

  return db.prepare('SELECT * FROM migrants WHERE id = ?').get(result.lastInsertRowid);
}

function createVisit(body) {
  const migrantId = Number(body.migrant_id);
  if (!migrantId || !db.prepare('SELECT id FROM migrants WHERE id = ?').get(migrantId)) {
    const error = new Error('A valid migrant_id is required');
    error.status = 400;
    throw error;
  }

  const result = db.prepare(`
    INSERT INTO health_visits (
      migrant_id, visit_date, facility, symptoms, diagnosis, disease_category,
      test_status, vaccination_status, referral_needed, follow_up_date, notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    migrantId,
    body.visit_date || today(),
    body.facility || 'Primary Health Centre',
    body.symptoms || '',
    body.diagnosis || 'General consultation',
    body.disease_category || 'General care',
    body.test_status || 'Not required',
    body.vaccination_status || 'Review due',
    body.referral_needed ? 1 : 0,
    body.follow_up_date || '',
    body.notes || ''
  );

  return db.prepare('SELECT * FROM health_visits WHERE id = ?').get(result.lastInsertRowid);
}

function createAlert(body) {
  const result = db.prepare(`
    INSERT INTO alerts (title, disease, district, severity, case_count, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    body.title || 'Field signal under review',
    body.disease || 'Undifferentiated fever',
    body.district || 'Ernakulam',
    body.severity || 'moderate',
    Number(body.case_count || 1),
    body.status || 'monitoring'
  );

  return db.prepare('SELECT * FROM alerts WHERE id = ?').get(result.lastInsertRowid);
}

function scalar(sql) {
  const row = db.prepare(sql).get();
  return Object.values(row)[0] || 0;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error('Invalid JSON body');
        error.status = 400;
        reject(error);
      }
    });
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function makeRecordNo() {
  const suffix = Date.now().toString(36).slice(-6).toUpperCase();
  return `MIG-KL-${suffix}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function seedDatabase() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM migrants').get().count;
  if (count > 0) {
    return;
  }

  const migrants = [
    ['MIG-KL-26001', 'Anwar Ali', 32, 'Male', 'Assam', 'Ernakulam', 'Construction', 'Metro build site', '9876501001', 'Assamese', 'moderate', 'consented'],
    ['MIG-KL-26002', 'Sita Kumari', 27, 'Female', 'Bihar', 'Kozhikode', 'Textile', 'Garment unit', '9876501002', 'Hindi', 'low', 'consented'],
    ['MIG-KL-26003', 'Rajesh Mandal', 41, 'Male', 'West Bengal', 'Thiruvananthapuram', 'Food services', 'Restaurant cluster', '9876501003', 'Bengali', 'high', 'consented'],
    ['MIG-KL-26004', 'Mary Laxmi', 35, 'Female', 'Odisha', 'Kollam', 'Domestic work', 'Registered household network', '9876501004', 'Odia', 'low', 'consented'],
    ['MIG-KL-26005', 'Nurul Haque', 29, 'Male', 'Assam', 'Malappuram', 'Agriculture', 'Harvest collective', '9876501005', 'Assamese', 'moderate', 'consented'],
    ['MIG-KL-26006', 'Chandan Paswan', 38, 'Male', 'Jharkhand', 'Thrissur', 'Manufacturing', 'Packaging unit', '9876501006', 'Hindi', 'high', 'consented']
  ];

  const insertMigrant = db.prepare(`
    INSERT INTO migrants (
      record_no, full_name, age, gender, origin_state, current_district,
      workplace_sector, employer, mobile, preferred_language, risk_level, consent_status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const migrant of migrants) {
    insertMigrant.run(...migrant);
  }

  const visits = [
    [1, '2026-05-02', 'Ernakulam Urban PHC', 'Cough and fever', 'Acute respiratory infection; monitored', 'Respiratory', 'Completed', 'Up to date', 0, '', 'Provided mask guidance and follow-up call.'],
    [2, '2026-05-03', 'Kozhikode Mobile Camp', 'Routine check-up', 'No acute concern', 'General care', 'Not required', 'Complete', 0, '', 'Nutrition counselling completed.'],
    [3, '2026-05-04', 'Thiruvananthapuram Chest Clinic', 'Cough more than two weeks', 'TB evaluation initiated', 'Tuberculosis', 'Pending lab', 'Review due', 1, '2026-05-12', 'Sputum sample collected; workplace contact list prepared with consent.'],
    [4, '2026-05-04', 'Kollam Family Health Centre', 'Antenatal review', 'Maternal health follow-up', 'Maternal health', 'Completed', 'Up to date', 0, '', 'Linked to district maternal health nurse.'],
    [5, '2026-05-05', 'Malappuram Field Clinic', 'Fever', 'Dengue screening advised', 'Vector-borne', 'Pending lab', 'Review due', 1, '2026-05-10', 'Shared source-reduction advisory with worksite.'],
    [6, '2026-05-06', 'Thrissur Industrial Health Desk', 'Skin lesions and fever', 'Referral to dermatologist and fever clinic', 'Infectious disease', 'Completed', 'Review due', 1, '2026-05-11', 'Case reviewed by district surveillance officer.']
  ];

  const insertVisit = db.prepare(`
    INSERT INTO health_visits (
      migrant_id, visit_date, facility, symptoms, diagnosis, disease_category,
      test_status, vaccination_status, referral_needed, follow_up_date, notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const visit of visits) {
    insertVisit.run(...visit);
  }

  const alerts = [
    ['Respiratory cluster under observation', 'Respiratory infection', 'Ernakulam', 'moderate', 3, 'monitoring'],
    ['TB follow-up queue', 'Tuberculosis', 'Thiruvananthapuram', 'high', 1, 'active'],
    ['Vector-borne fever screening', 'Dengue', 'Malappuram', 'moderate', 2, 'monitoring']
  ];

  const insertAlert = db.prepare(`
    INSERT INTO alerts (title, disease, district, severity, case_count, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const alert of alerts) {
    insertAlert.run(...alert);
  }
}
