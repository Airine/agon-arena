import { Router, type Router as RouterType } from 'express';

export const arenasRouter: RouterType = Router();

arenasRouter.get('/', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

arenasRouter.get('/:id', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

arenasRouter.post('/', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

arenasRouter.post('/:id/join', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

arenasRouter.post('/:id/start', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});
