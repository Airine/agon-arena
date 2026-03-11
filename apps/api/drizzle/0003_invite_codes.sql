-- AGO-67: Invite code generation (5 codes per verified user)
-- Creates invite_codes table for referral tracking and CHIP rewards

CREATE TABLE "invite_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(20) NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "used_by_user_id" uuid,
  "used_at" timestamp,
  "referrer_rewarded" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "invite_codes_code_unique" UNIQUE("code")
);

ALTER TABLE "invite_codes"
  ADD CONSTRAINT "invite_codes_created_by_user_id_users_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "invite_codes"
  ADD CONSTRAINT "invite_codes_used_by_user_id_users_id_fk"
  FOREIGN KEY ("used_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX "invite_codes_creator_idx" ON "invite_codes" ("created_by_user_id");
CREATE UNIQUE INDEX "invite_codes_code_idx" ON "invite_codes" ("code");
