CREATE TYPE "public"."arena_mode" AS ENUM('practice', 'cash', 'tournament');--> statement-breakpoint
CREATE TYPE "public"."chip_tx_type" AS ENUM('credit', 'debit', 'freeze', 'unfreeze', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."skill_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."social_provider" AS ENUM('github', 'google', 'twitter', 'ens');--> statement-breakpoint
CREATE TABLE "chip_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "chip_tx_type" NOT NULL,
	"amount" bigint NOT NULL,
	"balance_before" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"frozen_before" bigint NOT NULL,
	"frozen_after" bigint NOT NULL,
	"reference_id" varchar(255),
	"reference_type" varchar(50),
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"file_content" text NOT NULL,
	"file_sha256" varchar(64) NOT NULL,
	"file_size" integer NOT NULL,
	"changelog" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"visibility" "skill_visibility" DEFAULT 'private' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "social_provider" NOT NULL,
	"provider_user_id" varchar(255) NOT NULL,
	"provider_username" varchar(255),
	"provider_email" varchar(255),
	"chip_rewarded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "chip_balance" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "owner_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "mode" "arena_mode" DEFAULT 'practice' NOT NULL;--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "max_hands" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "buy_in_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wallet_address" varchar(42);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "frozen_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chip_transactions" ADD CONSTRAINT "chip_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_bindings" ADD CONSTRAINT "social_bindings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chip_tx_user_idx" ON "chip_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chip_tx_created_idx" ON "chip_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "chip_tx_reference_idx" ON "chip_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "skill_versions_skill_idx" ON "skill_versions" USING btree ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_skill_version_idx" ON "skill_versions" USING btree ("skill_id","version");--> statement-breakpoint
CREATE INDEX "skills_agent_idx" ON "skills" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "skills_visibility_idx" ON "skills" USING btree ("visibility");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_agent_name_idx" ON "skills" USING btree ("agent_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "social_bindings_user_provider_idx" ON "social_bindings" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "social_bindings_provider_uid_idx" ON "social_bindings" USING btree ("provider","provider_user_id");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arenas_mode_idx" ON "arenas" USING btree ("mode");--> statement-breakpoint
CREATE UNIQUE INDEX "users_wallet_idx" ON "users" USING btree ("wallet_address");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address");