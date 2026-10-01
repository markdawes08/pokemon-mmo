import type { IncomingMessage, ServerResponse } from 'node:http';
import { fromNodeHeaders } from 'better-auth/node';
import { readAccountSession, type GameAuth } from './auth.js';
import { ReconnectionBindings } from './reconnection-bindings.js';

class InvalidReconnectRequest extends Error {
  constructor(readonly status: number) { super('Invalid transport reconnect request.'); }
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let length = 0;
    const cleanup = () => {
      clearTimeout(timer);
      request.off('data', data); request.off('end', end); request.off('aborted', aborted); request.off('error', aborted);
    };
    const fail = (status: number) => {
      cleanup();
      // An aborted IncomingMessage can emit ECONNRESET after its aborted event.
      request.once('error', () => {});
      request.pause(); reject(new InvalidReconnectRequest(status));
    };
    const data = (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > 8192) { fail(413); return; }
      chunks.push(bytes);
    };
    const end = () => {
      cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown); }
      catch { reject(new InvalidReconnectRequest(400)); }
    };
    const aborted = () => fail(400);
    const timer = setTimeout(() => fail(408), 10_000); timer.unref();
    request.on('data', data); request.once('end', end); request.once('aborted', aborted); request.once('error', aborted);
  });
}

/** Runs before Colyseus can consume a token or close its existing live transport. */
export async function guardReconnectHttp(request: IncomingMessage, response: ServerResponse, roomId: string, dependencies: {
  auth: GameAuth; origins: Set<string>; reconnections: ReconnectionBindings; stopping: () => boolean;
}): Promise<boolean> {
  const reject = (status: number) => {
    if (!response.destroyed && !response.writableEnded) {
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close' });
      if (!request.complete) {
        request.once('error', () => {});
        response.once('finish', () => request.destroy());
      }
      response.end(JSON.stringify({ error: status === 403 ? 'Reconnect authentication required.' : 'Invalid or unavailable reconnect request.' }));
    }
    return false;
  };
  try {
    if (dependencies.stopping()) return reject(503);
    if (!dependencies.origins.has(request.headers.origin ?? '') || !/^[a-zA-Z0-9_-]{1,128}$/.test(roomId)) return reject(403);
    if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') return reject(400);
    const body = await readBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('reconnectionToken' in body) ||
        typeof body.reconnectionToken !== 'string' || body.reconnectionToken.length < 1 || body.reconnectionToken.length > 256) return reject(400);
    const expected = dependencies.reconnections.expectedForMatchmaking(body.reconnectionToken, roomId);
    if (!expected) return reject(403);
    const identity = await readAccountSession(dependencies.auth, fromNodeHeaders(request.headers));
    if (!identity || identity.userId !== expected.userId || identity.sessionId !== expected.sessionId || dependencies.stopping() ||
        dependencies.reconnections.expectedForMatchmaking(body.reconnectionToken, roomId) !== expected) return reject(403);
    // The installed serverless prereader/getRequest explicitly preserve a prepopulated parsed body.
    (request as IncomingMessage & { body: unknown }).body = body;
    return true;
  } catch (error) { return reject(error instanceof InvalidReconnectRequest ? error.status : 503); }
}
