import express from 'express';

export function loadRouter(base = '/api/health') {
  const router = express.Router();
  router.get('/', (_req, res) => res.json({ ok: true }));
  return { base, router };
}