import { z } from 'zod';

const corsOriginSchema = z.string().min(1, 'CORS_ORIGIN must not be empty').superRefine((value, ctx) => {
  for (const origin of value.split(',').map((item) => item.trim()).filter(Boolean)) {
    try {
      new URL(origin);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `CORS_ORIGIN entry must be a valid URL: ${origin}`,
      });
    }
  }
});

const envSchema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  CORS_ORIGIN: corsOriginSchema,
  PUBLIC_WEB_ORIGIN: z.string().url('PUBLIC_WEB_ORIGIN must be a valid URL').optional(),
  WEB_ORIGIN: z.string().url('WEB_ORIGIN must be a valid URL').optional(),
  ACTION_ROUND_MIN_MS: z.coerce.number().int().positive().optional(),
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY must not be empty').optional(),
  RESEND_FROM_EMAIL: z.string().min(1, 'RESEND_FROM_EMAIL must not be empty').optional(),
  EMAIL_OTP_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  EMAIL_OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().optional(),
  EMAIL_OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().optional(),
  INVITE_GATE_FREE_LIMIT: z.coerce.number().int().nonnegative().optional(),
});

const result = envSchema.safeParse(process.env);

if (!result.success && process.env['NODE_ENV'] === 'production') {
  const errors = result.error.issues.map((i) => `  ${i.path[0]}: ${i.message}`).join('\n');
  console.error(`[startup] Missing or invalid environment variables:\n${errors}`);
  process.exit(1);
}

if (result.success && process.env['NODE_ENV'] === 'production') {
  const missingEmailEnv = ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'].filter((name) => !process.env[name]);
  if (missingEmailEnv.length > 0) {
    console.error(`[startup] Missing email delivery environment variables:\n${missingEmailEnv.map((name) => `  ${name}: required in production`).join('\n')}`);
    process.exit(1);
  }
}
