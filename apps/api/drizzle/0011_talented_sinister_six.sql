CREATE TABLE "agent_thinking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hand_id" uuid NOT NULL,
	"arena_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"thinking_text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arena_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"amount_chips" integer NOT NULL,
	"odds_at_placement" real NOT NULL,
	"placed_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp,
	"payout" integer,
	"platform_fee_amount" integer,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "api_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "creator_user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "agent_address" varchar(42);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "owner_share_rate" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "allow_sparring_replacement" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "is_smoke" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "game_hands" ADD COLUMN "vrf_commit" varchar(64);--> statement-breakpoint
ALTER TABLE "game_hands" ADD COLUMN "vrf_seed" varchar(64);--> statement-breakpoint
ALTER TABLE "game_hands" ADD COLUMN "vrf_signature" varchar(128);--> statement-breakpoint
ALTER TABLE "game_hands" ADD COLUMN "replay_steps" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invited_by_code_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_bet_rewarded_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_thinking" ADD CONSTRAINT "agent_thinking_hand_id_game_hands_id_fk" FOREIGN KEY ("hand_id") REFERENCES "public"."game_hands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_thinking" ADD CONSTRAINT "agent_thinking_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_thinking" ADD CONSTRAINT "agent_thinking_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_bets" ADD CONSTRAINT "arena_bets_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_bets" ADD CONSTRAINT "arena_bets_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_thinking_hand_idx" ON "agent_thinking" USING btree ("hand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_thinking_unique" ON "agent_thinking" USING btree ("hand_id","agent_id","sequence_number");--> statement-breakpoint
CREATE INDEX "arena_bets_arena_idx" ON "arena_bets" USING btree ("arena_id");--> statement-breakpoint
CREATE INDEX "arena_bets_user_idx" ON "arena_bets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "arena_bets_agent_idx" ON "arena_bets" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "invite_codes_creator_idx" ON "invite_codes" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invite_codes_code_idx" ON "invite_codes" USING btree ("code");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_invited_by_code_id_invite_codes_id_fk" FOREIGN KEY ("invited_by_code_id") REFERENCES "public"."invite_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_creator_idx" ON "agents" USING btree ("creator_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_agent_address_idx" ON "agents" USING btree ("agent_address");--> statement-breakpoint
CREATE INDEX "users_invited_by_code_idx" ON "users" USING btree ("invited_by_code_id");