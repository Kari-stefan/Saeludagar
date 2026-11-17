import express from 'express';
import { POINTS_PER_ATTENDANCE } from '../config.js';
import { requireStudent } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { givePoints, studentPoints, takePoints } from '../services/choices.js';

export function studentRouter({ db }) {
  const router = express.Router();

  // "Mínir viðburðir" moved to the front page (BR-64); old links keep working.
  router.get('/my-events', requireStudent, (req, res) => res.redirect(303, '/#mine-events'));

  // BR-69 "Fjarvistastig": the points the student has earned, and their courses to give them to.
  router.get('/points', requireStudent, (req, res) => {
    res.render('student/points', { points: studentPoints(db, req.user.id) });
  });

  // One step of a course's stepper: "give" puts the points of one attendance on the course, "take"
  // takes them back. The page's script sends the same form, and reads the page that comes back.
  router.post('/points', requireStudent, (req, res, next) => {
    const { action, course } = req.body ?? {};
    if (!['give', 'take'].includes(action) || typeof course !== 'string' || course === '') {
      return next(Object.assign(new Error('HTTP 400'), { status: 400 }));
    }
    const result = action === 'give' ? givePoints(db, req.user.id, course) : takePoints(db, req.user.id, course);
    if (result.error) setFlash(req, 'error', result.error, result.params);
    else setFlash(req, 'success', action === 'give' ? 'points.given' : 'points.taken', { course, points: POINTS_PER_ATTENDANCE });
    res.redirect(303, '/points');
  });

  return router;
}
