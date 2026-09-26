import { z } from 'zod';

const localOrigin = z.string().url().refine(value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && url.origin === value && !url.username && !url.password;
  } catch { return false; }
}, 'Expected an exact loopback HTTP(S) origin without a path');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_MODE: z.literal('local-preview').default('local-preview'),
  HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(2567),
  DATABASE_URL: z.string().url().refine(value => ['postgres:', 'postgresql:'].includes(new URL(value).protocol), 'Expected a PostgreSQL URL'),
  CLIENT_DIST: z.string().default('apps/client/dist'),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: localOrigin,
  APP_ORIGIN: localOrigin.optional(),
});
export function parseServerEnv(input: Record<string, string | undefined>) {
  const result = schema.safeParse(input);
  if (!result.success) {
    // Do not include rejected values: DATABASE_URL contains credentials.
    throw new Error(`Invalid server configuration: ${result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  return { ...result.data, APP_ORIGIN: result.data.APP_ORIGIN ?? result.data.BETTER_AUTH_URL };
}
export type ServerEnv = ReturnType<typeof parseServerEnv>;

export function allowedOrigins(env: ServerEnv) {
  const origins = new Set<string>();
  for (const value of [env.BETTER_AUTH_URL, env.APP_ORIGIN, `http://${env.HOST}:${env.PORT}`]) {
    const url = new URL(value);
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      url.hostname = host;
      origins.add(url.origin);
    }
  }
  return origins;
}
