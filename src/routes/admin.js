import express from 'express';
import multer from 'multer';
import { requireAdmin } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { setFlash } from '../middleware/flash.js';
import { validateTeacher } from '../services/accounts.js';
import { outboxStatus } from '../services/email.js';
import { allEvents } from '../services/events.js';
import {
  activeStudentCount, applyImport, brautList, holdImport, MAX_FILE_BYTES, previewImport, readStudentCsv, takeImport,
} from '../services/import.js';
import { addDay, getSettings, removeDay, saveTimes, timeFields } from '../services/settings.js';

function httpError(status) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

// BR-15, §8: the CSV is read into memory only, at most 5 MB, one file.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 5 } })
  .single('file');

// A multer error (such as a file over 5 MB) becomes a message on the form.
function readUpload(req, res, next) {
  upload(req, res, (err) => {
    if (err) req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'import.errors.tooLarge' : 'import.errors.upload';
    next();
  });
}

// Mounted at /admin. Export, purge and audit are stubs until milestones 7 and 8.
export function adminRouter({ config, db, kt, accounts }) {
  const router = express.Router();
  router.use(requireAdmin);

  router.get('/', (req, res) => res.render('admin/home', { outbox: outboxStatus(db), settings: getSettings(db) }));

  // BR-54: Sæludagar days, the sign-up window and the course-choice deadline.
  const renderSettings = (res, status = 200, form = {}) => {
    const settings = getSettings(db);
    res.status(status).render('admin/settings', { settings, times: timeFields(settings), timeErrors: {}, ...form });
  };

  router.get('/settings', (req, res) => renderSettings(res));

  router.post('/settings', (req, res, next) => {
    const body = req.body ?? {};
    const day = String(body.day ?? '').trim();
    if (body.action === 'add-day') {
      const result = addDay(db, day);
      if (result.error) return renderSettings(res, 400, { dayError: result.error, day });
      setFlash(req, 'success', 'admin.settings.dayAdded', { day: res.locals.formatDate(day) });
    } else if (body.action === 'remove-day') {
      const result = removeDay(db, day);
      if (result.error) setFlash(req, 'error', result.error, {
        day: res.locals.formatDate(day),
        events: result.events.map((event) => res.locals.eventText(event, 'title')).join(', '),
      });
      else setFlash(req, 'success', 'admin.settings.dayRemoved');
    } else if (body.action === 'save-times') {
      const { values, errors } = saveTimes(db, body);
      if (Object.keys(errors).length > 0) return renderSettings(res, 400, { times: values, timeErrors: errors });
      setFlash(req, 'success', 'admin.settings.timesSaved');
    } else {
      return next(httpError(400));
    }
    res.redirect(303, '/admin/settings');
  });

  // BR-14 to BR-18: the student CSV import. Upload and check, then confirm (§8, two steps).
  const renderImport = (res, status = 200, page = {}) => res.status(status).render('admin/import', {
    activeStudents: activeStudentCount(db), brautir: brautList(db), errors: [], ...page,
  });

  router.get('/import', (req, res) => renderImport(res));

  // The upload is multipart, so the CSRF token is checked here, after multer (see middleware/csrf.js).
  router.post('/import', readUpload, verifyCsrf, (req, res) => {
    const body = req.body ?? {};

    if (req.is('multipart/form-data')) {
      if (req.uploadError) return renderImport(res, 400, { uploadError: req.uploadError });
      if (!req.file) return renderImport(res, 400, { uploadError: 'import.errors.noFile' });
      const { students, errors } = readStudentCsv(req.file.buffer, { db, kt });
      if (errors.length > 0) return renderImport(res, 400, { errors });
      const token = holdImport(students);
      req.session.importToken = token;
      return renderImport(res, 200, { preview: previewImport(db, kt, students), token });
    }

    // Confirm or cancel the import this session uploaded.
    const ours = typeof body.token === 'string' && body.token === req.session.importToken;
    if (ours) delete req.session.importToken;
    const students = ours ? takeImport(body.token) : null;
    if (body.action === 'cancel') {
      setFlash(req, 'info', 'import.cancelled');
      return res.redirect(303, '/admin/import');
    }
    if (!students) return renderImport(res, 400, { uploadError: 'import.errors.expired' });
    const result = applyImport(db, kt, students, req.user.id);
    if (result.error) return renderImport(res, 400, { uploadError: result.error });
    setFlash(req, 'success', 'import.done', result);
    res.redirect(303, '/admin/import');
  });

  // BR-07: send codes to all active students.
  router.get('/codes', (req, res) => res.render('admin/codes', {
    status: accounts.studentCodeStatus(), maxPerMinute: config.smtp.maxPerMinute,
  }));

  router.post('/codes', (req, res) => {
    setFlash(req, 'success', 'admin.codes.started', { count: accounts.sendStudentCodes() });
    res.redirect(303, '/admin/codes');
  });

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

  // §6: every event, with its owner, linking to its management page.
  router.get('/events', (req, res) => res.render('admin/events', { events: allEvents(db) }));
  router.get('/export', (req, res) => res.render('admin/export'));
  router.get('/export.csv', (req, res) => res.status(501).type('text/plain').send(res.locals.t('stub.notImplemented')));
  router.get('/purge', (req, res) => res.render('admin/purge'));
  router.get('/audit', (req, res) => res.render('admin/audit'));

  return router;
}
