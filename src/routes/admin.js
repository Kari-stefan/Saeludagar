import express from 'express';

// Stubs until milestones 2, 3, 7 and 8. Mounted at /admin.
export function adminRouter() {
  const router = express.Router();

  router.get('/', (req, res) => res.render('admin/home'));
  router.get('/settings', (req, res) => res.render('admin/settings'));
  router.get('/import', (req, res) => res.render('admin/import'));
  router.get('/codes', (req, res) => res.render('admin/codes'));
  router.get('/teachers', (req, res) => res.render('admin/teachers'));
  router.get('/events', (req, res) => res.render('admin/events'));
  router.get('/export', (req, res) => res.render('admin/export'));
  router.get('/export.csv', (req, res) => res.status(501).type('text/plain').send(res.locals.t('stub.notImplemented')));
  router.get('/purge', (req, res) => res.render('admin/purge'));
  router.get('/audit', (req, res) => res.render('admin/audit'));

  return router;
}
