ALTER TABLE "agent_error_log" ALTER COLUMN "error_type" SET DATA TYPE varchar(100);--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "seed" integer;--> statement-breakpoint
CREATE INDEX "agent_error_log_arena_agent_idx" ON "agent_error_log" USING btree ("arena_id","agent_id");--> statement-breakpoint
CREATE INDEX "agent_error_log_created_idx" ON "agent_error_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "arena_turn_log_arena_idx" ON "arena_turn_log" USING btree ("arena_id");--> statement-breakpoint
CREATE INDEX "arena_turn_log_agent_idx" ON "arena_turn_log" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "arena_turn_log_turn_number_idx" ON "arena_turn_log" USING btree ("arena_id","turn_number");