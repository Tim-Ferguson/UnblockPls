CREATE TABLE users (
  id TEXT PRIMARY KEY,            -- X user id (stable across handle changes)
  handle TEXT NOT NULL,
  handle_lower TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX users_handle ON users(handle_lower);

CREATE TABLE appeals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id TEXT NOT NULL REFERENCES users(id),
  to_handle TEXT NOT NULL,        -- lowercased X handle of the person being appealed to
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  dismissed_at INTEGER,           -- set by the recipient; hides the appeal from their page
  UNIQUE(from_id, to_handle)
);
CREATE INDEX appeals_to ON appeals(to_handle, created_at);
CREATE INDEX appeals_from ON appeals(from_id, created_at);
