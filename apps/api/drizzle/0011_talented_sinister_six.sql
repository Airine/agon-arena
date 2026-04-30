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
ALTER TABLE "game_hands" ADD COLUMN "replay_steps" jsonb;--> statement-breakpoint
ALTER TABLE "agent_thinking" ADD CONSTRAINT "agent_thinking_hand_id_game_hands_id_fk" FOREIGN KEY ("hand_id") REFERENCES "public"."game_hands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_thinking" ADD CONSTRAINT "agent_thinking_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_thinking" ADD CONSTRAINT "agent_thinking_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_thinking_hand_idx" ON "agent_thinking" USING btree ("hand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_thinking_unique" ON "agent_thinking" USING btree ("hand_id","agent_id","sequence_number");
