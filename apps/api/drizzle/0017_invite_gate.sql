ALTER TABLE "users"
  ADD COLUMN "invite_gate_satisfied_at" timestamp,
  ADD COLUMN "invite_gate_reason" varchar(32);
--> statement-breakpoint
CREATE INDEX "users_invite_gate_idx" ON "users" ("invite_gate_satisfied_at");
