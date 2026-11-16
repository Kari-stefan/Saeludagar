import express from 'express';
import { requireStudent } from '../middleware/auth.js';

// "Mínir viðburðir" moved to the front page (BR-64); old links keep working.
export function studentRouter() {
  const router = express.Router();
  router.get('/my-events', requireStudent, (req, res) => res.redirect(303, '/#mine-events'));
  return router;
}
