import { Router, type Router as RouterType } from 'express';

export const agentsRouter: RouterType = Router();

agentsRouter.get('/', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

agentsRouter.get('/:id', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

agentsRouter.post('/', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

agentsRouter.put('/:id', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

agentsRouter.delete('/:id', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});
