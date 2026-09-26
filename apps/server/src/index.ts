import { existsSync } from 'node:fs';
import { parseServerEnv } from './env.js';
import { createGameServer } from './server.js';
import { log } from './logger.js';

if (existsSync('.env')) process.loadEnvFile('.env');
let server: Awaited<ReturnType<typeof createGameServer>> | undefined;
try {
  const env = parseServerEnv(process.env);
  server = await createGameServer(env);
  await server.listen();
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => { log('error', 'shutdown_timeout'); process.exit(1); }, 10000);
    timeout.unref();
    try { await server?.close(); clearTimeout(timeout); if (process.connected) process.disconnect(); process.exitCode = 0; }
    catch { log('error', 'shutdown_failed'); process.exitCode = 1; }
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.on('message', message => {
    if (message === 'shutdown' || (typeof message === 'object' && message !== null && 'type' in message && message.type === 'shutdown')) void shutdown();
  });
} catch (error) {
  log('error', 'server_start_failed', { message: error instanceof Error ? error.message : 'Unknown startup failure' });
  await server?.close();
  if (process.connected) process.disconnect();
  process.exitCode = 1;
}
