import express, { type Application, type RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { localTestConnectSchema } from '@pokewaterblue/protocol';
import type { Database } from '@pokewaterblue/database';
import type { GameAuth } from './auth.js';
import type { ServerEnv } from './env.js';
import { isLoopback } from './handshake-room.js';
import { availableLocalTestAccounts, localTestingEnabled, localTestingOriginAllowed } from './local-testing-auth.js';

export function installLocalTestingApi(app: Application, dependencies: {
  auth: GameAuth; database: Database; env: ServerEnv; origins: Set<string>; checkReady: () => Promise<void>;
  sessionRevoked?: (sessionId: string) => void;
}) {
  const { auth, database, env, origins, checkReady } = dependencies;
  let windowStart = Date.now(), requests = 0;
  const guard: RequestHandler = (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    let hostAllowed = false;
    try {
      const host = request.headers.host ?? '', parsed = new URL(`http://${host}`);
      hostAllowed = host === parsed.host && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    } catch { /* Rejected below. */ }
    const origin = request.headers.origin;
    if (!hostAllowed || !isLoopback(request.socket.remoteAddress) ||
        (origin !== undefined && !localTestingOriginAllowed(origin, origins)) ||
        (request.method !== 'GET' && !localTestingOriginAllowed(origin, origins))) {
      response.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'An allowed local application origin is required.' } }); return;
    }
    if (Date.now() - windowStart >= 60_000) { requests = 0; windowStart = Date.now(); }
    if (++requests > 60) {
      response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many testing requests. Try again shortly.' } }); return;
    }
    next();
  };
  app.use('/api/testing', guard);
  app.get('/api/testing/accounts', async (_request, response) => {
    if (!localTestingEnabled(env)) { response.json({ enabled: false, accounts: [] }); return; }
    try {
      await checkReady();
      const accounts = (await availableLocalTestAccounts(database)).map(({ id, name }) => ({ id, name }));
      response.json({ enabled: true, accounts });
    } catch { response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Testing trainers are unavailable. Retry shortly.' } }); }
  });
  app.post('/api/testing/connect', express.json({ limit: '1kb' }), async (request, response) => {
    if (!localTestingEnabled(env)) {
      response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Quick testing is unavailable in this build.' } }); return;
    }
    const parsed = localTestConnectSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'INVALID_MESSAGE', message: 'Choose one of the listed testing trainers.' } }); return;
    }
    try {
      await checkReady();
      const headers = fromNodeHeaders(request.headers);
      headers.set('x-pokewaterblue-peer', request.socket.remoteAddress!);
      const result = await auth.api.connectLocalTestingAccount({ body: parsed.data, headers, asResponse: true });
      if (!result.ok) {
        response.status(result.status).json({ error: { code: result.status === 404 ? 'NOT_FOUND' : 'AUTH_FAILED', message: 'This testing trainer could not be connected.' } }); return;
      }
      const detail = await result.json() as { replacedSessionId: string | null };
      if (detail.replacedSessionId) dependencies.sessionRevoked?.(detail.replacedSessionId);
      response.setHeader('set-cookie', result.headers.getSetCookie());
      response.json({ ok: true });
    } catch { response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Testing trainers are unavailable. Retry shortly.' } }); }
  });
}
