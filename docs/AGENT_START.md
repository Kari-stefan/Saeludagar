# AGENT_START.md: Sæludagar website

> This is the complete, standalone specification for you, the coding agent. The original planning files are in `docs/` (`requirements.md`, `saeludagar-notes.txt`) for reference only; where they differ from this document, this document wins. Build **milestone 1 only** (section 13), then stop and wait.

---

## 1. Goal

Build a bilingual (Icelandic/English) website for the school's Sæludagar. It runs at saeludagar.is on the school's own server, built with Node.js, EJS, SCSS, SQLite and plain JavaScript.

Students log in with their kennitala and a personal 6-digit code. They browse the school's events (viðburðir), filter them by study programme (braut), and sign up for at most 4. Teachers create and publish events, manage participant lists, email participants, and mark attendance on the day. After a student's attendance is marked, the student chooses which of their own courses (áfangar) gets 4 absence points (fjarvistarstig) removed. An admin imports student data from a CSV file, sets the dates, sends login codes, and downloads a CSV export for the school office, which enters the deductions into Inna (the school's student information system).

The MVP must be finished and approved by school management by **1 February 2027**, for Sæludagar in **March 2027**. Work in milestones (section 13), starting with a scaffold and the data model only.

---

## 2. Background

### What Sæludagar is
Sæludagar are a few days in the school year when attendance is optional. During those days the school runs events, and students sign up for the ones they want.

The last Sæludagar were in spring 2026:
- Sign-up ran 5–8 March 2026.
- The days themselves were 11–12 March 2026.
- The school's email pointed students to saeludagar.is.

The next Sæludagar are expected in March 2027 on the same pattern. The admin enters the real dates in the system.

### How absence points work
Students build up absence points (fjarvistarstig) in each course. A student who attends Sæludagar events can have some of those points removed. The rules come from the school's email to students of 8 March 2026:

> "Hver mæting á viðburð gildir sem 4 stig í einum áfanga."
> (Each attendance at an event counts as 4 points in one course.)
>
> "Hægt er að fá að hámarki 4 stig dregin frá í hverjum áfanga, í allt að 4 áföngum (samtals 16 stig)."
> (At most 4 points can be removed per course, in up to 4 courses: 16 points in total.)

| Events attended | Points removed | Split |
|---|---|---|
| 4 | 16 | 4 points in each of 4 courses |
| 3 | 12 | 4 points in each of 3 courses |
| 2 | 8 | 4 points in each of 2 courses |
| 1 | 4 | 4 points in 1 course |

The site never touches Inna. It only records which of the student's courses each attended event should count against. The office then enters the deductions into Inna from a CSV export. The site does not know any student's current absence balance.

### Glossary
Use these Icelandic terms in the Icelandic UI.

| Term | Meaning |
|---|---|
| Sæludagar | The optional-attendance days, and the product name |
| viðburður (pl. viðburðir) | Event. The early planning files said "atburður", but the UI must say **viðburður** |
| áfangi (pl. áfangar) | Course, identified by a course code such as STÆR2BH05 |
| braut / námsbraut | Study programme, e.g. Starfsbraut, Rafmagnsbraut, Jarðfræðibraut |
| fjarvistarstig | Absence points |
| kennitala (pl. kennitölur) | Icelandic national ID: 10 digits, often written with a hyphen as 6+4 digits |
| Kennarakóði | A teacher's personal login code |
| Mótshaldari/Veitandi | Event host or provider (free text; may be outside the school) |
| Þátttökugjald | Participation fee (display only) |
| Uppselt | Full: no places left |
| Inna | The school's student information system, where absences are recorded |
| Mínir viðburðir | "My events", the student's own page |

### People named in the planning notes
- **Berglind** supplies the student data as a CSV file.
- **The kerfisstjóri** (system administrator) is expected to run the server and provide SMTP access.
- **Sigurður Fjalar** is the contact for Starfsbraut.
- **Starfsbraut, Rafmagnsbraut and Jarðfræðibraut** were listed next to "sér-atburður / ferðaatburður" (special and trip events). Those events follow the same rules as all others.
- **"Gögn gæji"** (a data person) is also named, but their role is not defined.
- **School management** signs off on the rules and the site before launch.

---

## 3. Users and roles

The site has four roles. A co-teacher is a teacher acting on an event they were added to, not a separate account type.

| Role | Can do | Cannot do |
|---|---|---|
| **Guest** (not logged in) | View the front page (Sæludagar days, published events, braut filter). View published event pages with sign-up counts. Switch language. Log in. Request a new code. | Sign up for events. See drafts. See anyone's name. |
| **Student** | Everything a guest can. Sign up for and cancel events within the rules in section 4. Use "Mínir viðburðir". Choose a course for each attended event, and change it until the deadline. | Have more than 4 sign-ups. Sign up for overlapping events. Sign up or cancel outside the sign-up window. See who else signed up. Choose a course that is not theirs, or the same course twice. Change choices after the deadline. Open teacher or admin pages. |
| **Teacher** (as event owner) | Create events as drafts. Preview an event exactly as students will see it, then publish it. Edit and delete events (rules apply). Add and remove co-teachers. See participants (name, braut, email). Add students by searching for their name, and remove students. Copy all participant emails. Send a message to all participants from the site. Print the participant list. Mark attendance. | See or edit other teachers' events unless added as a co-teacher. See any kennitala. Delete an event once attendance has been marked. Push a student past 4 sign-ups or into an overlap when adding them. Open admin pages. |
| ↳ **Co-teacher** (a teacher added to an event by its owner or an admin) | Everything the owner can do on that event, except the two things in the next column. | Delete the event. Add or remove co-teachers. |
| **Admin** (a teacher account with the admin flag; logs in like any teacher) | Everything an owner can do, on every event. Set the Sæludagar days, the sign-up window and the course-choice deadline. Import the student CSV. Send codes to all students. Create teacher accounts, send a teacher a new code, deactivate or reactivate teachers, and grant or revoke admin rights. Download the office export. Purge data. View the audit log. | Change the three fixed numbers 4 / 4 / 4 (they live in code). Write to Inna. |

Office staff do not use the site. An admin gives them the export file.

---

## 4. Business rules

Each rule has an ID that tests and section 16 refer to. In these rules, "teacher" includes co-teachers and admins unless the rule says "owner".

### Login and accounts
- **BR-01** The user can type a kennitala as 10 digits, with or without a hyphen after the 6th digit (`0000000001` or `000000-0001`). The system removes the hyphen and always stores and compares a 10-digit string. Any other input is rejected with a validation message.
- **BR-02** There is one login form for everyone: kennitala + 6-digit code. After logging in, a student lands on the student pages, and a teacher or admin lands on the teacher pages.
- **BR-03** Only active accounts can log in. An active account is either a student in the latest CSV import or an active teacher account.
- **BR-04** Every failed login shows the same message: "Kennitala eða kóði er rangur" / "Incorrect kennitala or code". This covers an unknown kennitala, a wrong code, an inactive account and a locked account.
- **BR-05** After 5 failed attempts for the same kennitala, that kennitala cannot log in for 15 minutes, even with the correct code.
- **BR-06** Every student and teacher has a personal 6-digit numeric code. Codes are stored only as hashes.
- **BR-07** An admin can send codes to all students in one action ("Senda kóða"). Every active student receives a newly generated code by email, and any previous code stops working. The page warns the admin about this and asks for confirmation. Sending is throttled (BR-53).
- **BR-08** "Fá nýjan kóða" (get a new code) works like this:
  - The user enters a kennitala.
  - If it belongs to an active account, a new code is emailed to the address on file, and the old code stops working.
  - The on-screen response is the same whether or not the kennitala exists.
  - Each kennitala can get at most one new code every 10 minutes.
- **BR-09** A session ends after 2 hours of inactivity for students, and after 12 hours for teachers and admins.
- **BR-10** An admin creates a teacher account with name, email and kennitala. The system then generates the teacher's code and emails it to them.
- **BR-11** An admin can deactivate or reactivate a teacher account, and can grant or revoke the admin flag. A deactivated teacher cannot log in. Their events remain, and admins manage them.
- **BR-12** A kennitala can belong to only one account, either a student or a teacher.
- **BR-13** The first admin account is created by a command run on the server.

### Student data
- **BR-14** Student data comes only from a CSV file that an admin uploads, in the format in section 8 (one row per student per course).
- **BR-15** The uploaded file is never written to disk or to the database. It is parsed in memory and then discarded.
- **BR-16** An import is all-or-nothing. If any row has an error, nothing is saved and every error is listed with its line number.
- **BR-17** An import updates the student list. Students are matched by kennitala:
  - New students are added.
  - Students already in the system get their name, email, braut and course list replaced.
  - Every student in the file becomes active.
  - Active students who are missing from the file become inactive and can no longer log in.
  - For each newly inactive student, sign-ups without marked attendance are deleted, which frees the places. Sign-ups with marked attendance, and their course choices, are kept for the export.
- **BR-18** The braut list, used both for filtering and for tagging events, is the set of distinct braut values among active students.
- **BR-19** Kennitölur are stored encrypted (reversibly) with a key kept outside the database. Lookups use a keyed hash (section 8).

### Events
- **BR-20** An event has these fields:
  - title: Icelandic required, English optional
  - host/provider (Mótshaldari/Veitandi)
  - zero or more brautir, plus the flag "Aðeins fyrir nemendur brautar" (only for students of these brautir)
  - description: Icelandic required, English optional
  - maximum participants
  - participation fee (Þátttökugjald)
  - an optional image
  - date, start time, end time and location
  
  The owner can add co-teachers.
- **BR-21** An event's date must be one of the Sæludagar days set by the admin, and its end time must be after its start time.
- **BR-22** A new event starts as a draft. Only the owner, co-teachers and admins can see drafts. A teacher can preview the event exactly as students will see it, then publish it.
- **BR-23** Guests and students see only published events, and guests can view them without logging in. An event page shows how many have signed up, the maximum, and "Uppselt" when full. Students never see other participants' names.
- **BR-24** Brautir work like this on an event:
  - No braut: the event is for everyone.
  - Brautir without the flag: the event is open to all, and the brautir are only filter tags.
  - Brautir with the flag: only students whose braut is one of the event's brautir can sign themselves up.
- **BR-25** Guests and students can filter the event list by braut.
- **BR-26** The participation fee is a whole number of ISK and is shown on the event. A fee of 0 is shown as "Ókeypis" / "Free". No payment happens on the site.
- **BR-27** The image is optional: one JPG, PNG or WebP file of at most 2 MB. An event without an image shows a default image.
- **BR-28** A published event can still be edited after students have signed up, with these limits:
  - The maximum cannot be set below the number already signed up.
  - If the date, start time, end time or location changes, every student signed up gets an automatic email.
  - Existing sign-ups are not checked again for overlaps.
- **BR-29** Only the owner or an admin can delete an event. Deletion is blocked once attendance has been marked for any participant. Otherwise, every student signed up gets an email, and their sign-ups are deleted, so they no longer count toward that student's 4.
- **BR-30** Special and trip events (sér-atburður / ferðaatburður) follow exactly the same rules as other events.

### Sign-up
- **BR-31** The admin sets one sign-up opening time and one closing time, and they apply to all events. Students can sign up and cancel only between those times.
- **BR-32** A student can sign up for an event only if all of these hold:
  - the sign-up window is open
  - the event is published
  - the event is not full
  - the braut rule (BR-24) allows it
  - the student has fewer than 4 sign-ups
  - the event does not overlap any event the student has already signed up for
- **BR-33** Two events overlap if they are on the same date and `startA < endB` and `startB < endA`. Back-to-back events, where one ends at 12:00 and the next starts at 12:00, do not overlap.
- **BR-34** When a sign-up is refused, the student is told why. For an overlap, the message names the event it clashes with.
- **BR-35** Student sign-ups never push an event past its maximum, even when many students sign up at the same moment. The only exception is a teacher adding a student by hand (BR-37).
- **BR-36** A student can cancel a sign-up while the window is open, and the place becomes free immediately.
- **BR-37** Teachers can add students to their event and remove them. To add a student, the teacher searches by name; results show name and braut, never the kennitala. A teacher adding a student may override the event's own limits (maximum, braut rule, sign-up window), but not the student's limits (at most 4 sign-ups, no overlaps).

### Attendance and absence points
- **BR-38** Attendance is one checkbox per participant ("mætti" / present). It starts unticked and is saved as soon as it changes.
- **BR-39** Attendance can be marked or changed from 00:00 on the event's date until the course-choice deadline. After that it is read-only.
- **BR-40** Each marked attendance entitles the student to have 4 absence points removed from exactly one course.
- **BR-41** On "Mínir viðburðir", the student chooses a course for each event where their attendance is marked. They choose from their own course list, which comes from the CSV. A choice exists only while the attendance is marked; unmarking attendance deletes the choice.
- **BR-42** A student can choose each course for at most one event, because a course can lose at most 4 points.
- **BR-43** Because of BR-32, a student has at most 4 sign-ups. That means at most 4 attended events and at most 16 points in total.
- **BR-44** The admin sets the course-choice deadline. The student can change choices until then; after it, choices are read-only.
- **BR-45** There is no approval step. A marked attendance plus the student's course choice go straight to the export.
- **BR-46** The site does not store or check students' absence-point balances.
- **BR-47** Three numbers are constants in one code module, not admin settings: 4 points per attendance, 4 points maximum per course, and 4 sign-ups maximum per student.

### Office export
- **BR-48** The office export is a CSV file with one row per marked attendance. Columns: kennitala, name, braut, course, points (4), event and date. If the student has not chosen a course, the course column is empty.
- **BR-49** The admin can download the export at any time. Before the course-choice deadline the page marks it as provisional; after the deadline it is final.

### Teacher communication and lists
- **BR-50** A teacher can contact everyone signed up for an event in two ways:
  - Copy all the email addresses, to paste into BCC in their own mail program.
  - Send a message from the site. It comes from the school's noreply address, with the teacher's email as Reply-To.
- **BR-51** The printable participant list shows each participant's name and braut, plus an empty attendance box.

### Email
- **BR-52** Every email the system sends contains the Icelandic text first, with the English text below it in the same message.
- **BR-53** Bulk sending (codes to all students) is throttled so the school's mail server does not block it. The limit is set by `SMTP_MAX_PER_MINUTE`.

### Admin settings and data lifecycle
- **BR-54** The admin sets the Sæludagar days, the sign-up opening and closing times, and the course-choice deadline.
- **BR-55** An admin can purge the data after the export. If nobody has purged 30 days after the course-choice deadline, the system purges automatically.
  - A purge deletes all student data: students, course lists, codes, sign-ups, attendance, course choices, student sessions, queued emails to students, and the audit log.
  - It sets every event back to draft.
  - Teacher accounts and events are kept.
- **BR-56** The system keeps an audit log of who changed attendance, sign-ups and course choices, and when. Admins can view it. The purge deletes it.

### Privacy and language
- **BR-57** The only cookie the site sets is the session cookie. There is no analytics or tracking.
- **BR-58** There is no privacy information page.
- **BR-59** The whole UI is available in Icelandic and English. Icelandic is the default. An ÍS/EN toggle in the header switches the language, and the choice is remembered for the session.
- **BR-60** In English, an event shows its English title and description if they exist, and the Icelandic text otherwise.
- **BR-61** The Icelandic UI says "viðburður", never "atburður".

---

## 5. Core user flows

### Guest
1. Opens saeludagar.is. The front page shows:
   - a header: school logo, "Sæludagar – {school name}", ÍS/EN toggle, log in
   - the Sæludagar days
   - a braut filter
   - published events, grouped by day and sorted by start time
2. Filters by braut and opens an event page.
3. Clicks "Skrá mig" (sign me up), is sent to the login page, and returns to the event after logging in.

### Student
1. Gets a 6-digit code by email, either from the admin's "Senda kóða" (BR-07) or by requesting one with "Fá nýjan kóða" (BR-08).
2. Logs in with kennitala + code (BR-02).
3. Browses or filters events. On an event page, clicks "Skrá mig":
   - If it works, a confirmation shows on screen and the event appears in "Mínir viðburðir".
   - If it is refused, the reason shows (BR-34).
4. In "Mínir viðburðir", sees their sign-ups as "n / 4", and can cancel while the window is open (BR-36).
5. Attends events during Sæludagar, and the teacher marks attendance.
6. Returns to "Mínir viðburðir". For each attended event, picks a course from a dropdown of their own courses and saves. Courses already used for another event are not offered (BR-42). The deadline is shown, and choices can be changed until then.
7. After the deadline, sees their choices read-only.

### Teacher
1. Receives their code by email when the admin creates the account (BR-10), and logs in with kennitala + code.
2. The teacher home lists events they own or co-teach, with status and sign-up counts.
3. Clicks "Nýr viðburður" (new event), fills in the form (BR-20) with an optional image, and saves. The event is now a draft.
4. Clicks "Forskoða" (preview) to see the event exactly as students will, then "Birta" (publish).
5. Optionally adds co-teachers (owner or admin only), chosen from the active teachers.
6. During sign-up:
   - watches the participant list
   - adds a student by name search, or removes students (BR-37)
   - copies all emails or sends a message (BR-50)
   - edits the event if needed (BR-28)
7. On the event day, opens the attendance checklist on a phone and ticks who came. Each tick saves immediately. Attendance can be corrected until the course-choice deadline (BR-39).
8. Can print the participant list as a paper backup (BR-51).

### Admin
1. On the server, runs the create-admin command (BR-13), then logs in.
2. On the settings page, sets the Sæludagar days, the sign-up window and the course-choice deadline (BR-54).
3. Imports the student CSV: uploads it, reviews the errors or the summary of changes, and confirms (BR-16, BR-17).
4. Creates teacher accounts. Their codes are emailed automatically.
5. Before the sign-up window opens, clicks "Senda kóða", confirms, and watches the progress (sent / remaining / failed).
6. During sign-up and Sæludagar, can manage any event as if they owned it.
7. After the course-choice deadline, downloads the office export and gives it to the office, which enters the deductions into Inna.
8. Purges the data, or lets the system do it 30 days after the deadline (BR-55). The events become drafts, ready for next year.
9. As needed: re-imports a newer CSV mid-term (BR-17), views the audit log (BR-56), and deactivates or reactivates teachers (BR-11).

---

## 6. Pages/screens

**On every page:**
- A header with the logo, the site title "Sæludagar – {SCHOOL_NAME}", the ÍS/EN toggle, and log in / log out with the user's name.
- Every visible string comes from the i18n dictionaries.

**Copy and paths:**
- These Icelandic strings are fixed: "Kennitala eða kóði er rangur", "Uppselt", "Ókeypis", "Mínir viðburðir", "Fá nýjan kóða", "Senda kóða", "Aðeins fyrir nemendur brautar". Draft the rest of the copy in both languages, short and plain; the team will review it.
- Paths are in English for code clarity and are not translated.

### Public
| Path | Purpose | Key elements |
|---|---|---|
| `GET /` | Front page | The Sæludagar days. A braut filter ("Allar brautir" + each braut). Published events grouped by day and sorted by start time. Each event card shows the image, title, time, location, brautir, the "Aðeins fyrir nemendur brautar" badge when set, the fee, "n / max", and an "Uppselt" badge when full. |
| `GET /events/:id` | Event page (published only, or preview rights) | All event fields, "n / max" and "Uppselt". A "Skrá mig" or "Afskrá mig" button depending on state (guests are sent to log in). The refusal reason when a sign-up fails. |
| `GET/POST /login` | Login | Kennitala and 6-digit code fields. The generic error from BR-04. A link to "Fá nýjan kóða". |
| `GET/POST /login/new-code` | Request a new code | A kennitala field. The same confirmation message whatever happens (BR-08). |
| `POST /logout` | Log out | |
| `POST /language` | Switch ÍS/EN | Returns to the same page. |

### Student
| Path | Purpose | Key elements |
|---|---|---|
| `GET /my-events` + POST actions | "Mínir viðburðir" | Sign-ups with "n / 4", time and location. Cancel buttons while the window is open. For attended events, a course dropdown (own courses not used elsewhere) and a Save button. The deadline is shown, and everything is read-only after it. |

### Teacher (owner, co-teacher or admin, as the rules allow)
| Path | Purpose | Key elements |
|---|---|---|
| `GET /teacher` | Teacher home | Events I own or co-teach: title, date, status (draft/published), "n / max". A "Nýr viðburður" button. |
| `GET/POST /teacher/events/new`, `/teacher/events/:id/edit` | Event form | All BR-20 fields, with the English fields clearly marked optional. Image upload with preview and a remove option. Braut checkboxes (from BR-18) and the restriction flag. A co-teacher section (owner or admin only). Validation messages next to each field. |
| `GET /teacher/events/:id/preview` | Preview | The public event page as a student sees it, with a "Forskoðun" (preview) banner. Works for drafts. |
| `GET /teacher/events/:id` | Event management | Status and a "Birta" (publish) button. A participant table (name, braut, email, attended). Add a student (name search) and remove buttons. Links to copy emails, send a message, print the list and take attendance. A delete button for the owner or an admin, disabled once attendance is marked. |
| `GET /teacher/events/:id/attendance` | Attendance checklist | A mobile-first list of participants with large checkboxes that save immediately. Read-only outside the BR-39 window. |
| `GET /teacher/events/:id/print` | Printable list | Event title, date, time and location, then a table of name, braut and an empty box. Uses a print stylesheet. |
| `GET/POST /teacher/events/:id/message` | Message to participants | Subject and body (free text, written in any language) and a Send button. Shows the number of recipients. |

### Admin
| Path | Purpose | Key elements |
|---|---|---|
| `GET /admin` | Admin home | The current dates and windows, the email outbox status (queued / failed), and links to every admin page. No statistics; those are a Later item. |
| `GET/POST /admin/settings` | Dates | Sæludagar days (add or remove dates), sign-up opens and closes (date + time), course-choice deadline (date + time). |
| `GET/POST /admin/import` | Student CSV import | Upload, then either the list of errors with line numbers, or a summary of changes (added, updated, deactivated, sign-ups to be removed) with a Confirm button. |
| `GET/POST /admin/codes` | Send codes | The number of active students, a warning that previous codes stop working, a Confirm button, and progress (queued / sent / failed). |
| `GET/POST /admin/teachers` | Teacher accounts | A list (name, email, admin, active). Create a teacher (name, email, kennitala). Send a new code. Deactivate or reactivate. Grant or revoke admin. |
| `GET /admin/events` | All events | Every event with its owner, status and "n / max", linking to the management page. |
| `GET /admin/export` + `GET /admin/export.csv` | Office export | A download button, a "provisional" label before the deadline, the number of rows, and the number of rows without a course. |
| `GET/POST /admin/purge` | Purge | A description of what will be deleted, a typed confirmation, and the date of the automatic purge. |
| `GET /admin/audit` | Audit log | Newest first, filterable by event or student, showing who, what and when. |

### Errors
403, 404 and 500 pages, bilingual. Production error pages show no stack traces.

---

## 7. Data model

### Conventions
- **Driver:** SQLite via better-sqlite3.
- **Pragmas** on every connection: `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`, `synchronous = NORMAL`.
- **Timestamps** are ISO-8601 UTC text, e.g. `2027-03-11T10:00:00Z`. Iceland is UTC+0 all year with no daylight saving, so local time equals UTC.
- **Event dates and times:** dates are `YYYY-MM-DD` and times are `HH:MM`.
- **Schema version** is kept in `PRAGMA user_version`; milestone 1 sets it to 1.

```sql
-- Exactly one row (id = 1).
CREATE TABLE settings (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  signup_opens_at     TEXT,                 -- ISO UTC; NULL until set (BR-31)
  signup_closes_at    TEXT,
  choice_deadline_at  TEXT,                 -- BR-44
  last_purged_at      TEXT,                 -- BR-55
  updated_at          TEXT NOT NULL
);

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
```

### Relationships
- One user (teacher) owns many events, and many teachers co-teach many events (`event_coteachers`).
- One event has many brautir (`event_brautir`) and many registrations.
- One student has many courses (`student_courses`) and at most 4 registrations (checked in code, BR-32).
- A registration holds that event's attendance and course choice.

### Invariants enforced in code (each with a test)
- Self sign-ups never exceed `capacity` (BR-35).
- No student has more than 4 registrations (BR-32, BR-37).
- No student has overlapping registrations created by self sign-up or manual add (BR-32, BR-37).
- `course_code` is one of the student's `student_courses` at the time of choosing (BR-41).
- An event's `event_date` is in `saeludagar_days` when saved (BR-21).

---

## 8. Authentication and integrations

### Login and sessions
**Login (BR-02 to BR-05):**
1. Normalize the kennitala (BR-01), compute the HMAC, and look up the user.
2. If no user is found, still run a dummy scrypt verification so the timing is the same, then show the BR-04 message.
3. If `locked_until` is in the future, fail with the BR-04 message.
4. Verify the code with scrypt and `crypto.timingSafeEqual`.
5. On failure, increment `failed_logins`. On the 5th failure, set `locked_until = now + 15 min` and reset the counter.
6. On success, reset `failed_logins` and `locked_until`, regenerate the session ID, and store `{ userId, role, isAdmin, lang }` in the session. Set the cookie's maxAge to 2 h for students or 12 h for teachers, renewed on each request (BR-09).

**Inactive accounts** fail exactly like a wrong code.

**Codes:**
- Generate with `crypto.randomInt(0, 1_000_000)`, zero-padded to 6 digits.
- Hash with `crypto.scrypt`, using a random 16-byte salt per code, in a self-describing format such as `scrypt$<salt>$<hash>`.
- Never write a code to logs, except the development email console.

**Sessions:**
- express-session with your own store in `src/db/sessionStore.js` that extends `session.Store` and implements get/set/destroy/touch.
- The store fills `user_id` from the session and deletes expired rows every 15 minutes.
- Cookie: name `sid`, HttpOnly, SameSite=Lax, Secure in production. Options `rolling: true` and `saveUninitialized: false`.
- The secret comes from `SESSION_SECRET`. Call `app.set('trust proxy', 1)` when `TRUST_PROXY=1`.
- A guest who toggles the language gets a session to remember it. This is the same session cookie (BR-57).

**Authorization:** use middleware such as `requireStudent`, `requireTeacher`, `requireAdmin` and `requireEventAccess(level)`. The level is `owner` (owner or admin) or `editor` (owner, co-teacher or admin). Check on every request and every action. Never trust hidden form fields for identity or permissions.

**CSRF:** create a random token per session. Every form includes it as `_csrf`, and every non-GET request must match it, otherwise respond 403. `fetch` calls send it in an `X-CSRF-Token` header. Do not add a package for this.

**First admin (BR-13):** `npm run create-admin -- --name "…" --email "…" --kennitala "…"` creates an active admin teacher account. It prints the code once in the terminal. This is the only time a code is ever shown on screen.

**Deactivation:** deactivating a user (BR-11, BR-17) deletes that user's sessions.

### Kennitala protection (NFR-01, BR-19)
- **Encryption:** `KENNITALA_ENC_KEY` holds 32 random bytes, base64-encoded. Use AES-256-GCM with a random 12-byte IV per value.
- **Lookups:** `KENNITALA_HMAC_KEY` is a separate key of 32 random bytes, used for HMAC-SHA256.
- **Where the keys live:** only in the environment, never in the repository or the database. The README explains how to generate them, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- **If the keys are lost**, stored kennitölur become unreadable. The fix is to re-import the CSV and re-create the teachers. Keep a copy of the keys somewhere other than the database backups (open question 8).
- **When to decrypt:** only to build the office export. Never show a kennitala in the UI, in URLs or in logs.

### Student CSV import (we define this format; Berglind delivers files in it)
**File format:**
- Header row, in this order: `kennitala;nafn;netfang;braut;afangi`.
- Delimiter `;`. Also accept `,`, detected from the header line.
- Encoding UTF-8, with or without a BOM. If the bytes are not valid UTF-8, decode as Windows-1252 with `TextDecoder('windows-1252')`, so Icelandic letters from Excel survive.
- One row per student per course. A student with no courses gets one row with an empty `afangi`.

Example (fake data):
```
kennitala;nafn;netfang;braut;afangi
0000000001;Jóna Jónsdóttir;jona@example.is;Rafmagnsbraut;STÆR2BH05
0000000001;Jóna Jónsdóttir;jona@example.is;Rafmagnsbraut;ÍSLE2MB05
000000-0002;Páll Pálsson;pall@example.is;Starfsbraut;
```

**Validation, per row, collecting every error:**
- kennitala per BR-01
- `nafn` not empty
- `netfang` looks like an email address
- `braut` may be empty
- `afangi` is trimmed
- every row for the same kennitala has the same `nafn`, `netfang` and `braut`
- the kennitala does not belong to a teacher (BR-12)

Errors look like: "Lína 14: kennitala verður að vera 10 tölustafir" (English: "Line 14: …").

**Two-step flow:**
1. Upload. The file goes through multer `memoryStorage` with a 5 MB limit. It is parsed and validated, and the page shows either all errors or a summary of the changes.
2. Confirm. The changes are applied in one transaction (BR-16, BR-17).

Between the two steps, the parsed result is kept only in server memory for at most 10 minutes, keyed by a random token stored in the admin's session. It is never written to disk (BR-15).

### Email (SMTP)
- **Transport:** nodemailer SMTP, configured from `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` (the school's noreply address). If `SMTP_HOST` is empty, as in development, use a transport that prints each email to the console instead of sending it.
- **Outbox worker:**
  - Every email goes into `email_outbox`. A worker inside the app process sends due rows, priority 0 first.
  - It sends at most `SMTP_MAX_PER_MINUTE` per minute. The default is 30, the usual Microsoft 365 per-mailbox limit; confirm the school's real limit (open question 4).
  - A failed send is retried up to 5 times with increasing delay. After that the row stays, with `last_error`, so the admin can see it. Sent rows are deleted.
- **Login codes** (`student_code`, `new_code`, `teacher_code`) are generated by the worker at send time, in this order: generate the code, send the email, then store the hash. The plaintext code is never stored.
- **Emails the system sends:**

| Kind | When | Content | Priority |
|---|---|---|---|
| `student_code` | "Senda kóða" (BR-07) | Code, link, short instructions | 1 (bulk) |
| `new_code` | "Fá nýjan kóða" (BR-08) | Code, link | 0 |
| `teacher_code` | Account created or new code (BR-10, BR-11) | Code, link | 0 |
| `teacher_message` | Teacher sends a message (BR-50) | A bilingual header naming the event, then the teacher's text as written. Reply-To = teacher | 0 |
| `event_changed` | Date, time or location changed (BR-28) | What changed, plus the new details | 0 |
| `event_deleted` | Event deleted (BR-29) | Event name and date | 0 |

- **Format:** every email is bilingual (BR-52). Plain text is enough. Templates live in `src/views/emails/`.

### Absence-system handoff (office export)
- The file is served at `GET /admin/export.csv`, for admins only.
- **Format:** UTF-8 with a BOM, `;` delimiter and CRLF line endings, so it opens correctly in Excel with Icelandic settings.
- **Header:** `kennitala;nafn;braut;afangi;stig;vidburdur;dagsetning`.
- **Rows:** one per registration with `attended = 1`.
  - `stig` = 4
  - `vidburdur` = the Icelandic title
  - `dagsetning` = the event date as `YYYY-MM-DD`
  - `afangi` is empty if no course was chosen
  
  Sort by name, then date.
- **File name:** `saeludagar-fjarvistir-YYYY-MM-DD.csv`, using the download date.
- There is no connection to Inna (out of scope). The office enters the data by hand.

### Image uploads
- Use multer `memoryStorage` with a 2 MB limit and a single file field.
- Check the file's magic bytes for JPEG, PNG or WebP, and reject anything else with an error on the field.
- Save as `<crypto.randomUUID()>.<ext>` in `UPLOAD_DIR`, which is outside `public/`. Serve it at `/uploads/:file` with the correct content type.
- Replacing or removing an event's image deletes the old file.
- The default image is `public/img/default-event.svg`.

### Scheduled jobs (inside the app process, started by `src/server.js`)
- **Outbox worker:** runs every few seconds.
- **Session cleanup:** every 15 minutes.
- **Auto-purge check:** every hour. It purges (BR-55) when all of these hold:
  - `choice_deadline_at` is set
  - now ≥ deadline + 30 days
  - `last_purged_at` is NULL or earlier than the deadline
- **Backups** do not run inside the app. `scripts/backup.js` is run daily by cron or a systemd timer (section 10).

---

## 9. Privacy and security requirements

### What is stored about students
Only these items are stored:
- the kennitala (encrypted, plus a keyed hash)
- name, school email, braut and course codes
- the code hash
- sign-ups, attendance and course choices
- audit entries and the session

No absence balances are stored (BR-46). The uploaded CSV is never stored (BR-15).

### Who sees what
| Data | The student | Other students | Teachers of that event | Admin |
|---|---|---|---|---|
| Name, braut | Own | No | Participants only | Yes |
| Email | Not shown | No | Participants only (copy/send) | Yes |
| Kennitala | Only what they type | No | No | Only inside the export file |
| Courses and course choices | Own | No | Not shown | Through the export |
| Attendance | Own | No | Yes | Yes |
| Sign-up counts | Yes | Yes | Yes | Yes |

### Retention
- Data is purged manually or automatically per BR-55.
- Backups are kept for 7 days, so personal data leaves the backups at most 7 days after a purge.
- The audit log is purged with everything else (BR-56).

### Cookies and third parties
The site sets only the session cookie (BR-57). There is no analytics or tracking, and no third-party requests at all: no CDNs, no external fonts, no external scripts. Everything is served from the site.

### Minors and notices
Many students are under 18. Nobody asked for an extra consent mechanism, and there is no privacy page (BR-58). Whether the school's data protection officer must review the site is open question 11.

### Security requirements
Each item must be implemented and covered by tests where testable.
1. HTTPS only in production (nginx terminates TLS). Secure cookies. HSTS through helmet.
2. helmet with a strict Content-Security-Policy: `default-src 'self'`, no inline scripts or inline styles, images `'self' data:`. All JavaScript lives in `public/js/`.
3. CSRF tokens on every request that changes state (section 8).
4. Parameterized SQL only (better-sqlite3 prepared statements). Never build SQL by joining strings.
5. Escape all data in EJS with `<%= %>`. Use `<%- %>` only to include your own partials. Descriptions are plain text; render their line breaks safely.
6. Regenerate the session ID at login, destroy the session at logout, and delete the sessions of deactivated users.
7. Login lockout (BR-05), the new-code limit (BR-08), a dummy hash for unknown kennitölur, and timing-safe comparisons. **Do not rate-limit by IP address**: most students share the school's public IP.
8. Check authorization on every teacher and admin route and action (owner, co-teacher or admin).
9. Validate uploads by their content, and store them under random names outside `public/`.
10. No kennitala, code or email body in logs. No stack traces on production error pages.
11. Secrets come only from environment variables. `.env` is git-ignored, and `.env.example` lists only the names.
12. Never put real student data in code, tests, seeds or commits. Use fake kennitölur such as `0000000001`.
13. **Accepted trade-offs (decided by the project owner):**
    - Codes are 6 digits, so protection relies on the per-kennitala lockout.
    - Anyone who knows a classmate's or teacher's kennitala can lock that account for 15 minutes by entering wrong codes.
    - They can also trigger a new code for it at most once every 10 minutes. The owner then has to use the newest emailed code.

---

## 10. Tech stack and hosting

### Locked stack
These come from the original requirements and must not change:
- Node.js backend
- EJS templating
- SCSS compiled to CSS
- SQLite database
- plain JavaScript in the browser

There is no front-end framework, CSS framework, ORM, TypeScript or bundler.

### Runtime and packages
Versions were checked on the npm registry on 2 October 2026. Install these major versions with caret ranges. Several have had recent major releases, so check the current documentation (Context7 or the package README) before using an API.

| Package | Version | Used for |
|---|---|---|
| Node.js | 24 LTS (24.20.0 on the development machine) | Runtime; set `"engines": { "node": ">=24" }` |
| express | ^5.2.1 | Web framework |
| ejs | ^6.0.1 | Templates (views with included partials; no layout plugin) |
| express-session | ^1.19.0 | Sessions, with the custom SQLite store from section 8 |
| better-sqlite3 | ^13.0.3 | SQLite driver; needs Node ≥ 22 and prebuilt binaries or build tools on the server |
| multer | ^2.4.0 | Image and CSV uploads (memory storage) |
| csv-parse | ^7.0.3 | Parsing the CSV import |
| nodemailer | ^10.0.13 | Sending email over SMTP |
| helmet | ^8.3.0 | Security headers and CSP |
| sass (devDependency) | ^1.105.1 | Compiling SCSS to CSS with the `sass` CLI |

### Use Node built-ins instead of extra packages
| Built-in | Replaces |
|---|---|
| `node:crypto` | AES-256-GCM, HMAC, scrypt, `randomInt`, `randomUUID` (no crypto package) |
| `node:test` and `node:assert` | Test frameworks |
| Global `fetch` | An HTTP client for the load test |
| `node --env-file` | dotenv |
| `node --watch` | nodemon |
| `TextDecoder('windows-1252')` | iconv |
| `Intl.DateTimeFormat` with `timeZone: 'Atlantic/Reykjavik'` and locales `is-IS` / `en-GB` | Date libraries |
| Your own `t()` helper with JSON dictionaries | i18n libraries |

**Not allowed without asking first:** any package not in the table above. That includes i18n, rate-limit, session-store, ORM or query-builder, test-framework, CSS or JS framework, EJS layout, and "concurrently"-style packages.

### npm scripts (created in milestone 1)
| Script | What it does |
|---|---|
| `dev` | `node --watch --env-file=.env src/server.js` |
| `watch:css` | `sass --watch scss/main.scss public/css/main.css` (run in a second terminal) |
| `build:css` | Compiles SCSS once, compressed |
| `start` | Production start |
| `migrate` | Applies `src/db/schema.sql` |
| `create-admin` | Creates the first admin (BR-13) |
| `backup` | Runs `scripts/backup.js` |
| `test` | `node --test` |
| `loadtest` | The load test (milestone 8) |
| `seed:dev` | Fake development data only |

### Project structure
The folders below already exist, each with an empty `.gitkeep` file. Leave the `.gitkeep` files in place. `README.md`, `.gitignore`, `CLAUDE.md`, `.claude/` and `docs/` also exist. Do not change them unless asked, except where a milestone says to extend the README or `.gitignore`.
```
README.md              project overview and how the team works; setup is added in milestone 1
.gitignore             already ignores node_modules, .env, data, uploads, backups, compiled CSS
CLAUDE.md              project instructions for Claude Code (points here)
.claude/
  settings.json        shared Claude Code permissions and settings
  agents/
    spec-reviewer.md   read-only reviewer: business rules, security (§9), scope
  commands/
    milestone.md       /milestone N: build one milestone, then stop
    review.md          /review: run spec-reviewer on the current changes
docs/
  AGENT_START.md       this specification
  requirements.md      original requirements (reference only)
  saeludagar-notes.txt original meeting notes (reference only)
src/
  server.js            entry point: env, start app, start jobs
  app.js               express app (helmet, session, csrf, i18n, routes, errors)
  config.js            env parsing and the constants 4 / 4 / 4 (BR-47)
  db/                  index.js (connection + pragmas), schema.sql, migrate.js, sessionStore.js
  middleware/          auth guards, csrf, language, error handlers
  routes/              public.js, auth.js, student.js, teacher.js, admin.js
  services/            crypto, codes, import, events, signups, attendance, choices, export, email, purge, audit
  i18n/                is.json, en.json, index.js (t() with fallback to Icelandic)
  jobs/                outbox.js, sessionCleanup.js, autoPurge.js
  views/
    partials/          head, header, footer, flash messages, event card
    public/ student/ teacher/ admin/ errors/
    emails/            plain-text bilingual email templates
scss/                  main.scss, _tokens.scss (brand colours), partials
public/
  css/                 compiled output (git-ignored)
  js/                  small vanilla scripts (attendance autosave, copy emails, image preview)
  img/                 default-event.svg, logo placeholder
scripts/               create-admin.js, backup.js, loadtest.js, seed-dev.js
test/                  node:test files, named by feature, referencing BR IDs
data/                  SQLite database (git-ignored)
uploads/               event images (git-ignored)
backups/               local backups in development (git-ignored)
```

### Environment variables (`.env.example`)
```
NODE_ENV=development
PORT=3000
BASE_URL=http://localhost:3000
SCHOOL_NAME=
DATABASE_PATH=./data/saeludagar.db
UPLOAD_DIR=./uploads
BACKUP_DIR=./backups
SESSION_SECRET=
KENNITALA_ENC_KEY=
KENNITALA_HMAC_KEY=
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM=
SMTP_MAX_PER_MINUTE=30
TRUST_PROXY=0
```

### Hosting
These were decided in the interview; the items marked "assumed" still need confirming.
- **Server:** the school's own server. The OS is assumed to be Linux (open question 5). The plan:
  - Node runs as a systemd service.
  - nginx sits in front, terminates HTTPS (Let's Encrypt) and proxies to the app.
  - Set `TRUST_PROXY=1`.
- **Domain:** saeludagar.is, replacing whatever is there now (open question 6).
- **Processes:** exactly one Node process, with no cluster mode. SQLite is written from a single process, and WAL mode with `busy_timeout` handles concurrent reads.
- **Email:** the school's SMTP with a noreply address, provided by the kerfisstjóri (open question 4).
- **Backups:** `scripts/backup.js` uses better-sqlite3's online backup API (`db.backup()`). It writes a timestamped copy of the database, plus a copy of `UPLOAD_DIR`, to `BACKUP_DIR`. A daily cron job or systemd timer runs it, and it deletes copies older than 7 days. The off-server location is open question 8.
- **Load:** must handle 1,000 concurrent users (original NFR-04). The peak is when sign-up opens. It must pass the load test in milestone 8.
- **Maintenance after launch:** not decided (open question 7). Write the README so someone new can run imports, settings, backups and deployment.

---

## 11. Design

- **Languages:**
  - The whole UI is in Icelandic and English from the first version. This replaces an earlier "Icelandic only" assumption.
  - Icelandic is the default. The ÍS/EN toggle sits in the header, and the choice is kept in the session (BR-59).
  - Set `<html lang="is">` or `<html lang="en">` to match.
  - Every string lives in `src/i18n/is.json` and `en.json`; no hard-coded text in views.
  - The Icelandic UI uses "viðburður" (BR-61). Emails are bilingual (BR-52).
- **Branding:**
  - Use the school's logo and colours, which will be supplied later (open questions 2–3).
  - Until then, use a neutral placeholder palette defined in one tokens file (`scss/_tokens.scss` → CSS custom properties), so the brand can be swapped in one place. Use a text placeholder for the logo.
  - Site title: "Sæludagar – {SCHOOL_NAME}".
- **Responsive (original NFR-02):**
  - Mobile first, usable from 320 px wide; a card grid on wider screens.
  - The attendance checklist is built for phones, with tap targets of at least 44 px.
- **Browsers (original NFR-03):** current Chrome, Firefox and Safari, on desktop and on mobile (iOS Safari, Android Chrome).
- **Accessibility (WCAG 2.1 AA basics):**
  - keyboard access everywhere, with a visible focus indicator
  - text contrast of at least 4.5:1
  - a label on every input
  - errors linked to their fields and announced to screen readers
  - no information carried by colour alone (for example, "Uppselt" is written as text)
  - the event title as alt text for event images
  - a skip-to-content link
- **JavaScript:** core flows work without JavaScript, using plain forms. JavaScript only adds:
  - attendance autosave, with a "Vista" (save) button as fallback
  - copy-emails-to-clipboard
  - image preview on upload
- **Fonts:** system font stack only, with no external requests.
- **Formats:**

| Item | Icelandic | English |
|---|---|---|
| Date and time | "11. mars 2027, kl. 10:00–12:00" | "11 March 2027, 10:00–12:00" |
| Fee | "2.500 kr." | "ISK 2,500" |
| Free | "Ókeypis" | "Free" |

- **Print:** a print stylesheet for the participant list (BR-51).

---

## 12. Scope

### MVP (finished and approved by 1 February 2027)
Everything in sections 3–11:
- **Accounts:** one login form (kennitala + code), lockout, new-code self-service, sessions and roles.
- **Admin:** settings, CSV import, send codes, teacher accounts, all events, office export, purge (manual and automatic), audit log.
- **Teacher:**
  - events: drafts, preview, publish, edit, delete, image, brautir and restriction flag, co-teachers
  - participants: manual add and remove, copy emails, send a message, printable list
  - attendance checklist
- **Student:** browse and filter by braut, sign up and cancel with every rule, "Mínir viðburðir", course choices.
- **Site-wide:** public front page and event pages, ÍS/EN throughout, responsive, WCAG AA basics.
- **Operations:** daily backups, the 1,000-user load test, deployment notes in the README.

### Later: Should (first after the MVP)
- An email reminder, a few days before the deadline, to students who attended but have not chosen a course. The exact timing is open question 18.
- A search box and a filter by day on the front page.
- A confirmation email when a student signs up or cancels.
- Statistics for the admin: sign-ups and attendance per event and per braut.

### Later: Could
- Copy an existing event to create a new one.
- QR-code attendance.
- Add-to-calendar (.ics) for a student's events.

### Later: not prioritized
- A waiting list for full events.

### Out of scope
- Payment on the site. The participation fee is display only.
- A direct connection to Inna. The CSV export replaces it.
- Microsoft (school account) login.
- Analytics or tracking, and a privacy information page. Both were decided against.

---

## 13. Build plan

**General:**
- Build one milestone at a time.
- After each one, report as rule 3 in section 14 says, then wait.
- Write `node:test` tests for every business rule the milestone touches, and put the BR ID in the test name.
- Use only fake data.

### M1: Scaffold and data model (no features)
Do:
- **Project files:**
  - `package.json` with exactly the dependencies and scripts in section 10.
  - `.gitignore` already exists. It covers `node_modules`, `.env`, `data/*`, `uploads/*`, `backups/*`, `public/css/*` and `.claude/settings.local.json`, and keeps each `.gitkeep`. Only extend it if something new needs ignoring.
  - `.env.example`.
  - `README.md` already exists. Fill in its "Setup" section: setup steps, generating keys, the scripts and the environment variables.
- **App shell:**
  - An Express 5 app with EJS, helmet (CSP), static files and error pages.
  - Header and footer partials.
  - The i18n module with `is.json` and `en.json`, and a working ÍS/EN toggle.
- **Styles:** an SCSS pipeline (`scss/main.scss` plus `_tokens.scss`) compiling to `public/css/main.css`.
- **Database:** the SQLite connection with its pragmas, `src/db/schema.sql` with every table and index in section 7, and `npm run migrate`, which creates the database and sets `user_version = 1`.
- **Stub pages:** a route and empty view for every path in section 6, showing only its title in both languages.
- **Tests:** smoke tests.

Acceptance:
- On a clean checkout with Node 24, `npm install`, `npm run migrate`, `npm run build:css` and `npm run dev` all work.
- `http://localhost:3000` shows the page shell, and the ÍS/EN toggle switches the header text.
- Every path in section 6 renders its stub. Access guards are not needed yet.
- `npm test` passes: the app starts, `/` returns 200, every table and index in section 7 exists, and `user_version = 1`.
- There is no business logic, and no dependencies beyond section 10.

### M2: Login, accounts and email
Do:
- **Security building blocks:** the crypto module (BR-19), code generation and hashing, the custom session store, CSRF and the role guards.
- **Login:** login, logout and lockout, session timeouts, and "Fá nýjan kóða".
- **Accounts:** the `create-admin` script, and admin management of teacher accounts (create, new code, deactivate or reactivate, admin flag).
- **Email:** the outbox, the worker and the development console transport.

Acceptance:
- Tests cover BR-01–BR-06, BR-08–BR-13, BR-19, BR-52 (for code emails) and BR-57.
- A teacher created by the admin receives a code (printed to the console in development) and can log in.
- 5 wrong codes lock that kennitala for 15 minutes.
- A second new-code request within 10 minutes is refused, with the same on-screen message.
- A deactivated teacher cannot log in and loses their sessions.
- The database file contains no plaintext kennitala (test this by searching the file).

### M3: Admin settings, student import, sending codes
Do:
- The settings page: Sæludagar days, sign-up window and deadline (BR-54).
- The CSV import from section 8, with its report and confirm step.
- Re-import behaviour (BR-17).
- The braut list (BR-18).
- "Senda kóða" with throttling and a progress display (BR-07, BR-53).

Acceptance:
- Tests cover BR-07 and BR-14–BR-18.
- A file with several bad rows lists every error and saves nothing.
- A valid file shows a summary, then saves on confirm.
- A re-import deactivates missing students and removes their sign-ups that have no attendance.
- A Windows-1252 file with Icelandic letters imports correctly.
- Codes are sent no faster than `SMTP_MAX_PER_MINUTE`, and priority-0 emails go out first.

### M4: Events
Do:
- **Event editing:** the event form with every field (bilingual title and description, brautir, the restriction flag, image), drafts, preview, publish and co-teachers.
- **Edit and delete rules:** the change and delete rules, with their emails (BR-28, BR-29).
- **Pages:** the teacher home, the admin all-events page, and the public front page and event pages with the braut filter.

Acceptance:
- Tests cover BR-20–BR-30, BR-60 and BR-61.
- A guest sees only published events.
- The preview matches the public page.
- An image over 2 MB, or a file that is not an image, is rejected.
- An event date outside the Sæludagar days is rejected.
- A co-teacher cannot delete the event or manage co-teachers.

### M5: Student sign-up
Do:
- Sign up and cancel, with every check from BR-32 done inside one `BEGIN IMMEDIATE` transaction.
- The sign-up part of "Mínir viðburðir".

Acceptance:
- Tests cover BR-31–BR-36 and BR-43.
- In a concurrency test, 50 simultaneous sign-ups for an event with 10 places give exactly 10 successes.
- The overlap message names the other event.
- A 5th sign-up is refused.
- Sign-up and cancel fail outside the window.

### M6: Teacher tools and attendance
Do:
- **Participants:** the participant table, name search and manual add (BR-37), and removing students.
- **Communication and print:** copying emails, sending a message (BR-50), and the printable list (BR-51).
- **Attendance:** the checklist with autosave and its time window (BR-38, BR-39), and audit entries (BR-56).

Acceptance:
- Tests cover BR-37–BR-39, BR-50, BR-51 and BR-56 (for sign-ups and attendance).
- Adding a student by hand over the maximum works.
- Adding a student by hand who already has 4 sign-ups, or who would get an overlap, is refused.
- Attendance cannot be changed before the event's date or after the deadline.

### M7: Course choices and office export
Do:
- Course choice on "Mínir viðburðir" (BR-40–BR-46), locked after the deadline.
- The office export (BR-48, BR-49).
- The audit log page.

Acceptance:
- Tests cover BR-40–BR-49 and BR-56 (for choices).
- For a seeded scenario, the export matches an expected CSV byte for byte: BOM, `;`, header, rows, and an empty course column where nothing was chosen.
- Choosing the same course for two events is refused.
- Unmarking attendance removes the choice.

### M8: Purge, backups, load test, polish, deployment notes
Do:
- The manual and automatic purge (BR-55).
- `scripts/backup.js` with 7-day rotation.
- `scripts/loadtest.js`.
- An accessibility and browser pass.
- A Linux deployment guide in the README (systemd, nginx, HTTPS, cron or timer for backups, how to set the environment variables). **Do not deploy.**

Acceptance:
- **Purge:** tests show the purge deletes all student data (BR-55) and sets events to draft, and the automatic purge triggers exactly as described in section 8.
- **Backup:** a backup restores into a temporary database, and that is tested.
- **Load test:** against a local test server, 1,000 fake students who are already logged in send their sign-up requests within the same minute. The result must show zero 5xx errors, no event over its maximum and no student over 4 sign-ups. Report p50 and p95 response times, including login timings.
- **Manual checks:** a keyboard-only walkthrough of the student, teacher and admin flows, and checks in Chrome, Firefox and Safari (desktop plus mobile emulation), documented in the README.

---

## 14. Agent rules

- "Only build what this document specifies. Do not add features, abstractions, or dependencies beyond it."
- "Stop and ask before: adding a dependency not listed in section 10, changing the data model after milestone 1, deleting files, running migrations on real data, or deploying."
- "After each milestone output: ✅ [what was completed] and how to verify it, then wait for my go-ahead."

Also:
- Start with milestone 1 only. The project is still in an early phase.
- If this document is unclear or contradicts itself, or if an open question in section 15 blocks your current milestone, stop and ask. Do not guess.
- Never use real kennitölur or real student data anywhere.
- Do not commit or push unless asked.

---

## 15. Open questions

Each item names the section or milestone it blocks and what to do until it is answered.

| # | Question | Blocks | Until answered |
|---|---|---|---|
| 1 | **Final student verification method.** The working plan is kennitala + a 6-digit code sent by email; the team said "we'll figure it out later". | §8, M2 | Build the working plan. |
| 2 | **School name** for the site title. | §11 | Use `SCHOOL_NAME` (empty placeholder). |
| 3 | **School logo files and colour codes.** | §11 | Use the placeholder tokens and a text logo. |
| 4 | **SMTP access** from the kerfisstjóri: host, port, account, noreply address, per-minute sending limit. | §8, §10, real sending in M2–M3 | Use the console transport. |
| 5 | **Server details:** OS (assumed Linux), Node 24 availability, nginx/HTTPS, who sets it up. | §10, M8 deployment notes | Write the notes for Linux. |
| 6 | **Domain saeludagar.is:** who controls the DNS, and what is on the site now. | §10 deployment | Nothing to build. |
| 7 | **Who maintains the site** after launch (imports, settings, updates, problems). | §10, M8 README handover | Write the README for a newcomer. |
| 8 | **Off-server storage** for daily backups and for the encryption keys. | §9, §10, M8 | Back up to `BACKUP_DIR` only. |
| 9 | **Can Berglind deliver the CSV** in the defined format, including emails, course codes and braut names suitable for display? | §8 import, M3 | Build the defined format. |
| 10 | **Does the office accept** the export columns for entering into Inna? | §8 export, M7 | Build as specified. |
| 11 | **Data protection officer:** must the school's persónuverndarfulltrúi review the site before launch, and would they require a privacy notice (currently there is none, BR-58)? | §9, launch | Build without a privacy page. |
| 12 | **"Senda kóða" a second time:** currently it gives everyone new codes and the old ones stop working (BR-07). Should it skip students who have already received a code? | BR-07, M3 | Build BR-07 as written. |
| 13 | **Removing a marked attendee:** may a teacher remove a student whose attendance is already marked? That would also delete the attendance and the course choice. | BR-37, M6 | Ask at M6 before implementing. |
| 14 | **Course list changes on re-import:** if a re-import removes a course from a student's list after they chose it, is the choice kept or cleared? | BR-17 / BR-41, M7 | Ask at M7 before implementing. |
| 15 | **Unpublishing:** can a teacher take a published event back to draft? This is not specified, so it is not built. | §6 | Do not build. |
| 16 | **Who is "gögn gæji"** in the planning notes? | Nothing | — |
| 17 | **Exact dates for Sæludagar 2027**, the sign-up window and the deadline (expected March 2027). | Nothing (the admin enters them) | — |
| 18 | **Reminder timing:** how many days before the deadline the Should-list course reminder goes out. | Later item only | — |
| 19 | **Where to run the load test:** a staging copy on the school's server, or locally only? | M8 | Run it locally. |
| 20 | **Wording of all emails** (codes, notices): school management to approve. | Launch | Draft the texts. |

---

## 16. Sources

### Source key
- **REQ**: `docs/requirements.md`, the original requirements: purpose, users, FR-01–FR-10, NFR-01–NFR-04, user stories, and the "Tæki" stack.
- **NOTES**: `docs/saeludagar-notes.txt` (originally `Sæludagar.txt`), the meeting notes: people, needs, the data source, kennitala checks.
- **INT**: the interview with the project owner on 2 October 2026, including its confirmation round.
- **EMAIL**: the school's email to students of 8 March 2026, pasted by the project owner during the interview (INT).

Older drafts on the `kari` and `Andri` git branches mentioned the roles "Gestur" and "Áfangastjóri" and some teacher notes. They were used only to prompt interview questions; every decision they touched is listed as INT.

### Business rules
| Rule | Source |
|---|---|
| BR-01 | NOTES (10 digits; kennitölur stored as strings); INT (hyphen allowed) |
| BR-02 | REQ FR-01 (kennitala login), FR-02 (Kennarakóði); INT (one form; teachers use kennitala + code) |
| BR-03 | NOTES ("Kerfi kíkir hvort hann sé nemandi"); REQ FR-04/FR-07 (open, resolved in INT) |
| BR-04 | REQ FR-04 (open, resolved in INT: generic message) |
| BR-05 | INT |
| BR-06 | REQ FR-07 (open, resolved in INT); NOTES ("Verification code frá", clarified in INT); INT (6 digits) |
| BR-07 | INT |
| BR-08 | INT |
| BR-09 | INT |
| BR-10 | REQ FR-02; INT |
| BR-11 | INT |
| BR-12 | INT (confirmation round) |
| BR-13 | INT (confirmation round) |
| BR-14 | NOTES (CSV of kennitölur from Berglind); INT (columns and format) |
| BR-15 | NOTES ("Skjalið eyðir síðan út eftir að setja inn") |
| BR-16 | INT (confirmation round) |
| BR-17 | INT |
| BR-18 | NOTES (braut information for filtering, "ef hægt"); INT (derived from the CSV) |
| BR-19 | REQ NFR-01 (open, resolved in INT: reversible encryption) |
| BR-20 | REQ FR-05 (title, host, braut, description, maximum, fee, image); INT (date, times, location, several brautir, flag, bilingual text, co-teachers) |
| BR-21 | INT |
| BR-22 | REQ user story (see how my event appears to students); INT (drafts, preview, publish) |
| BR-23 | REQ FR-06; NOTES ("Heimasíðu sem sýnir öll atburðin"); INT (public viewing; names hidden) |
| BR-24 | INT |
| BR-25 | REQ FR-03; NOTES (button to filter by braut) |
| BR-26 | REQ FR-05 (Þátttökugjald); INT (display only; 0 = free; whole ISK) |
| BR-27 | REQ FR-05 (Mynd); INT (optional, 1 file, ≤ 2 MB, file types) |
| BR-28 | INT |
| BR-29 | INT |
| BR-30 | NOTES ("Fyrir sér-atburður / ferða atburður"); INT (no special rules) |
| BR-31 | INT; EMAIL (one sign-up period for all events) |
| BR-32 | REQ FR-08 (only while places remain); INT (window, braut rule, 4 sign-ups, no overlaps) |
| BR-33 | INT (overlaps banned; standard definition of overlapping time ranges) |
| BR-34 | INT |
| BR-35 | REQ FR-08, NFR-04 |
| BR-36 | REQ FR-08 (cancel on change of mind); INT (only while the window is open) |
| BR-37 | REQ FR-09, user stories (add or remove students); INT (name search, which limits apply) |
| BR-38 | REQ FR-10, user story (record attendance on the day); INT (checklist, saved immediately) |
| BR-39 | INT |
| BR-40 | EMAIL ("Hver mæting á viðburð gildir sem 4 stig í einum áfanga") |
| BR-41 | INT (own courses from the CSV; chosen after attendance is marked) |
| BR-42 | EMAIL (at most 4 points per course) |
| BR-43 | EMAIL (up to 4 courses, 16 points); INT (at most 4 sign-ups) |
| BR-44 | INT |
| BR-45 | INT |
| BR-46 | INT |
| BR-47 | INT |
| BR-48 | INT |
| BR-49 | INT (confirmation round) |
| BR-50 | REQ user story (email everyone signed up for my event); INT (copy list and send from site; Reply-To in confirmation round) |
| BR-51 | REQ user story (overview of everyone signed up); INT (printable list) |
| BR-52 | INT |
| BR-53 | INT |
| BR-54 | INT |
| BR-55 | INT |
| BR-56 | INT |
| BR-57 | INT |
| BR-58 | INT |
| BR-59 | INT (bilingual from the start, changed during the interview) |
| BR-60 | INT |
| BR-61 | INT; EMAIL (the school uses "viðburður") |

### Non-functional requirements and stack
| Item | Source | Where |
|---|---|---|
| NFR-01 (kennitala protection) | REQ, resolved in INT | §8, §9 |
| NFR-02 (responsive) | REQ | §11 |
| NFR-03 (Chrome, Firefox, Safari) | REQ | §11 |
| NFR-04 (1,000 concurrent users) | REQ; INT (load test) | §10, M8 |
| Stack: Node.js, EJS, SCSS, SQLite, JavaScript | REQ ("Tæki") | §10 |
| Express 5, express-session, better-sqlite3, Node 24 LTS, school server, saeludagar.is, school SMTP, daily backups kept 7 days, WCAG AA, school branding, timeline (1 February 2027 / March 2027), MVP, Should, Could, Later and Out of scope lists | INT | §10–§13 |
