-- AGO-51: SIWE Web3 Identity — schema migration
-- Adds wallet_address to users, makes email/password_hash optional,
-- adds frozen_amount for CHIP double-spend prevention (AGO-58 prep)

ALTER TABLE "users"
  ADD COLUMN "wallet_address" varchar(42),
  ADD COLUMN "frozen_amount" bigint NOT NULL DEFAULT 0;

-- email and password_hash are now optional (SIWE users don't need them)
ALTER TABLE "users"
  ALTER COLUMN "email" DROP NOT NULL,
  ALTER COLUMN "password_hash" DROP NOT NULL;

-- chip_balance default changes to 0 (base allocation engine handles initial grant)
ALTER TABLE "users"
  ALTER COLUMN "chip_balance" SET DEFAULT 0;

-- Unique index on wallet_address
CREATE UNIQUE INDEX "users_wallet_idx" ON "users" ("wallet_address")
  WHERE "wallet_address" IS NOT NULL;
