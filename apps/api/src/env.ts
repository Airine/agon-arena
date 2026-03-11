import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  CORS_ORIGIN: z.string().url('CORS_ORIGIN must be a valid URL'),
});

const result = envSchema.safeParse(process.env);

if (!result.success && process.env['NODE_ENV'] === 'production') {
  const errors = result.error.issues.map((i) => `  ${i.path[0]}: ${i.message}`).join('\n');
  console.error(`[startup] Missing or invalid environment variables:\n${errors}`);
  process.exit(1);
}
