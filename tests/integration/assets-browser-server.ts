import { createGameServer } from '../../apps/server/src/server.js';
import { parseServerEnv } from '../../apps/server/src/env.js';
import { accountTestDatabaseUrl } from './account-fixtures.js';

// A distinct process isolates Better Auth's documented in-memory rate counters
// from the account suite without weakening any production authentication limit.
const databaseUrl = accountTestDatabaseUrl();
let server: Awaited<ReturnType<typeof createGameServer>> | undefined;
let closing: Promise<void> | undefined;
function shutdown() {
  closing ??= (async () => {
    const timeout = setTimeout(() => process.exit(1), 10_000); timeout.unref();
    try { await startup.catch(() => undefined); await server?.close(); process.exitCode = 0; }
    catch { process.exitCode = 1; }
    finally { clearTimeout(timeout); if (process.connected) process.disconnect(); }
  })();
  return closing;
}
const startup = (async () => {
  server = await createGameServer(parseServerEnv({ ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test', CLIENT_DIST: 'apps/client/dist' }));
  await server.listen(0);
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Asset browser backend did not bind a loopback port.');
  if (!process.send || !process.connected) throw new Error('Asset browser backend requires its owning test IPC channel.');
  process.send({ type: 'assets-browser-ready', origin: `http://127.0.0.1:${address.port}` });
})();
process.on('message', message => {
  if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'shutdown') void shutdown();
});
process.on('disconnect', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
try { await startup; }
catch {
  await shutdown();
  process.exitCode = 1;
}
