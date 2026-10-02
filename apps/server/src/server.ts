import { createServer, type IncomingMessage, type RequestListener } from 'node:http';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import express from 'express';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { createDatabase, checkDatabaseReady } from '@pokewaterblue/database';
import { CHARACTER_ROOM, HANDSHAKE_ROOM, PROTOCOL_VERSION, SERVER_VERSION } from '@pokewaterblue/protocol';
import { createHandshakeRoom, isLoopback } from './handshake-room.js';
import { frameworkLogger, log } from './logger.js';
import { allowedOrigins, type ServerEnv } from './env.js';
import { createAuth, readAccountSession } from './auth.js';
import { AdmissionTickets, installAccountApi } from './account-api.js';
import { CharacterService, type CharacterServiceTestHooks } from './character-service.js';
import { AssetService } from './asset-service.js';
import { createCharacterRoom } from './character-room.js';
import { WorldContent } from './world-content.js';
import { WorldService } from './world-service.js';
import { ReconnectionBindings } from './reconnection-bindings.js';
import { guardReconnectHttp } from './reconnect-http.js';
import { loadPracticeEngine } from './practice-engine.js';

function localHost(value: string | undefined): boolean {
  if (!value) return false;
  try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(`http://${value}`).hostname); }
  catch { return false; }
}
export function localRequestAllowed(request: Pick<IncomingMessage, 'headers' | 'socket'>, origins?: Set<string>) {
  if (!isLoopback(request.socket.remoteAddress) || !localHost(request.headers.host)) return false;
  const origin = request.headers.origin;
  if (!origin) return true; // Command-line checks have no Origin; browser requests must use a local origin.
  if (origins) return origins.has(origin);
  try { const parsed = new URL(origin); return ['http:', 'https:'].includes(parsed.protocol) && localHost(parsed.host); }
  catch { return false; }
}
export async function createGameServer(env: ServerEnv, options: { now?: () => number; characterTestHooks?: CharacterServiceTestHooks } = {}) {
  const contentHash = createHash('sha256').update(await readFile(resolve('content/generated/manifests/content-manifest.json'))).digest('hex');
  const database = createDatabase(env.DATABASE_URL);
  const origins = allowedOrigins(env);
  const auth = createAuth(database, env, origins);
  const characterService = new CharacterService(database, { testHooks: options.characterTestHooks });
  characterService.configureWorld(await WorldContent.load(), env.APP_MODE === 'local-preview' && env.NODE_ENV !== 'production');
  characterService.configurePractice(await loadPracticeEngine(), env.APP_MODE === 'local-preview' && env.NODE_ENV !== 'production');
  const world = new WorldService(characterService, contentHash);
  const assetService = new AssetService(database);
  const tickets = new AdmissionTickets(options.now);
  const reconnections = new ReconnectionBindings();
  let stopping = false;
  const checkReady = async () => {
    if (stopping) throw new Error('Server is stopping');
    await checkDatabaseReady(database, PROTOCOL_VERSION);
    await database.pool.query(`SELECT u.id, s.id, a.id, v.id, c.id, c.position_elevation, c.position_facing, c.transition_generation, c.world_checkpoint_id, l.character_id, r.command_id, cr.command_id,
        ps.revision, ps.battle_id, ps.checkpoint, pr.command_id, pr.payload_hash
      FROM auth_user u, auth_session s, auth_account a, auth_verification v,
        characters c, character_leases l, character_command_receipts r, account_creation_receipts cr,
        character_practice_state ps, practice_command_receipts pr LIMIT 0`);
    const assets = await database.pool.query<{ missing: string }>(`SELECT name AS missing FROM unnest($1::text[]) AS names(name) WHERE to_regclass(name) IS NULL`, [[
      'content_versions', 'content_species', 'content_moves', 'content_abilities', 'content_items',
      'creatures', 'creature_moves', 'character_inventory', 'character_wallets', 'domain_outcomes',
      'character_flags', 'character_variables', 'character_claims', 'character_map_patches',
      'character_trainer_completions', 'audit_events',
    ]]);
    if (assets.rowCount) throw new Error('Asset schema migration required.');
  };
  const httpServer = createServer();
  const transport = new WebSocketTransport({
    server: httpServer,
    maxPayload: 4096,
    verifyClient: (info: { req: IncomingMessage }) => localRequestAllowed(info.req, origins),
    beforeUpgrade: async (request, context) => {
      const url = new URL(request.url), token = url.searchParams.get('reconnectionToken');
      if (!token) return;
      // Colyseus uses the last path segment as room ID; this also handles Vite's /socket prefix.
      const roomId = url.pathname.match(/\/[a-zA-Z0-9_-]+\/([a-zA-Z0-9_-]+)$/)?.[1];
      if (stopping || !isLoopback(context.ip) || !origins.has(context.headers.get('origin') ?? '') ||
          !roomId || token.length > 256) return new Response(null, { status: 403 });
      const expected = reconnections.expected(token, roomId, url.searchParams.get('sessionId') ?? '');
      if (!expected) return new Response(null, { status: 403 });
      try {
        const identity = await readAccountSession(auth, context.headers);
        if (!identity || identity.userId !== expected.userId || identity.sessionId !== expected.sessionId ||
            reconnections.expected(token, roomId, url.searchParams.get('sessionId') ?? '') !== expected) return new Response(null, { status: 403 });
      } catch { return new Response(null, { status: 503 }); }
    },
  });
  const gameServer = new Server({
    transport,
    gracefullyShutdown: false,
    greet: false,
    devMode: false,
    auth: false,
    logger: frameworkLogger,
    express: app => {
      app.disable('x-powered-by');
      installAccountApi(app, { auth, env, origins, characters: characterService, assets: assetService, tickets, checkReady,
        sessionRevoked: sessionId => reconnections.revokeSession(sessionId) });
      app.get('/api/health', (_request, response) => response.json({ status: 'alive', serverVersion: SERVER_VERSION, mode: env.APP_MODE }));
      app.get('/api/version', (_request, response) => response.json({ protocolVersion: PROTOCOL_VERSION, serverVersion: SERVER_VERSION, mode: env.APP_MODE }));
      app.get('/api/ready', async (_request, response) => {
        try { await checkReady(); response.json({ status: 'ready', database: 'connected', protocolVersion: PROTOCOL_VERSION }); }
        catch { response.status(503).json({ status: 'not-ready', error: { code: 'DATABASE_UNAVAILABLE', message: 'Database unavailable or schema migration required.' } }); }
      });
      const clientDirectory = resolve(env.CLIENT_DIST);
      if (existsSync(resolve(clientDirectory, 'index.html'))) app.use(express.static(clientDirectory, { index: 'index.html', dotfiles: 'deny' }));
      app.use((_request, response) => response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }));
    },
  });
  gameServer.define(HANDSHAKE_ROOM, createHandshakeRoom(checkReady));
  gameServer.define(CHARACTER_ROOM, createCharacterRoom({ auth, database, characters: characterService, tickets, checkReady, origins, contentHash, world, reconnections }));
  // serverless() prepares the documented HTTP server without binding a port. Install
  // the local-only guard and uniform /socket prefix before this server starts listening.
  await gameServer.serverless();
  const handlers = httpServer.listeners('request') as RequestListener[];
  httpServer.removeAllListeners('request');
  let matchmakingWindow = Date.now(); let matchmakingRequests = 0;
  httpServer.on('request', (request, response) => {
    if (!localRequestAllowed(request, origins)) {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'LOCAL_PREVIEW_ONLY', message: 'This build only accepts local preview connections.' } }));
      return;
    }
    // Colyseus serverless() prereads Content-Length bodies before Express and
    // its prereader has no size limit in 0.18.16. Reject oversized declarations
    // before that handler can allocate. Chunked bodies reach bounded parsers.
    if (Number(request.headers['content-length'] ?? 0) > 8192) {
      response.writeHead(413, { 'content-type': 'application/json', connection: 'close' });
      response.end(JSON.stringify({ error: { code: 'INVALID_MESSAGE', message: 'The request body is too large.' } })); return;
    }
    if (request.url?.startsWith('/socket/')) request.url = request.url.slice('/socket'.length);
    let reconnectRoom: string | undefined;
    let requestUrl: URL;
    try {
      requestUrl = new URL(request.url ?? '/', 'http://localhost');
      // Decode parameter segments once, including the method, before dispatch can interpret them.
      const segments = requestUrl.pathname.split('/').map(segment => decodeURIComponent(segment));
      if (request.method === 'POST' && segments[1] === 'matchmake' && segments[2] === 'reconnect') reconnectRoom = segments.length === 4 ? segments[3] : '';
    } catch {
      response.writeHead(400, { 'content-type': 'application/json', connection: 'close' });
      response.end(JSON.stringify({ error: 'Invalid request path.' })); return;
    }
    if (request.url?.startsWith('/matchmake/') || reconnectRoom !== undefined) {
      if (Date.now() - matchmakingWindow >= 60_000) { matchmakingWindow = Date.now(); matchmakingRequests = 0; }
      if (++matchmakingRequests > 240) {
        response.writeHead(429, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'RATE_LIMITED', message: 'Too many connection requests.' })); return;
      }
    }
    // We do not trust caller-provided proxy identities. The development proxy is loopback.
    delete request.headers['x-forwarded-for'];
    delete request.headers['x-forwarded-host'];
    delete request.headers['x-forwarded-proto'];
    if (reconnectRoom !== undefined) {
      const roomId = reconnectRoom;
      void guardReconnectHttp(request, response, roomId, { auth, origins, reconnections, stopping: () => stopping }).then(allowed => {
        if (!allowed || response.destroyed) return;
        request.url = `/matchmake/reconnect/${roomId}${requestUrl.search}`;
        for (const handler of handlers) handler.call(httpServer, request, response);
      });
      return;
    }
    for (const handler of handlers) handler.call(httpServer, request, response);
  });
  let shutdownPromise: Promise<void> | undefined;
  return {
    database,
    auth,
    characterService,
    world,
    assetService,
    tickets,
    httpServer,
    async listen(port = env.PORT) {
      await new Promise<void>((yes, no) => { httpServer.once('error', no); httpServer.listen(port, env.HOST, () => { httpServer.off('error', no); yes(); }); });
      const actualPort = (httpServer.address() as { port: number }).port;
      for (const host of ['localhost', '127.0.0.1', '[::1]']) origins.add(`http://${host}:${actualPort}`);
      log('info', 'server_listening', { host: env.HOST, port: (httpServer.address() as { port: number }).port, mode: env.APP_MODE, protocolVersion: PROTOCOL_VERSION });
    },
    close() {
      if (!shutdownPromise) shutdownPromise = (async () => {
        stopping = true;
        tickets.clear();
        reconnections.clear();
        await world.close();
        log('info', 'server_stopping');
        try { await gameServer.gracefullyShutdown(false); }
        finally {
          try { await characterService.dispose(); }
          finally { await database.close(); }
        }
        log('info', 'server_stopped');
      })();
      return shutdownPromise;
    },
  };
}
