-- AGO-62: Multi-layer CHIP distribution (ownership tree cascade)
-- Adds owner_share_rate to agents: % of prize passed up to parent agent/owner.
-- Default 90 = retain 10%, pass 90% upward (matching PRD FR-AGT-W021 example).

ALTER TABLE "agents"
  ADD COLUMN "owner_share_rate" integer NOT NULL DEFAULT 90;
