PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 3000;
PRAGMA temp_store = MEMORY;
PRAGMA wal_autocheckpoint = 1000;
PRAGMA cache_size = -20000;

CREATE TABLE IF NOT EXISTS meta_versions (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data_version INTEGER NOT NULL,
  lock_version INTEGER NOT NULL
);

INSERT INTO meta_versions (id, data_version, lock_version)
VALUES (1, 1, 1)
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  week_start TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  reserved_slots_json TEXT NOT NULL DEFAULT '[]',
  subsidy_types_json TEXT,
  member_subsidies_json TEXT
);

CREATE TABLE IF NOT EXISTS slots (
  team_id TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  member_json TEXT,
  fixed_role TEXT,
  fixed_martial_art_index INTEGER,
  PRIMARY KEY (team_id, slot_index),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS archives (
  id TEXT PRIMARY KEY,
  team_json TEXT NOT NULL,
  archived_at INTEGER NOT NULL,
  archived_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cancellations (
  qq TEXT NOT NULL,
  reason TEXT NOT NULL,
  cancelled_by TEXT NOT NULL,
  team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  PRIMARY KEY (qq, timestamp)
);

CREATE TABLE IF NOT EXISTS operation_logs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  actor_qq TEXT NOT NULL,
  action TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profiles (
  qq TEXT PRIMARY KEY,
  nickname TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subsidy_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subsidy_preset_levels (
  preset_id TEXT NOT NULL,
  level_index INTEGER NOT NULL,
  name TEXT NOT NULL,
  gold REAL NOT NULL,
  PRIMARY KEY (preset_id, level_index),
  FOREIGN KEY (preset_id) REFERENCES subsidy_presets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_logs_team_timestamp ON operation_logs(team_id, timestamp);
