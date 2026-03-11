import { Router, type Router as RouterType } from 'express';

export const authRouter: RouterType = Router();

authRouter.post('/register', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

authRouter.post('/login', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

authRouter.get('/me', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});
