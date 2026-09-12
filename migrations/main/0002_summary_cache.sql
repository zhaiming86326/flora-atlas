CREATE TABLE IF NOT EXISTS catalog_summary_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  plants INTEGER NOT NULL,
  families INTEGER NOT NULL,
  refreshed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_summary_families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zh TEXT NOT NULL,
  count INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS catalog_summary_lifeforms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  count INTEGER NOT NULL,
  sort_order INTEGER NOT NULL
);

