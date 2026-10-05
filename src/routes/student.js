import express from 'express';

// Stub until milestones 5 and 7.
export function studentRouter() {
  const router = express.Router();

  router.get('/my-events', (req, res) => res.render('student/my-events'));

  return router;
}
