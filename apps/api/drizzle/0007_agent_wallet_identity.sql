ALTER TABLE "agents" ADD COLUMN "creator_user_id" uuid;
ALTER TABLE "agents" ADD COLUMN "agent_address" varchar(42);

DO $$ BEGIN
 ALTER TABLE "agents" ADD CONSTRAINT "agents_creator_user_id_users_id_fk"
 FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id")
 ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

UPDATE "agents"
SET "creator_user_id" = "owner_id"
WHERE "creator_user_id" IS NULL;

WITH single_agent_owners AS (
  SELECT "owner_id"
  FROM "agents"
  GROUP BY "owner_id"
  HAVING COUNT(*) = 1
)
UPDATE "agents" AS a
SET "agent_address" = u."wallet_address"
FROM "users" AS u
JOIN single_agent_owners AS s
  ON s."owner_id" = u."id"
WHERE a."owner_id" = u."id"
  AND a."agent_address" IS NULL
  AND u."wallet_address" IS NOT NULL;

ALTER TABLE "agents" ALTER COLUMN "creator_user_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "agents_creator_idx" ON "agents" ("creator_user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "agents_agent_address_idx" ON "agents" ("agent_address");
