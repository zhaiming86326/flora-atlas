CREATE TABLE IF NOT EXISTS wiki_import_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_index INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO wiki_import_state (id, next_index, updated_at)
VALUES (1, 0, datetime('now'));
