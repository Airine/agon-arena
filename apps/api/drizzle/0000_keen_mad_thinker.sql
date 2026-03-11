CREATE TYPE "public"."action_type" AS ENUM('fold', 'check', 'call', 'raise', 'all_in', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."arena_status" AS ENUM('waiting', 'running', 'finished', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."game_stage" AS ENUM('waiting', 'pre_flop', 'flop', 'turn', 'river', 'showdown', 'finished');--> statement-breakpoint
CREATE TYPE "public"."game_type" AS ENUM('texas_holdem');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"api_url" varchar(500) NOT NULL,
	"api_key_hash" varchar(255),
	"webhook_public_key" varchar(128),
	"avatar_url" varchar(500),
	"version" varchar(20) DEFAULT '1.0' NOT NULL,
	"metadata" jsonb,
	"elo_rating" integer DEFAULT 1200 NOT NULL,
	"hands_played" integer DEFAULT 0 NOT NULL,
	"hands_won" integer DEFAULT 0 NOT NULL,
	"total_chips_won" bigint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_seats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arena_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"seat_index" integer NOT NULL,
	"current_stack" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arenas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"game_type" "game_type" DEFAULT 'texas_holdem' NOT NULL,
	"status" "arena_status" DEFAULT 'waiting' NOT NULL,
	"max_players" integer DEFAULT 6 NOT NULL,
	"small_blind" integer DEFAULT 10 NOT NULL,
	"big_blind" integer DEFAULT 20 NOT NULL,
	"starting_stack" integer DEFAULT 1000 NOT NULL,
	"current_hand_number" integer DEFAULT 0 NOT NULL,
	"spectator_count" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hand_id" uuid NOT NULL,
	"arena_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"action_type" "action_type" NOT NULL,
	"amount" integer,
	"stage" "game_stage" NOT NULL,
	"sequence_number" integer NOT NULL,
	"response_time_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_hands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arena_id" uuid NOT NULL,
	"hand_number" integer NOT NULL,
	"stage" "game_stage" DEFAULT 'pre_flop' NOT NULL,
	"state_snapshot" jsonb,
	"community_cards" jsonb,
	"pot_amount" integer DEFAULT 0 NOT NULL,
	"winners_json" jsonb,
	"dealer_index" integer NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(50) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"chip_balance" bigint DEFAULT 10000 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_seats" ADD CONSTRAINT "arena_seats_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_seats" ADD CONSTRAINT "arena_seats_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arenas" ADD CONSTRAINT "arenas_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_actions" ADD CONSTRAINT "game_actions_hand_id_game_hands_id_fk" FOREIGN KEY ("hand_id") REFERENCES "public"."game_hands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_actions" ADD CONSTRAINT "game_actions_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_actions" ADD CONSTRAINT "game_actions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_hands" ADD CONSTRAINT "game_hands_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_owner_idx" ON "agents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "agents_elo_idx" ON "agents" USING btree ("elo_rating");--> statement-breakpoint
CREATE INDEX "arena_seats_arena_idx" ON "arena_seats" USING btree ("arena_id");--> statement-breakpoint
CREATE UNIQUE INDEX "arena_seats_unique_seat" ON "arena_seats" USING btree ("arena_id","seat_index");--> statement-breakpoint
CREATE INDEX "arenas_status_idx" ON "arenas" USING btree ("status");--> statement-breakpoint
CREATE INDEX "game_actions_hand_idx" ON "game_actions" USING btree ("hand_id");--> statement-breakpoint
CREATE INDEX "game_actions_arena_idx" ON "game_actions" USING btree ("arena_id");--> statement-breakpoint
CREATE INDEX "game_actions_agent_idx" ON "game_actions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "game_hands_arena_idx" ON "game_hands" USING btree ("arena_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_hands_arena_number_idx" ON "game_hands" USING btree ("arena_id","hand_number");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_idx" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");