import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

export const skillsRouter: RouterType = Router();

const MAX_FILE_SIZE = 256 * 1024; // 256 KB

const createSkillSchema = z.object({
  agentId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  visibility: z.enum(['public', 'private']).default('private'),
  fileContent: z.string().min(1).max(MAX_FILE_SIZE),
  changelog: z.string().max(500).optional(),
});

const updateSkillSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).nullable().optional(),
  visibility: z.enum(['public', 'private']).optional(),
});

const uploadVersionSchema = z.object({
  fileContent: z.string().min(1).max(MAX_FILE_SIZE),
  changelog: z.string().max(500).optional(),
});

/**
 * Verify caller owns the agent that owns the skill.
 */
async function verifyAgentOwner(agentId: string, userId: string): Promise<boolean> {
  const [agent] = await db
    .select({ ownerId: schema.agents.ownerId })
    .from(schema.agents)
    .where(eq(schema.agents.id, agentId))
    .limit(1);
  return agent?.ownerId === userId;
}

/**
 * POST /skills - Create a new skill with initial version (v1).
 */
skillsRouter.post('/', requireAuth, async (req, res) => {
  try {
    const body = createSkillSchema.parse(req.body);

    if (!(await verifyAgentOwner(body.agentId, req.user!.userId))) {
      res.status(403).json({ error: 'Not authorized to manage skills for this agent' });
      return;
    }

    const fileSha256 = crypto.createHash('sha256').update(body.fileContent).digest('hex');
    const fileSize = Buffer.byteLength(body.fileContent, 'utf-8');

    // Insert skill + initial version in a transaction
    const result = await db.transaction(async (tx) => {
      const [skill] = await tx
        .insert(schema.skills)
        .values({
          agentId: body.agentId,
          name: body.name,
          description: body.description ?? null,
          visibility: body.visibility,
          currentVersion: 1,
        })
        .returning();

      const [version] = await tx
        .insert(schema.skillVersions)
        .values({
          skillId: skill!.id,
          version: 1,
          fileContent: body.fileContent,
          fileSha256,
          fileSize,
          changelog: body.changelog ?? null,
        })
        .returning({
          id: schema.skillVersions.id,
          version: schema.skillVersions.version,
          fileSha256: schema.skillVersions.fileSha256,
          fileSize: schema.skillVersions.fileSize,
          changelog: schema.skillVersions.changelog,
          createdAt: schema.skillVersions.createdAt,
        });

      return { skill: skill!, version: version! };
    });

    res.status(201).json({
      skill: {
        id: result.skill.id,
        agentId: result.skill.agentId,
        name: result.skill.name,
        description: result.skill.description,
        visibility: result.skill.visibility,
        currentVersion: result.skill.currentVersion,
        createdAt: result.skill.createdAt,
        updatedAt: result.skill.updatedAt,
      },
      version: result.version,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    // Unique constraint violation (duplicate name for same agent)
    if (err instanceof Error && err.message.includes('unique')) {
      res.status(409).json({ error: 'A skill with this name already exists for this agent' });
      return;
    }
    res.status(500).json({ error: 'Failed to create skill' });
  }
});

/**
 * GET /skills?agentId= - List skills for an agent.
 * Public skills are visible to all; private only to owner.
 */
skillsRouter.get('/', async (req, res) => {
  try {
    const agentId = req.query['agentId'] as string | undefined;
    if (!agentId) {
      res.status(400).json({ error: 'agentId query parameter is required' });
      return;
    }

    // Check if caller is the agent owner (for private skill access)
    const isOwner = req.user ? await verifyAgentOwner(agentId, req.user.userId) : false;

    const conditions = [eq(schema.skills.agentId, agentId)];
    if (!isOwner) {
      conditions.push(eq(schema.skills.visibility, 'public'));
    }

    const skills = await db
      .select({
        id: schema.skills.id,
        agentId: schema.skills.agentId,
        name: schema.skills.name,
        description: schema.skills.description,
        visibility: schema.skills.visibility,
        currentVersion: schema.skills.currentVersion,
        createdAt: schema.skills.createdAt,
        updatedAt: schema.skills.updatedAt,
      })
      .from(schema.skills)
      .where(and(...conditions))
      .orderBy(desc(schema.skills.updatedAt))
      .limit(50);

    res.json({ skills });
  } catch {
    res.status(500).json({ error: 'Failed to list skills' });
  }
});

/**
 * GET /skills/:id - Get skill detail.
 */
skillsRouter.get('/:id', async (req, res) => {
  try {
    const skillId = String(req.params['id']);

    const [skill] = await db
      .select({
        id: schema.skills.id,
        agentId: schema.skills.agentId,
        name: schema.skills.name,
        description: schema.skills.description,
        visibility: schema.skills.visibility,
        currentVersion: schema.skills.currentVersion,
        createdAt: schema.skills.createdAt,
        updatedAt: schema.skills.updatedAt,
      })
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId))
      .limit(1);

    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    // Private skills only visible to owner
    if (skill.visibility === 'private') {
      const isOwner = req.user ? await verifyAgentOwner(skill.agentId, req.user.userId) : false;
      if (!isOwner) {
        res.status(404).json({ error: 'Skill not found' });
        return;
      }
    }

    res.json(skill);
  } catch {
    res.status(500).json({ error: 'Failed to fetch skill' });
  }
});

