import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import type { Database } from '@pokewaterblue/database';
import { localTestConnectSchema } from '@pokewaterblue/protocol';
import type { ServerEnv } from './env.js';

const fixtures = [
  { id: 'admin1', email: 'admin1@pokewaterblue.test', name: 'ADMINA' },
  { id: 'admin2', email: 'admin2@pokewaterblue.test', name: 'ADMINB' },
] as const;

export function localTestingEnabled(env: Pick<ServerEnv, 'APP_MODE' | 'NODE_ENV'>) {
  return env.APP_MODE === 'local-preview' && (env.NODE_ENV === 'development' || env.NODE_ENV === 'test');
}

export function localTestingOriginAllowed(origin: string | undefined, origins: Set<string>) {
  if (!origin || !origins.has(origin)) return false;
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && url.origin === origin && !url.username && !url.password;
  } catch { return false; }
}

export async function availableLocalTestAccounts(database: Database) {
  const result = await database.pool.query<{ id: string; email: string; name: string }>(`
    SELECT u.id, u.email, c.name FROM auth_user u JOIN characters c ON c.account_id=u.id
    WHERE u.email=ANY($1::text[]) AND c.stage='development-fixture'`, [fixtures.map(fixture => fixture.email)]);
  return fixtures.flatMap(fixture => {
    const user = result.rows.find(row => row.email === fixture.email && row.name === fixture.name);
    return user ? [{ id: fixture.id, name: fixture.name, userId: user.id }] : [];
  });
}

// Better Auth 1.7.6's public plugin endpoint/cookie APIs use this same adapter
// session path for email login. The application exposes only its guarded route;
// /api/auth/local-testing-connect is not in the HTTP auth operation allowlist.
export function localTestingAuth(database: Database, env: ServerEnv, origins: Set<string>) {
  return {
    id: 'pokewaterblue-local-testing',
    endpoints: {
      connectLocalTestingAccount: createAuthEndpoint('/local-testing-connect', {
        method: 'POST', body: localTestConnectSchema, requireHeaders: true,
      }, async ctx => {
        if (!localTestingEnabled(env) || !localTestingOriginAllowed(ctx.headers.get('origin') ?? undefined, origins)) {
          throw new APIError('FORBIDDEN', { code: 'LOCAL_TESTING_DISABLED', message: 'Quick testing is available only in local development.' });
        }
        const selected = (await availableLocalTestAccounts(database)).find(row => row.id === ctx.body.accountId);
        if (!selected) throw new APIError('NOT_FOUND', { code: 'NOT_FOUND', message: 'This testing trainer is unavailable.' });
        const user = await ctx.context.internalAdapter.findUserById(selected.userId);
        if (!user) throw new APIError('NOT_FOUND', { code: 'NOT_FOUND', message: 'This testing trainer is unavailable.' });
        const currentToken = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
        const current = currentToken ? await ctx.context.internalAdapter.findSession(currentToken) : null;
        if (current && current.session.expiresAt > new Date() && current.user.id === selected.userId) {
          await setSessionCookie(ctx, current);
          return ctx.json({ ok: true, replacedSessionId: null });
        }
        const session = await ctx.context.internalAdapter.createSession(user.id, false);
        if (!session) throw new APIError('SERVICE_UNAVAILABLE', { code: 'DATABASE_UNAVAILABLE', message: 'The testing session could not be created.' });
        try {
          // Revoke only the old browser cookie. Other sessions, trainers, owned
          // assets, leases and saved practice states are never reset here.
          if (currentToken) await ctx.context.internalAdapter.deleteSession(currentToken);
          await setSessionCookie(ctx, { session, user });
        } catch (error) {
          await ctx.context.internalAdapter.deleteSession(session.token);
          throw error;
        }
        return ctx.json({ ok: true, replacedSessionId: current?.session.id ?? null });
      }),
    },
  };
}
