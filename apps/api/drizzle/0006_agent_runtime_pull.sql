-- AGO-72: agent runtime pull transport
-- Public agent onboarding no longer requires a webhook api_url.

ALTER TABLE "agents"
  ALTER COLUMN "api_url" DROP NOT NULL;
