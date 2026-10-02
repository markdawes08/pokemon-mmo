import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { schema, type Database } from '@pokewaterblue/database';
import { allowedOrigins, type ServerEnv } from './env.js';
import { log } from './logger.js';
import { localTestingAuth } from './local-testing-auth.js';

export function createAuth(database: Database, env: ServerEnv, origins = allowedOrigins(env)) {
  return betterAuth({
    appName: 'Pokewaterblue local', baseURL: env.BETTER_AUTH_URL, basePath: '/api/auth', secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(database.db, {
      provider: 'pg', schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
      transaction: true,
    }),
    trustedOrigins: () => [...origins],
    plugins: [localTestingAuth(database, env, origins)],
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128, requireEmailVerification: false },
    session: { expiresIn: 60 * 60 * 24, disableSessionRefresh: true, cookieCache: { enabled: false } },
    advanced: {
      useSecureCookies: env.BETTER_AUTH_URL.startsWith('https:'),
      cookiePrefix: 'pokewaterblue', defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: ['x-pokewaterblue-peer'] },
    },
    rateLimit: { enabled: true, window: 60, max: 100, storage: 'memory', customRules: {
      '/sign-in/email': { window: 60, max: 10 }, '/sign-up/email': { window: 60, max: 5 },
    } },
    // Library diagnostics can contain adapter values. Publish a safe event only.
    logger: { level: 'warn', log: level => log(level, 'auth_library_diagnostic') },
  });
}
export type GameAuth = ReturnType<typeof createAuth>;
export type AccountSession = { sessionId: string; userId: string; email: string };
export async function readAccountSession(auth: GameAuth, headers: Headers): Promise<AccountSession | null> {
  const result = await auth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } });
  return result ? { sessionId: result.session.id, userId: result.user.id, email: result.user.email } : null;
}
export async function sessionStillValid(database: Database, identity: AccountSession): Promise<boolean> {
  const result = await database.pool.query('SELECT 1 FROM auth_session WHERE id=$1 AND user_id=$2 AND expires_at>clock_timestamp()', [identity.sessionId, identity.userId]);
  return result.rowCount === 1;
}
