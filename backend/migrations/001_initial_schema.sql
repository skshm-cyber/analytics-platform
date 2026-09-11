-- =============================================================================
-- Analytics Platform — D1 Schema (multi-tenant)
-- =============================================================================

-- Users: account management
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT DEFAULT '',
  is_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Sites: each website is a tenant
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  site_key TEXT UNIQUE NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sites_user ON sites(user_id);
CREATE INDEX IF NOT EXISTS idx_sites_key ON sites(site_key);

-- Visitors: one row per unique visitor per site
CREATE TABLE IF NOT EXISTS visitors (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  first_seen TEXT DEFAULT (datetime('now')),
  last_seen TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_visitors_site ON visitors(site_id);
CREATE INDEX IF NOT EXISTS idx_visitors_visitor ON visitors(site_id, visitor_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_visitors_unique ON visitors(site_id, visitor_id);

-- Sessions: one row per browsing session per site
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  started_at TEXT DEFAULT (datetime('now')),
  entry_page TEXT DEFAULT '',
  exit_page TEXT DEFAULT '',
  page_count INTEGER DEFAULT 1,
  duration_seconds REAL DEFAULT 0,
  is_bounce INTEGER DEFAULT 1,
  referrer TEXT DEFAULT '',
  utm_source TEXT DEFAULT '',
  utm_campaign TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_site ON sessions(site_id);
CREATE INDEX IF NOT EXISTS idx_sessions_session ON sessions(site_id, session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_visitor ON sessions(site_id, visitor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(site_id, started_at);

-- Page views: one row per page load per site
CREATE TABLE IF NOT EXISTS page_views (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  timestamp TEXT DEFAULT (datetime('now')),
  page_url TEXT NOT NULL,
  page_title TEXT DEFAULT '',
  referrer TEXT DEFAULT '',
  is_first_visit INTEGER DEFAULT 0,
  scroll_percentage INTEGER DEFAULT 0,
  time_on_page REAL DEFAULT 0,
  utm_source TEXT DEFAULT '',
  utm_medium TEXT DEFAULT '',
  utm_campaign TEXT DEFAULT '',
  utm_content TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_pv_site ON page_views(site_id);
CREATE INDEX IF NOT EXISTS idx_pv_timestamp ON page_views(site_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_pv_page ON page_views(site_id, page_url);
CREATE INDEX IF NOT EXISTS idx_pv_visitor ON page_views(site_id, visitor_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_pv_session ON page_views(site_id, session_id);

-- Events: interactions (clicks, forms, downloads, custom events)
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  timestamp TEXT DEFAULT (datetime('now')),
  event_type TEXT NOT NULL,
  event_target TEXT DEFAULT '',
  page_url TEXT DEFAULT '',
  browser TEXT DEFAULT '',
  os TEXT DEFAULT '',
  device_type TEXT DEFAULT '',
  properties TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_site ON events(site_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(site_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(site_id, event_type);
CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(site_id, visitor_id);
CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(site_id, event_type, timestamp);

-- Devices: browser, OS, screen info per page view
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  page_view_id TEXT NOT NULL,
  browser TEXT DEFAULT '',
  browser_version TEXT DEFAULT '',
  os TEXT DEFAULT '',
  device_type TEXT DEFAULT '',
  screen_width INTEGER DEFAULT 0,
  screen_height INTEGER DEFAULT 0,
  language TEXT DEFAULT '',
  timezone TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_dev_pv ON devices(page_view_id);
CREATE INDEX IF NOT EXISTS idx_dev_browser ON devices(browser);
CREATE INDEX IF NOT EXISTS idx_dev_os ON devices(os);
CREATE INDEX IF NOT EXISTS idx_dev_type ON devices(device_type);

-- Locations: country, city per page view
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  page_view_id TEXT NOT NULL,
  country TEXT DEFAULT '',
  city TEXT DEFAULT '',
  latitude REAL,
  longitude REAL
);
CREATE INDEX IF NOT EXISTS idx_loc_pv ON locations(page_view_id);
CREATE INDEX IF NOT EXISTS idx_loc_country ON locations(country);
