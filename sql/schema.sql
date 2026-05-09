PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS migrants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_no TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  age INTEGER NOT NULL CHECK (age >= 0 AND age <= 120),
  gender TEXT NOT NULL,
  origin_state TEXT NOT NULL,
  current_district TEXT NOT NULL,
  workplace_sector TEXT NOT NULL,
  employer TEXT,
  mobile TEXT,
  preferred_language TEXT,
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'moderate', 'high')),
  consent_status TEXT NOT NULL DEFAULT 'consented',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS health_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  migrant_id INTEGER NOT NULL,
  visit_date TEXT NOT NULL,
  facility TEXT NOT NULL,
  symptoms TEXT,
  diagnosis TEXT,
  disease_category TEXT,
  test_status TEXT NOT NULL DEFAULT 'Not required',
  vaccination_status TEXT NOT NULL DEFAULT 'Review due',
  referral_needed INTEGER NOT NULL DEFAULT 0 CHECK (referral_needed IN (0, 1)),
  follow_up_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (migrant_id) REFERENCES migrants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  disease TEXT NOT NULL,
  district TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'moderate', 'high')),
  case_count INTEGER NOT NULL DEFAULT 0 CHECK (case_count >= 0),
  status TEXT NOT NULL DEFAULT 'monitoring',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_migrants_district ON migrants(current_district);
CREATE INDEX IF NOT EXISTS idx_migrants_risk ON migrants(risk_level);
CREATE INDEX IF NOT EXISTS idx_visits_migrant ON health_visits(migrant_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
