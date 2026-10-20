import { toIso } from '../db/index.js';

// BR-56: who changed a sign-up, an attendance or a course choice, and when. `actorId` is the
// student or teacher who did it. The purge deletes the log (BR-55).
export function audit(db, action, actorId, eventId, studentId, details = {}) {
  db.prepare('INSERT INTO audit_log (at, actor_id, action, event_id, student_id, details) VALUES (?, ?, ?, ?, ?, ?)')
    .run(toIso(), actorId, action, eventId, studentId, JSON.stringify(details));
}
