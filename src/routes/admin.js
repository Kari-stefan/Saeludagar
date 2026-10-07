import express from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { validateTeacher } from '../services/accounts.js';
import { outboxStatus } from '../services/email.js';

function httpError(status) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

// Mounted at /admin. Settings, import, codes, events, export, purge and audit are stubs until
// milestones 3, 4, 7 and 8.
export function adminRouter({ db, accounts }) {
  const router = express.Router();
  router.use(requireAdmin);

  router.get('/', (req, res) => res.render('admin/home', { outbox: outboxStatus(db) }));
  router.get('/settings', (req, res) => res.render('admin/settings'));
  router.get('/import', (req, res) => res.render('admin/import'));
  router.get('/codes', (req, res) => res.render('admin/codes'));

  // BR-10 to BR-12: teacher accounts.
  const renderTeachers = (res, status = 200, form = {}) =>
    res.status(status).render('admin/teachers', { teachers: accounts.listTeachers(), ...form });

  router.get('/teachers', (req, res) => renderTeachers(res));

  router.post('/teachers', (req, res, next) => {
    const body = req.body ?? {}; // undefined when the request has no form body
    const { action } = body;

    if (action === 'create') {
      const { values, errors } = validateTeacher(body);
      if (Object.keys(errors).length === 0) {
        const result = accounts.createTeacher(values);
        if (result.error) errors.kennitala = result.error;
      }
      // The kennitala is never shown back in the form.
      if (Object.keys(errors).length > 0) {
        return renderTeachers(res, 400, { values: { name: values.name, email: values.email }, errors });
      }
      setFlash(req, 'success', 'admin.teachers.created', { name: values.name, email: values.email });
      return res.redirect(303, '/admin/teachers');
    }

    const actions = {
      'new-code': (id) => accounts.sendTeacherCode(id),
      deactivate: (id) => accounts.setTeacherActive(req.user.id, id, false),
      activate: (id) => accounts.setTeacherActive(req.user.id, id, true),
      'grant-admin': (id) => accounts.setTeacherAdmin(req.user.id, id, true),
      'revoke-admin': (id) => accounts.setTeacherAdmin(req.user.id, id, false),
    };
    const done = {
      'new-code': 'admin.teachers.codeQueued',
      deactivate: 'admin.teachers.deactivated',
      activate: 'admin.teachers.activated',
      'grant-admin': 'admin.teachers.adminGranted',
      'revoke-admin': 'admin.teachers.adminRevoked',
    };
    if (!Object.hasOwn(actions, action)) return next(httpError(400));
    const id = Number(body.id);
    const result = Number.isSafeInteger(id) ? actions[action](id) : null;
    if (!result) return next(httpError(404));

    const { name, email } = result.teacher;
    if (result.error) setFlash(req, 'error', result.error);
    else setFlash(req, 'success', done[action], { name, email });
    res.redirect(303, '/admin/teachers');
  });

  router.get('/events', (req, res) => res.render('admin/events'));
  router.get('/export', (req, res) => res.render('admin/export'));
  router.get('/export.csv', (req, res) => res.status(501).type('text/plain').send(res.locals.t('stub.notImplemented')));
  router.get('/purge', (req, res) => res.render('admin/purge'));
  router.get('/audit', (req, res) => res.render('admin/audit'));

  return router;
}
