import { Router } from 'express';
import { z } from 'zod';
import { requireInternalAuth } from '../middleware/internal-auth.js';
import {
  getInternalAlphaContactDetail,
  getInternalSummary,
  isNotFoundError,
  listInternalAlphaContacts,
  listInternalReleaseGates,
  updateInternalAlphaContact,
  updateInternalReleaseGate,
} from '../services/internal-dashboard.js';

const internalRouter: import('express').Router = Router();

const alphaContactStatusEnum = z.enum([
  'new',
  'contacted',
  'installing',
  'smoke_passed',
  'competing',
  'first_action_submitted',
  'completed_arena',
  'blocked',
  'paused',
  'lost',
]);

const releaseGateStatusEnum = z.enum(['pass', 'watch', 'blocked']);

const alphaListQuerySchema = z.object({
  ownerSubject: z.string().min(1).optional(),
  status: alphaContactStatusEnum.optional(),
  search: z.string().min(1).optional(),
  overdueOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const idParamSchema = z.object({
  id: z.string().min(1),
});

const alphaPatchSchema = z.object({
  ownerSubject: z.string().min(1).nullable().optional(),
  ownerEmail: z.string().email().nullable().optional(),
  status: alphaContactStatusEnum.optional(),
  currentBlocker: z.string().min(1).nullable().optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
}).strict();

const releaseGatePatchSchema = z.object({
  status: releaseGateStatusEnum.optional(),
  note: z.string().nullable().optional(),
  evidenceUrl: z.string().url().nullable().optional(),
}).strict();

internalRouter.use(requireInternalAuth);

internalRouter.get('/summary', async (_req, res) => {
  try {
    res.json(await getInternalSummary());
  } catch (error) {
    console.error('[internal] summary failed', error);
    res.status(500).json({ error: 'Failed to load internal summary' });
  }
});

internalRouter.get('/alpha-contacts', async (req, res) => {
  try {
    const query = alphaListQuerySchema.parse(req.query);
    const result = await listInternalAlphaContacts(query);
    res.json({
      contacts: result.items,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.flatten() });
      return;
    }

    console.error('[internal] alpha contacts list failed', error);
    res.status(500).json({ error: 'Failed to load alpha contacts' });
  }
});

internalRouter.get('/alpha-contacts/:id', async (req, res) => {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json(await getInternalAlphaContactDetail(id));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.flatten() });
      return;
    }
    if (isNotFoundError(error)) {
      res.status(404).json({ error: error.message });
      return;
    }

    console.error('[internal] alpha contact detail failed', error);
    res.status(500).json({ error: 'Failed to load alpha contact detail' });
  }
});

internalRouter.patch('/alpha-contacts/:id', async (req, res) => {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = alphaPatchSchema.parse(req.body);
    res.json(await updateInternalAlphaContact(id, body));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.flatten() });
      return;
    }
    if (isNotFoundError(error)) {
      res.status(404).json({ error: error.message });
      return;
    }

    console.error('[internal] alpha contact patch failed', error);
    res.status(500).json({ error: 'Failed to update alpha contact' });
  }
});

internalRouter.get('/release-gates', async (_req, res) => {
  try {
    res.json({ gates: await listInternalReleaseGates() });
  } catch (error) {
    console.error('[internal] release gate list failed', error);
    res.status(500).json({ error: 'Failed to load release gates' });
  }
});

internalRouter.patch('/release-gates/:id', async (req, res) => {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = releaseGatePatchSchema.parse(req.body);
    res.json(await updateInternalReleaseGate(id, body, req.internalUser!));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.flatten() });
      return;
    }
    if (isNotFoundError(error)) {
      res.status(404).json({ error: error.message });
      return;
    }

    console.error('[internal] release gate patch failed', error);
    res.status(500).json({ error: 'Failed to update release gate' });
  }
});

export { internalRouter };