/**
 * PUT /skills/:id - Update skill metadata (name, description, visibility). Owner only.
 */
skillsRouter.put('/:id', requireAuth, async (req, res) => {
  try {
    const body = updateSkillSchema.parse(req.body);
    const skillId = String(req.params['id']);

    const [skill] = await db
      .select({ agentId: schema.skills.agentId })
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId))
      .limit(1);

    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    if (!(await verifyAgentOwner(skill.agentId, req.user!.userId))) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    const [updated] = await db
      .update(schema.skills)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.visibility !== undefined && { visibility: body.visibility }),
        updatedAt: new Date(),
      })
      .where(eq(schema.skills.id, skillId))
      .returning({
        id: schema.skills.id,
        agentId: schema.skills.agentId,
        name: schema.skills.name,
        description: schema.skills.description,
        visibility: schema.skills.visibility,
        currentVersion: schema.skills.currentVersion,
        createdAt: schema.skills.createdAt,
        updatedAt: schema.skills.updatedAt,
      });

    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: 'Failed to update skill' });
  }
});

/**
 * DELETE /skills/:id - Delete skill and all versions. Owner only.
 */
skillsRouter.delete('/:id', requireAuth, async (req, res) => {
  try {
    const skillId = String(req.params['id']);

    const [skill] = await db
      .select({ agentId: schema.skills.agentId })
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId))
      .limit(1);

    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    if (!(await verifyAgentOwner(skill.agentId, req.user!.userId))) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    // Cascade deletes versions via FK onDelete: 'cascade'
    await db.delete(schema.skills).where(eq(schema.skills.id, skillId));

    res.json({ message: 'Skill deleted' });
  } catch {
    res.status(500).json({ error: 'Failed to delete skill' });
  }
});

/**
 * POST /skills/:id/versions - Upload a new version. Owner only.
 * Auto-increments version number. Rejects duplicate content (same SHA-256).
 */
