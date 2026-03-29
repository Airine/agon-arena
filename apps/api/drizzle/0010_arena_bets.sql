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
ALTER TABLE "arena_bets" ADD CONSTRAINT "arena_bets_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "arena_bets" ADD CONSTRAINT "arena_bets_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "arena_bets_arena_idx" ON "arena_bets" USING btree ("arena_id");
--> statement-breakpoint
CREATE INDEX "arena_bets_user_idx" ON "arena_bets" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "arena_bets_agent_idx" ON "arena_bets" USING btree ("agent_id");
