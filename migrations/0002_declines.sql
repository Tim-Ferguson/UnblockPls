-- Remembers a "no" after the sender deletes their account, so deleting and re-joining can't reopen it.
CREATE TABLE declines (
  from_id TEXT NOT NULL,
  to_handle TEXT NOT NULL,
  declined_at INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_handle)
);
