-- Schema version 1 (docs/AGENT_START.md §7). Applied by src/db/migrate.js.
-- Timestamps are ISO-8601 UTC text; event dates are 'YYYY-MM-DD' and times 'HH:MM'.

-- Exactly one row (id = 1).
CREATE TABLE settings (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  signup_opens_at     TEXT,                 -- ISO UTC; NULL until set (BR-31)
  signup_closes_at    TEXT,
  choice_deadline_at  TEXT,                 -- BR-44
  last_purged_at      TEXT,                 -- BR-55
  updated_at          TEXT NOT NULL
);
INSERT INTO settings (id, updated_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

CREATE TABLE saeludagar_days (
  day TEXT PRIMARY KEY                      -- 'YYYY-MM-DD' (BR-21, BR-54)
);

-- Students and teachers in one table, so a kennitala is unique across both (BR-12).
CREATE TABLE users (
  id                 INTEGER PRIMARY KEY,
  role               TEXT    NOT NULL CHECK (role IN ('student','teacher')),
  is_admin           INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0,1)),
  kennitala_hmac     TEXT    NOT NULL UNIQUE,     -- hex HMAC-SHA256 of the 10-digit string (lookups)
  kennitala_enc      TEXT    NOT NULL,            -- AES-256-GCM: base64(iv).base64(tag).base64(ciphertext)
  name               TEXT    NOT NULL,
  email              TEXT    NOT NULL,
  braut              TEXT,                        -- students only; may be NULL
  active             INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  code_hash          TEXT,                        -- scrypt hash; NULL = no code yet
  code_requested_at  TEXT,                        -- last new-code request/queue time (BR-08 limit)
  failed_logins      INTEGER NOT NULL DEFAULT 0,  -- BR-05
  locked_until       TEXT,
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL,
  CHECK (role = 'teacher' OR is_admin = 0)
);
CREATE INDEX users_role_active ON users(role, active);

CREATE TABLE student_courses (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_code  TEXT    NOT NULL,
  PRIMARY KEY (user_id, course_code)
);

CREATE TABLE events (
  id                INTEGER PRIMARY KEY,
  owner_id          INTEGER NOT NULL REFERENCES users(id),
  status            TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  title_is          TEXT    NOT NULL,
  title_en          TEXT,
  description_is    TEXT    NOT NULL,             -- plain text; line breaks allowed, no HTML
  description_en    TEXT,
  host              TEXT    NOT NULL,             -- Mótshaldari/Veitandi
  braut_restricted  INTEGER NOT NULL DEFAULT 0 CHECK (braut_restricted IN (0,1)),
  capacity          INTEGER NOT NULL CHECK (capacity >= 1),
  fee_isk           INTEGER NOT NULL DEFAULT 0 CHECK (fee_isk >= 0),
  image_file        TEXT,                         -- file name in UPLOAD_DIR; NULL = default image
  event_date        TEXT    NOT NULL,             -- must be in saeludagar_days when saved (checked in code)
  start_time        TEXT    NOT NULL,             -- 'HH:MM'
  end_time          TEXT    NOT NULL,
  location          TEXT    NOT NULL,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX events_status_date ON events(status, event_date, start_time);

CREATE TABLE event_brautir (
  event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  braut     TEXT    NOT NULL,
  PRIMARY KEY (event_id, braut)
);

CREATE TABLE event_coteachers (
  event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  teacher_id  INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (event_id, teacher_id)
);

-- One row per sign-up. Attendance and the course choice live on the sign-up.
CREATE TABLE registrations (
  id                    INTEGER PRIMARY KEY,
  event_id              INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  student_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- teacher who added; NULL = self sign-up
  created_at            TEXT    NOT NULL,
  attended              INTEGER NOT NULL DEFAULT 0 CHECK (attended IN (0,1)),
  attendance_marked_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  attendance_marked_at  TEXT,
  course_code           TEXT,                     -- BR-41; NULL = no choice
  course_chosen_at      TEXT,
  UNIQUE (event_id, student_id),
  CHECK (course_code IS NULL OR attended = 1)
);
CREATE UNIQUE INDEX registrations_one_event_per_course
  ON registrations(student_id, course_code) WHERE course_code IS NOT NULL;   -- BR-42
CREATE INDEX registrations_student ON registrations(student_id);

CREATE TABLE sessions (
  sid         TEXT    PRIMARY KEY,
  user_id     INTEGER,                 -- NULL for guests; lets purge/deactivation delete a user's sessions
  sess        TEXT    NOT NULL,        -- JSON
  expires_at  INTEGER NOT NULL         -- epoch milliseconds
);
CREATE INDEX sessions_expires ON sessions(expires_at);
CREATE INDEX sessions_user ON sessions(user_id);

-- Every email goes through this queue (BR-53). Rows are deleted once sent.
CREATE TABLE email_outbox (
  id           INTEGER PRIMARY KEY,
  kind         TEXT    NOT NULL CHECK (kind IN
                 ('student_code','new_code','teacher_code','teacher_message','event_changed','event_deleted')),
  priority     INTEGER NOT NULL DEFAULT 0,   -- 0 = send first; 1 = bulk (student_code)
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- recipient
  payload      TEXT,                         -- JSON; never contains a login code
  created_at   TEXT    NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  next_try_at  TEXT
);
CREATE INDEX email_outbox_due ON email_outbox(priority, next_try_at);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  at          TEXT    NOT NULL,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT    NOT NULL,   -- 'signup.create','signup.delete','attendance.set','attendance.unset','choice.set','choice.clear'
  event_id    INTEGER,            -- no FK, so entries survive event deletion until the purge
  student_id  INTEGER,
  details     TEXT                -- JSON
);
CREATE INDEX audit_at ON audit_log(at);
