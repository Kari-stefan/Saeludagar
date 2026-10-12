import express from 'express';
import { MAX_SIGNUPS_PER_STUDENT } from '../config.js';
import { requireStudent } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { cancelSignup, signupWindow, studentSignups } from '../services/signups.js';
import { refusalParams } from './public.js';

// "Mínir viðburðir": the sign-up part (milestone 5). Course choices arrive in milestone 7.
export function studentRouter({ db }) {
  const router = express.Router();

  router.get('/my-events', requireStudent, (req, res) => {
    res.render('student/my-events', {
      signups: studentSignups(db, req.user.id),
      window: signupWindow(db),
      max: MAX_SIGNUPS_PER_STUDENT,
    });
  });

  // BR-36: cancel while the window is open.
  router.post('/my-events', requireStudent, (req, res, next) => {
    const body = req.body ?? {};
    const eventId = Number(body.event);
    if (body.action !== 'cancel' || !Number.isSafeInteger(eventId)) {
      return next(Object.assign(new Error('HTTP 400'), { status: 400 }));
    }
    const result = cancelSignup(db, req.user.id, eventId);
    if (result.ok) setFlash(req, 'success', 'signups.cancelled');
    else setFlash(req, 'error', result.error, refusalParams(res, result));
    res.redirect(303, '/my-events');
  });

  return router;
}
