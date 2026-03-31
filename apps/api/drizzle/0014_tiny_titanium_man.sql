CREATE TABLE "agent_error_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arena_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"turn_id" uuid,
	"error_type" varchar(50) NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_turn_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arena_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"turn_number" integer NOT NULL,
	"state" jsonb,
	"action" jsonb,
	"latency_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "tier" varchar(20);--> statement-breakpoint
ALTER TABLE "agent_error_log" ADD CONSTRAINT "agent_error_log_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_turn_log" ADD CONSTRAINT "arena_turn_log_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE no action ON UPDATE no action;