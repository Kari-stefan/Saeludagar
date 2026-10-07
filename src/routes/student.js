import express from 'express';
import { requireStudent } from '../middleware/auth.js';

// Stub until milestones 5 and 7.
export function studentRouter() {
  const router = express.Router();

  router.get('/my-events', requireStudent, (req, res) => res.render('student/my-events'));

  return router;
}
