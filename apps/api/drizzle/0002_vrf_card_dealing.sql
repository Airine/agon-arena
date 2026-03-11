-- AGO-24: VRF verifiable random card dealing
-- Adds commit-reveal columns to game_hands table

ALTER TABLE "game_hands" ADD COLUMN "vrf_commit" varchar(64);
ALTER TABLE "game_hands" ADD COLUMN "vrf_seed" varchar(64);
ALTER TABLE "game_hands" ADD COLUMN "vrf_signature" varchar(128);
