-- AGO-68: Invite reward distribution (referrer +200, referee +500, first-bet +100)
-- Adds invite tracking columns to users table.

-- invited_by_code_id: the invite code used during registration (null = no invite)
ALTER TABLE "users"
  ADD COLUMN "invited_by_code_id" uuid;

ALTER TABLE "users"
  ADD CONSTRAINT "users_invited_by_code_id_invite_codes_id_fk"
  FOREIGN KEY ("invited_by_code_id") REFERENCES "invite_codes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- first_bet_rewarded_at: timestamp of when the first-bet rewards were distributed
-- (referee +100 CHIP, referrer +200 CHIP). Null = not yet awarded.
ALTER TABLE "users"
  ADD COLUMN "first_bet_rewarded_at" timestamp;

CREATE INDEX "users_invited_by_code_idx" ON "users" ("invited_by_code_id");