skillsRouter.post('/:id/versions', requireAuth, async (req, res) => {
  try {
    const body = uploadVersionSchema.parse(req.body);
    const skillId = String(req.params['id']);

    const [skill] = await db
      .select({
        agentId: schema.skills.agentId,
        currentVersion: schema.skills.currentVersion,
      })
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId))
      .limit(1);

    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    if (!(await verifyAgentOwner(skill.agentId, req.user!.userId))) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    const fileSha256 = crypto.createHash('sha256').update(body.fileContent).digest('hex');
    const fileSize = Buffer.byteLength(body.fileContent, 'utf-8');

    // Reject duplicate content
    const [existingHash] = await db
      .select({ id: schema.skillVersions.id })
      .from(schema.skillVersions)
      .where(and(
        eq(schema.skillVersions.skillId, skillId),
        eq(schema.skillVersions.fileSha256, fileSha256),
      ))
      .limit(1);

    if (existingHash) {
      res.status(409).json({ error: 'Identical content already exists as a previous version' });
      return;
    }

    const nextVersion = skill.currentVersion + 1;

    const result = await db.transaction(async (tx) => {
      const [version] = await tx
        .insert(schema.skillVersions)
        .values({
          skillId,
          version: nextVersion,
          fileContent: body.fileContent,
          fileSha256,
          fileSize,
          changelog: body.changelog ?? null,
        })
        .returning({
          id: schema.skillVersions.id,
          version: schema.skillVersions.version,
          fileSha256: schema.skillVersions.fileSha256,
          fileSize: schema.skillVersions.fileSize,
          changelog: schema.skillVersions.changelog,
          createdAt: schema.skillVersions.createdAt,
        });

      await tx
        .update(schema.skills)
        .set({ currentVersion: nextVersion, updatedAt: new Date() })
        .where(eq(schema.skills.id, skillId));

      return version!;
    });

    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: 'Failed to upload version' });
  }
});

/**
 * GET /skills/:id/versions - List all versions. Content not included.
 */
skillsRouter.get('/:id/versions', async (req, res) => {
  try {
    const skillId = String(req.params['id']);

    // Verify skill exists and check visibility
    const [skill] = await db
      .select({
        agentId: schema.skills.agentId,
        visibility: schema.skills.visibility,
      })
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId))
      .limit(1);

    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    if (skill.visibility === 'private') {
      const isOwner = req.user ? await verifyAgentOwner(skill.agentId, req.user.userId) : false;
      if (!isOwner) {
        res.status(404).json({ error: 'Skill not found' });
        return;
      }
    }

    const versions = await db
      .select({
        id: schema.skillVersions.id,
        skillId: schema.skillVersions.skillId,
        version: schema.skillVersions.version,
        fileSha256: schema.skillVersions.fileSha256,
        fileSize: schema.skillVersions.fileSize,
        changelog: schema.skillVersions.changelog,
        createdAt: schema.skillVersions.createdAt,
      })
      .from(schema.skillVersions)
      .where(eq(schema.skillVersions.skillId, skillId))
      .orderBy(desc(schema.skillVersions.version))
      .limit(100);

    res.json({ versions });
  } catch {
    res.status(500).json({ error: 'Failed to list versions' });
  }
});

/**
 * GET /skills/:id/versions/:version - Get specific version with file content.
 */
skillsRouter.get('/:id/versions/:version', async (req, res) => {
  try {
    const skillId = String(req.params['id']);
    const versionNum = parseInt(String(req.params['version']), 10);
    if (isNaN(versionNum) || versionNum < 1) {
      res.status(400).json({ error: 'Invalid version number' });
      return;
    }

    // Verify skill exists and check visibility
    const [skill] = await db
      .select({
        agentId: schema.skills.agentId,
        visibility: schema.skills.visibility,
      })
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId))
      .limit(1);

    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    if (skill.visibility === 'private') {
      const isOwner = req.user ? await verifyAgentOwner(skill.agentId, req.user.userId) : false;
      if (!isOwner) {
        res.status(404).json({ error: 'Skill not found' });
        return;
      }
    }

    const [version] = await db
      .select()
      .from(schema.skillVersions)
      .where(and(
        eq(schema.skillVersions.skillId, skillId),
        eq(schema.skillVersions.version, versionNum),
      ))
      .limit(1);

    if (!version) {
      res.status(404).json({ error: 'Version not found' });
      return;
    }

    res.json(version);
  } catch {
    res.status(500).json({ error: 'Failed to fetch version' });
  }
});
