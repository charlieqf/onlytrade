CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  room_name TEXT,
  program_slug TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review',
  notes TEXT,
  video_path TEXT NOT NULL,
  poster_path TEXT,
  duration_seconds INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS segment_publish_targets (
  segment_id TEXT NOT NULL,
  target_platform TEXT NOT NULL,
  publish_status TEXT NOT NULL DEFAULT 'not_started',
  external_id TEXT,
  published_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (segment_id, target_platform),
  FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE CASCADE
);
