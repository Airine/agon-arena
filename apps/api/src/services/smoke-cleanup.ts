import { and, eq, lt } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const SMOKE_ARENA_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;     // every 5 minutes

async function cleanupSmokeArenas(): Promise<void> {
  const cutoff = new Date(Date.now() - SMOKE_ARENA_MAX_AGE_MS);
  const deleted = await db
    .delete(schema.arenas)
    .where(
      and(
        eq(schema.arenas.isSmoke, true),
        lt(schema.arenas.createdAt, cutoff),
      ),
    )
    .returning({ id: schema.arenas.id });

  if (deleted.length > 0) {
    console.log(`[smoke-cleanup] Deleted ${deleted.length} smoke arena(s)`);
  }
}

export function startSmokeCleanup(): void {
  // Run immediately, then on interval
  void cleanupSmokeArenas().catch((err) => {
    console.error('[smoke-cleanup] Initial cleanup failed:', err);
  });

  setInterval(() => {
    void cleanupSmokeArenas().catch((err) => {
      console.error('[smoke-cleanup] Cleanup failed:', err);
    });
  }, CLEANUP_INTERVAL_MS).unref(); // .unref() so it doesn't prevent process exit
}
