// BR-09: a session ends after this long without a request. Every new session starts with the
// student value; login sets the teacher value for teachers and admins.
export const STUDENT_SESSION_MS = 2 * 60 * 60 * 1000;
export const TEACHER_SESSION_MS = 12 * 60 * 60 * 1000;

// Reads the logged-in user from the database on every request, so deactivation and admin-flag
// changes take effect at once (BR-11). Sets req.user, or null for a guest.
export function loadUser(db) {
  const userById = db.prepare('SELECT id, role, is_admin, name, active FROM users WHERE id = ?');
  return (req, res, next) => {
    const { userId } = req.session;
    const row = userId ? userById.get(userId) : undefined;
    if (row?.active === 1) {
      req.user = { id: row.id, role: row.role, isAdmin: row.is_admin === 1, name: row.name };
    } else {
      if (userId) {
        delete req.session.userId;
        delete req.session.role;
        delete req.session.isAdmin;
      }
      req.user = null;
    }
    res.locals.currentUser = req.user;
    next();
  };
}

// BR-02: students land on the student pages; teachers and admins on the teacher pages.
export function homePathFor(user) {
  return user.role === 'student' ? '/my-events' : '/teacher';
}

// Guests are sent to log in; a logged-in user without the role gets the 403 page.
function guard(allowed) {
  return (req, res, next) => {
    if (!req.user) return res.redirect(303, '/login');
    if (!allowed(req.user)) return res.status(403).render('errors/403');
    next();
  };
}

export const requireStudent = guard((user) => user.role === 'student');
export const requireTeacher = guard((user) => user.role === 'teacher');
export const requireAdmin = guard((user) => user.role === 'teacher' && user.isAdmin);
