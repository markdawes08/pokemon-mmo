import { createHash, randomBytes } from 'node:crypto';
import express, { type Application, type ErrorRequestHandler, type RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import { createCharacterSchema, characterErrorSchema, type CharacterError } from '@pokewaterblue/protocol';
import { readAccountSession, type AccountSession, type GameAuth } from './auth.js';
import { CharacterService, CharacterServiceError } from './character-service.js';
import { AssetService } from './asset-service.js';
import { type ServerEnv } from './env.js';

export class AccountApiError extends Error {
  constructor(readonly code: CharacterError['code'], message: string) { super(message); }
}
export function publicError(error: unknown): CharacterError {
  if (error instanceof AccountApiError || error instanceof CharacterServiceError) {
    const parsed = characterErrorSchema.safeParse({ code: error.code, message: error.message });
    if (parsed.success) return parsed.data;
  }
  return { code: 'DATABASE_UNAVAILABLE', message: 'The account service is unavailable. Reconnect before retrying.' };
}
export class AdmissionTickets {
  private readonly entries = new Map<string, { identity: AccountSession; characterId: string; expiresAt: number }>();
  constructor(private readonly now = Date.now) {}
  private prune() { for (const [key, entry] of this.entries) if (entry.expiresAt <= this.now()) this.entries.delete(key); }
  issue(identity: AccountSession, characterId: string) {
    this.prune();
    if (this.entries.size >= 256 || [...this.entries.values()].filter(entry => entry.identity.sessionId === identity.sessionId).length >= 4) {
      throw new AccountApiError('RATE_LIMITED', 'Too many pending connections. Wait briefly and retry.');
    }
    const ticket = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + 15_000;
    this.entries.set(createHash('sha256').update(ticket).digest('hex'), { identity, characterId, expiresAt });
    return { ticket, expiresAt: new Date(expiresAt).toISOString() };
  }
  consume(ticket: string, identity: AccountSession) {
    this.prune();
    const key = createHash('sha256').update(ticket).digest('hex');
    const entry = this.entries.get(key);
    if (!entry || entry.identity.sessionId !== identity.sessionId || entry.identity.userId !== identity.userId) {
      throw new AccountApiError('TICKET_INVALID', 'The connection ticket is invalid or expired.');
    }
    this.entries.delete(key); // Synchronous consume, before any await or acquisition.
    return { identity, characterId: entry.characterId };
  }
  clear() { this.entries.clear(); }
}

export function installAccountApi(app: Application, dependencies: {
  auth: GameAuth; env: ServerEnv; origins: Set<string>; characters: CharacterService; assets: AssetService; tickets: AdmissionTickets; checkReady: () => Promise<void>;
  sessionRevoked?: (sessionId: string) => void;
}) {
  const { auth, env, origins, characters, assets, tickets, checkReady } = dependencies;
  let windowStart = Date.now(); let requests = 0;
  const guard: RequestHandler = (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const origin = request.headers.origin;
    const mutation = request.method !== 'GET' && request.method !== 'HEAD';
    if ((origin !== undefined && !origins.has(origin)) || (mutation && !origin)) {
      response.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'An allowed application origin is required.' } }); return;
    }
    if (Date.now() - windowStart >= 60_000) { requests = 0; windowStart = Date.now(); }
    if (++requests > 240) { response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many account requests. Try again shortly.' } }); return; }
    next();
  };
  app.use(['/api/auth', '/api/account', '/api/characters'], guard);
  const rawAuth = express.raw({ type: 'application/json', limit: '8kb' });
  const authPaths = new Map([
    ['/api/auth/sign-up/email', 'POST'], ['/api/auth/sign-in/email', 'POST'], ['/api/auth/sign-out', 'POST'],
  ]);
  app.all('/api/auth/*splat', rawAuth, async (request, response) => {
    if (authPaths.get(request.path) !== request.method) {
      response.status(404).json({ error: { code: 'NOT_FOUND', message: 'This auth operation is not available in the local build.' } }); return;
    }
    try {
      await checkReady();
      const headers = fromNodeHeaders(request.headers);
      headers.set('x-pokewaterblue-peer', request.socket.remoteAddress ?? '127.0.0.1');
      // Colyseus may install its JSON parser before this Express callback.
      // Support either the raw stream parser or that bounded parsed body.
      const body = request.method === 'POST' ? (Buffer.isBuffer(request.body) ? request.body.toString('utf8') : JSON.stringify(request.body ?? {})) : undefined;
      if (body && Buffer.byteLength(body, 'utf8') > 8192) {
        response.status(400).json({ error: { code: 'INVALID_MESSAGE', message: 'The authentication body is too large.' } }); return;
      }
      const signingOut = request.path === '/api/auth/sign-out' ? await readAccountSession(auth, headers) : null;
      const result = await auth.handler(new Request(new URL(request.originalUrl, env.BETTER_AUTH_URL), { method: request.method, headers, body }));
      if (result.ok && signingOut) dependencies.sessionRevoked?.(signingOut.sessionId);
      response.status(result.status);
      for (const [key, value] of result.headers) if (key !== 'set-cookie' && key !== 'content-length' && key !== 'content-type') response.setHeader(key, value);
      const cookies = result.headers.getSetCookie();
      if (cookies.length) response.setHeader('set-cookie', cookies);
      response.setHeader('Cache-Control', 'no-store');
      // Authentication remains cookie-only at our browser boundary. Never return
      // Better Auth's session token or internal user/account records in JSON.
      if (result.ok) response.json({ ok: true });
      else {
        const detail: unknown = await result.json();
        const parsed = z.object({ code: z.string().max(128), message: z.string().max(256) }).safeParse(detail);
        response.json(parsed.success ? parsed.data : { code: 'AUTH_FAILED', message: 'Authentication failed.' });
      }
    } catch { response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'The account service is unavailable.' } }); }
  });
  const authenticated: RequestHandler = async (request, response, next) => {
    try {
      await checkReady();
      const identity = await readAccountSession(auth, fromNodeHeaders(request.headers));
      if (!identity) { response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } }); return; }
      response.locals['identity'] = identity;
      next();
    } catch { response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'The account service is unavailable.' } }); }
  };
  const fail = (response: express.Response, error: unknown) => {
    const detail = publicError(error);
    response.status(detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'NOT_FOUND' ? 404 : detail.code === 'DATABASE_UNAVAILABLE' ? 503 : detail.code === 'RATE_LIMITED' ? 429 : 409).json({ error: detail });
  };
  app.get('/api/account', authenticated, async (_request, response) => {
    const identity = response.locals['identity'] as AccountSession;
    try { response.json({ user: { id: identity.userId, email: identity.email }, character: await characters.get(identity.userId) }); }
    catch (error) { fail(response, error); }
  });
  app.post('/api/characters', authenticated, express.json({ limit: '2kb' }), async (request, response) => {
    const parsed = createCharacterSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: { code: 'INVALID_MESSAGE', message: 'Character creation requires a command ID and a name of 1–7 letters.' } }); return; }
    const identity = response.locals['identity'] as AccountSession;
    try { response.json({ character: await characters.create(identity.userId, parsed.data, identity.sessionId) }); }
    catch (error) { fail(response, error); }
  });
  app.get('/api/characters/:id/assets', authenticated, async (request, response) => {
    const parsed = z.uuid().safeParse(request.params['id']);
    if (!parsed.success) { response.status(400).json({ error: { code: 'INVALID_MESSAGE', message: 'Invalid trainer ID.' } }); return; }
    const identity = response.locals['identity'] as AccountSession;
    try { response.json(await assets.readOwnAssets(identity.userId, parsed.data, identity.sessionId)); }
    catch (error) { fail(response, error); }
  });
  app.post('/api/characters/:id/ticket', authenticated, express.json({ limit: '1kb' }), async (request, response) => {
    if (!z.uuid().safeParse(request.params['id']).success || !z.strictObject({}).safeParse(request.body ?? {}).success) {
      response.status(400).json({ error: { code: 'INVALID_MESSAGE', message: 'Invalid character admission request.' } }); return;
    }
    const identity = response.locals['identity'] as AccountSession;
    try {
      const character = await characters.get(identity.userId);
      if (!character || character.id !== request.params['id']) throw new AccountApiError('NOT_FOUND', 'Character not found.');
      response.json(tickets.issue(identity, character.id));
    } catch (error) { fail(response, error); }
  });
  const bodyError: ErrorRequestHandler = (_error, _request, response, _next) => {
    response.status(400).json({ error: { code: 'INVALID_MESSAGE', message: 'The request body is invalid or too large.' } });
  };
  app.use(bodyError);
}
