CREATE TYPE "public"."internal_alpha_contact_status" AS ENUM('new', 'contacted', 'installing', 'smoke_passed', 'competing', 'first_action_submitted', 'completed_arena', 'blocked', 'paused', 'lost');--> statement-breakpoint
CREATE TYPE "public"."internal_funnel_bucket_granularity" AS ENUM('day');--> statement-breakpoint
CREATE TYPE "public"."internal_release_gate_status" AS ENUM('unknown', 'blocked', 'at_risk', 'ready');--> statement-breakpoint
CREATE TABLE "internal_alpha_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"agent_id" uuid,
	"display_name" varchar(255) NOT NULL,
	"source" varchar(100) DEFAULT 'manual' NOT NULL,
	"owner_subject" varchar(255),
	"owner_email" varchar(255),
	"status" "internal_alpha_contact_status" DEFAULT 'new' NOT NULL,
	"current_blocker" text,
	"next_follow_up_at" timestamp,
	"last_activity_at" timestamp,
	"notes" text,
	"tags" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internal_funnel_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"stage" varchar(50) NOT NULL,
	"agent_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"arena_id" uuid,
	"source_topic" varchar(100) DEFAULT 'agon.agent.funnel' NOT NULL,
	"source" varchar(100) DEFAULT 'unknown' NOT NULL,
	"framework" varchar(100) DEFAULT 'unknown' NOT NULL,
	"arena_type" varchar(50) DEFAULT 'unknown' NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"ingested_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internal_funnel_stage_rollups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket_start" timestamp NOT NULL,
	"bucket_granularity" "internal_funnel_bucket_granularity" DEFAULT 'day' NOT NULL,
	"stage" varchar(50) NOT NULL,
	"source" varchar(100) DEFAULT 'unknown' NOT NULL,
	"framework" varchar(100) DEFAULT 'unknown' NOT NULL,
	"arena_type" varchar(50) DEFAULT 'unknown' NOT NULL,
	"unique_agents" integer DEFAULT 0 NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internal_release_gates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gate_key" varchar(100) NOT NULL,
	"status" "internal_release_gate_status" DEFAULT 'unknown' NOT NULL,
	"note" text,
	"evidence_url" varchar(500),
	"updated_by_subject" varchar(255),
	"updated_by_email" varchar(255),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "internal_alpha_contacts" ADD CONSTRAINT "internal_alpha_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_alpha_contacts" ADD CONSTRAINT "internal_alpha_contacts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_funnel_events" ADD CONSTRAINT "internal_funnel_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_funnel_events" ADD CONSTRAINT "internal_funnel_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_funnel_events" ADD CONSTRAINT "internal_funnel_events_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "internal_alpha_contacts_status_idx" ON "internal_alpha_contacts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "internal_alpha_contacts_owner_idx" ON "internal_alpha_contacts" USING btree ("owner_subject");--> statement-breakpoint
CREATE INDEX "internal_alpha_contacts_follow_up_idx" ON "internal_alpha_contacts" USING btree ("next_follow_up_at");--> statement-breakpoint
CREATE INDEX "internal_alpha_contacts_user_idx" ON "internal_alpha_contacts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "internal_alpha_contacts_agent_idx" ON "internal_alpha_contacts" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "internal_funnel_events_stage_agent_idx" ON "internal_funnel_events" USING btree ("stage","agent_id");--> statement-breakpoint
CREATE INDEX "internal_funnel_events_agent_idx" ON "internal_funnel_events" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "internal_funnel_events_user_idx" ON "internal_funnel_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "internal_funnel_events_occurred_idx" ON "internal_funnel_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "internal_funnel_rollups_bucket_dim_idx" ON "internal_funnel_stage_rollups" USING btree ("bucket_start","bucket_granularity","stage","source","framework","arena_type");--> statement-breakpoint
CREATE INDEX "internal_funnel_rollups_stage_idx" ON "internal_funnel_stage_rollups" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "internal_funnel_rollups_bucket_idx" ON "internal_funnel_stage_rollups" USING btree ("bucket_start");--> statement-breakpoint
CREATE UNIQUE INDEX "internal_release_gates_key_idx" ON "internal_release_gates" USING btree ("gate_key");--> statement-breakpoint
CREATE INDEX "internal_release_gates_status_idx" ON "internal_release_gates" USING btree ("status");