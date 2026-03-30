ALTER TYPE "public"."game_type" ADD VALUE 'lob_market_making';--> statement-breakpoint
CREATE TABLE "lob_order_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arena_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"tick_number" integer NOT NULL,
	"agent_id" uuid NOT NULL,
	"side" varchar(4) NOT NULL,
	"price" integer NOT NULL,
	"qty" integer NOT NULL,
	"order_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lob_trade_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arena_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"tick_number" integer NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"price" integer NOT NULL,
	"qty" integer NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lob_order_log" ADD CONSTRAINT "lob_order_log_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lob_trade_log" ADD CONSTRAINT "lob_trade_log_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE no action ON UPDATE no action;