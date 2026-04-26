CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  sort_index INTEGER NOT NULL DEFAULT 0,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  vrchat_name TEXT NOT NULL,
  discord_name TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  contact_note TEXT NOT NULL DEFAULT '',
  creator_blurb TEXT NOT NULL DEFAULT '',
  creator_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  creator_visible BOOLEAN NOT NULL DEFAULT FALSE,
  creator_slug TEXT NOT NULL DEFAULT '',
  creator_application_status TEXT NOT NULL DEFAULT 'none',
  creator_follower_count INTEGER NOT NULL DEFAULT 0,
  creator_primary_platform TEXT NOT NULL DEFAULT '',
  creator_proof_url TEXT NOT NULL DEFAULT '',
  creator_application_note TEXT NOT NULL DEFAULT '',
  creator_review_note TEXT NOT NULL DEFAULT '',
  creator_reviewed_at TIMESTAMPTZ,
  creator_reviewed_by TEXT NOT NULL DEFAULT '',
  creator_community_name TEXT NOT NULL DEFAULT '',
  creator_community_summary TEXT NOT NULL DEFAULT '',
  creator_community_invite_url TEXT NOT NULL DEFAULT '',
  creator_presence TEXT NOT NULL DEFAULT 'offline',
  creator_presence_text TEXT NOT NULL DEFAULT '',
  creator_presence_url TEXT NOT NULL DEFAULT '',
  creator_presence_updated_at TIMESTAMPTZ,
  creator_webhook_token TEXT NOT NULL DEFAULT '',
  creator_automation_last_at TIMESTAMPTZ,
  creator_automation_last_source TEXT NOT NULL DEFAULT '',
  vrchat_linked_at TIMESTAMPTZ,
  vrchat_link_source TEXT NOT NULL DEFAULT '',
  weekly_hours_capacity NUMERIC(6, 1) NOT NULL DEFAULT 0,
  weekly_days_capacity INTEGER NOT NULL DEFAULT 0,
  availability_schedule TEXT NOT NULL DEFAULT '',
  availability_updated_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  block_reason TEXT NOT NULL DEFAULT '',
  blocked_at TIMESTAMPTZ,
  blocked_by TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_sort_index ON users(sort_index);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS availability_slots (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  start_time TEXT NOT NULL DEFAULT '',
  end_time TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  sort_index INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day_id)
);

CREATE INDEX IF NOT EXISTS idx_availability_slots_user_sort ON availability_slots(user_id, sort_index);

CREATE TABLE IF NOT EXISTS overtime_adjustments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hours NUMERIC(6, 1) NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL DEFAULT '',
  sort_index INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_overtime_adjustments_user_sort ON overtime_adjustments(user_id, sort_index);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  sort_index INTEGER NOT NULL DEFAULT 0,
  date_key DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  shift_type TEXT NOT NULL,
  world TEXT NOT NULL,
  task TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notes TEXT NOT NULL DEFAULT '',
  is_lead BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shifts_member_date ON shifts(member_id, date_key);
CREATE INDEX IF NOT EXISTS idx_shifts_sort_index ON shifts(sort_index);

CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  sort_index INTEGER NOT NULL DEFAULT 0,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_id TEXT REFERENCES shifts(id) ON DELETE SET NULL,
  check_in_at TIMESTAMPTZ NOT NULL,
  check_out_at TIMESTAMPTZ,
  shift_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_time_entries_user_check_in ON time_entries(user_id, check_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_time_entries_shift_id ON time_entries(shift_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_sort_index ON time_entries(sort_index);
