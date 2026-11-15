PRAGMA journal_mode = WAL;

-- One row per turn. Columns other than body are projections of body, written by the same upsert.
CREATE TABLE IF NOT EXISTS events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  id         TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  stage      TEXT NOT NULL,
  headline   TEXT NOT NULL CHECK (headline IN ('ALLOW','REDACT','REROUTE','HOLD','BLOCK')),
  upstream   TEXT,
  body       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_session ON events(session_id, seq);

CREATE TABLE IF NOT EXISTS approvals (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id),
  status      TEXT NOT NULL CHECK (status IN ('pending','approved','denied','expired')),
  created_at  REAL NOT NULL,
  expires_at  REAL NOT NULL,
  resolved_at REAL,
  subject     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS approvals_pending ON approvals(status) WHERE status = 'pending';

-- Gateway keys. Only the SHA-256 of a key is kept; the plain key is shown once, when it is created.
CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  hash         TEXT NOT NULL UNIQUE,
  created_at   REAL NOT NULL,
  last_used_at REAL
);
