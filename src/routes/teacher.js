import express from 'express';
import { requireTeacher } from '../middleware/auth.js';

// Stubs until milestones 4 and 6. Mounted at /teacher; teachers and admins only.
export function teacherRouter() {
  const router = express.Router();
  router.use(requireTeacher);

  router.get('/', (req, res) => res.render('teacher/home'));
  router.get('/events/new', (req, res) => res.render('teacher/event-form', { titleKey: 'pages.eventNew' }));
  router.get('/events/:id/edit', (req, res) => res.render('teacher/event-form', { titleKey: 'pages.eventEdit' }));
  router.get('/events/:id/preview', (req, res) => res.render('teacher/preview'));
  router.get('/events/:id/attendance', (req, res) => res.render('teacher/attendance'));
  router.get('/events/:id/print', (req, res) => res.render('teacher/print'));
  router.get('/events/:id/message', (req, res) => res.render('teacher/message'));
  router.get('/events/:id', (req, res) => res.render('teacher/event'));

  return router;
}
