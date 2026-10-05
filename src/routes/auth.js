import express from 'express';

// Stubs until milestone 2 (login, codes, logout).
export function authRouter() {
  const router = express.Router();

  router.get('/login', (req, res) => res.render('public/login'));
  router.get('/login/new-code', (req, res) => res.render('public/new-code'));
  router.post('/logout', (req, res) => res.redirect(303, '/'));

  return router;
}
