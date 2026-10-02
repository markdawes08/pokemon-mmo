import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, cp, rm, realpath, lstat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { battleChecks } from './battle-checks.mjs';

const root = process.cwd();
const node = process.execPath;
const python = resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
const children = new Set();
let stopping = false;
if (existsSync('.env')) process.loadEnvFile('.env');

function run(command, args, options = {}) {
  return new Promise((yes, no) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
    children.add(child);
    child.once('error', error => { children.delete(child); no(error); });
    child.once('exit', (code, signal) => {
      children.delete(child);
      if (code === 0 || stopping) yes();
      else no(new Error(`${command} ${args.join(' ')} failed (${code ?? signal})`));
    });
  });
}
const js = (...args) => run(node, args);
const tool = (path, ...args) => js(resolve(root, 'node_modules', path), ...args);
const db = action => js('scripts/db.mjs', action);
const converter = (...args) => run(python, ['tools/content-import/import_content.py', ...args]);

async function setup() {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node 24 for setup.');
  if (!existsSync(python)) await run(process.platform === 'win32' ? 'py' : 'python3', [...(process.platform === 'win32' ? ['-3'] : []), '-m', 'venv', '.venv']);
  await run(python, ['-m', 'pip', 'install', '-r', 'tools/content-import/requirements.txt']);
  if (!existsSync('.env')) {
    await db('setup');
    const local = JSON.parse(await readFile('.local/database.json', 'utf8'));
    const source = JSON.parse(await readFile('source-lock.json', 'utf8')).reference.localPath;
    const env = [
      `DATABASE_URL=${local.databaseUrl}`, `TEST_DATABASE_URL=${local.testDatabaseUrl}`,
      `BETTER_AUTH_SECRET=${randomBytes(32).toString('hex')}`,
      'BETTER_AUTH_URL=http://localhost:5173', 'APP_ORIGIN=http://localhost:5173',
      'HOST=127.0.0.1', 'PORT=2567', 'CLIENT_PORT=5173', 'CONTENT_PROFILE=firered-private',
      `REFERENCE_SOURCE_DIR=${source.replaceAll('\\', '/')}`, 'CONTENT_DIR=content/generated', 'LOG_LEVEL=info',
    ];
    await writeFile('.env', env.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
    process.loadEnvFile('.env');
    console.log('Created local configuration (secret values omitted).');
  } else console.log('Preserved existing .env.');
  if (existsSync('.local/database.json')) await db('start');
  await db('migrate');
  await tool('@playwright/test/cli.js', 'install', 'chromium');
  console.log('Setup passed. Next: npm.cmd run content:build -- --profile firered-private');
}

async function portState(port) {
  return new Promise(resolveState => {
    const server = createServer();
    server.once('error', () => resolveState('in use'));
    server.listen(port, '127.0.0.1', () => server.close(() => resolveState('available')));
  });
}
async function doctor() {
  const { default: pg } = await import('pg');
  console.log(`Node ${process.version}; platform ${process.platform}/${process.arch}`);
  await run(python, ['--version']);
  if (!existsSync('.env')) throw new Error('Missing .env; run setup.');
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Expected Node 24.');
  await run(python, ['scripts/source-baseline.py', 'verify', '--source', process.env.REFERENCE_SOURCE_DIR, '--report', 'reports/source-verification.json']);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    const result = await client.query('SHOW server_version');
    console.log(`PostgreSQL ${result.rows[0].server_version}: reachable`);
    await client.query("SELECT protocol_version FROM runtime_metadata WHERE key='foundation'");
    console.log('Database baseline migration: present');
  } finally { await client.end(); }
  for (const port of [Number(process.env.PORT ?? 2567), Number(process.env.CLIENT_PORT ?? 5173)]) console.log(`Loopback port ${port}: ${await portState(port)}`);
  if (existsSync('content/generated/manifests/content-manifest.json')) await converter('check');
  else console.log('Generated content: not yet built (P02 partial).');
}

async function build(prepared = false) {
  if (!prepared) {
    await run(python, ['tools/content-import/practice_sprites.py', 'build']);
    await tool('typescript/bin/tsc', '--noEmit');
  }
  await syncContent();
  const { build: bundle } = await import('esbuild');
  await bundle({ entryPoints: ['apps/server/src/index.ts'], outfile: 'apps/server/dist/index.js', bundle: true, platform: 'node', target: 'node24', format: 'esm', sourcemap: true, external: ['@colyseus/*', 'express', 'pg', 'drizzle-orm', 'drizzle-orm/*', 'better-auth', 'better-auth/*', 'zod'] });
  await tool('vite/bin/vite.js', 'build', '--config', 'apps/client/vite.config.ts');
}

async function syncContent() {
  if (existsSync('content/generated/client')) {
    await mkdir('.local/client-public', { recursive: true });
    const parent = await realpath('.local/client-public');
    const expectedParent = resolve(await realpath(root), '.local/client-public');
    if (parent.toLowerCase() !== expectedParent.toLowerCase()) throw new Error('Public staging directory resolves outside the expected project path.');
    const target = resolve(parent, 'content');
    if (existsSync(target)) {
      if ((await lstat(target)).isSymbolicLink() || (await realpath(target)).toLowerCase() !== target.toLowerCase()) throw new Error('Refusing to replace redirected public staging content.');
      await rm(target, { recursive: true });
    }
    await cp('content/generated/client', target, { recursive: true });
  }
}

async function stopChildren() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.connected) child.send({ type: 'shutdown' }, () => {});
    else child.kill('SIGINT');
  }
  const deadline = Date.now() + 5000;
  while (children.size && Date.now() < deadline) await new Promise(done => setTimeout(done, 50));
  for (const child of children) child.kill('SIGTERM');
  console.log('Client and backend stopped. Local PostgreSQL retains its data; stop with npm.cmd run db:stop.');
}
process.on('SIGINT', () => void stopChildren());
process.on('SIGTERM', () => void stopChildren());
process.on('message', message => { if (message?.type === 'shutdown') void stopChildren(); });

async function serve(built = false) {
  if (!existsSync('.env')) throw new Error('Run setup before starting the game.');
  if (existsSync('.local/database.json')) await db('start');
  if (!built) await syncContent();
  const backendArgs = built ? ['apps/server/dist/index.js'] : ['--import', 'tsx', 'apps/server/src/index.ts'];
  const backend = run(node, backendArgs, { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
  const tasks = [backend];
  if (!built) tasks.push(tool('vite/bin/vite.js', '--config', 'apps/client/vite.config.ts'));
  try { await Promise.race(tasks); }
  finally { await stopChildren(); await Promise.allSettled(tasks); }
}

async function command(name, args) {
  if (name === 'db:seed:dev') return js('--import', 'tsx', 'apps/server/src/seed-dev.ts', ...args);
  if (name.startsWith('db:')) return db(name.slice(3));
  const battle = battleChecks.find(row => row.stage === name);
  if (battle) {
    await run(python, [`tools/${battle.directory}/build.py`]);
    for (const check of battle.checks) await js('--import', 'tsx', `tools/${battle.directory}/${check}.ts`);
    return;
  }
  switch (name) {
    case 'setup': return setup();
    case 'doctor': return doctor();
    case 'dev': return serve();
    case 'start': return serve(true);
    case 'build': return build();
    case 'build:bundle': return build(true);
    case 'typecheck': return tool('typescript/bin/tsc', '--noEmit');
    case 'lint': return tool('eslint/bin/eslint.js', 'apps', 'packages', 'scripts', ...battleChecks.map(row => `tools/${row.directory}`), 'tools/fixtures', '*.config.ts', '*.config.mjs');
    case 'test:unit':
      await command('test:ts', []); return command('test:content', []);
    case 'test:ts': return tool('vitest/vitest.mjs', 'run', ...args);
    case 'test:content': return run(python, ['-m', 'unittest', 'discover', '-s', 'tools/content-import', '-p', 'test_*.py', '-v']);
    case 'test:workflow': return js('--test', 'scripts/verification/runner.test.mjs', 'scripts/verification/catalog.test.mjs');
    case 'fixtures:check':
      await js('--import', 'tsx', 'tools/fixtures/check.ts');
      return run(python, ['tools/fixtures/check.py']);
    case 'sprites:check':
      await run(python, ['tools/content-import/practice_sprites.py', 'build']);
      return run(python, ['tools/content-import/practice_sprites.py', 'check']);
    case 'test:integration':
      await db('test');
      await js('--import', 'tsx', 'apps/server/src/network-smoke.ts');
      await js('--import', 'tsx', 'apps/server/src/accounts-store-smoke.ts');
      await js('--import', 'tsx', 'apps/server/src/accounts-smoke.ts');
      await js('--import', 'tsx', 'tests/integration/assets-smoke.ts');
      await js('--import', 'tsx', 'tests/integration/world-store-smoke.ts');
      await js('--import', 'tsx', 'tests/integration/world-smoke.ts');
      await js('--import', 'tsx', 'tests/integration/reconnect-smoke.ts');
      await js('--import', 'tsx', 'tests/integration/local-testing-smoke.ts');
      return js('tests/integration/supervisor-smoke.mjs');
    case 'testing:check': return js('--import', 'tsx', 'tests/integration/local-testing-smoke.ts');
    case 'wild:check':
      await js('--import', 'tsx', 'tests/integration/wild-engine-smoke.ts');
      return js('--import', 'tsx', 'tests/integration/wild-test-smoke.ts');
    case 'test:e2e': return tool('@playwright/test/cli.js', 'test', ...args);
    case 'test:recovery': return js('--import', 'tsx', 'tests/integration/accounts-restart-smoke.ts');
    case 'test:boundaries': return js('scripts/check-private-client.mjs');
    case 'battle:setup': return run(python, ['scripts/bootstrap-battle-toolchain.py']);
    case 'practice:check':
      await command('sprites:check', []); return command('practice:integration', args);
    case 'practice:integration':
      await js('--import', 'tsx', 'tests/integration/practice-engine-smoke.ts');
      await js('--import', 'tsx', 'tests/integration/practice-smoke.ts');
      return js('--import', 'tsx', 'tests/integration/practice-network-smoke.ts');
    case 'source:inventory': return run(python, ['scripts/source-inventory.py']);
    case 'content:build':
      await run(python, ['scripts/source-baseline.py', 'verify', '--source', process.env.REFERENCE_SOURCE_DIR]);
      await converter('build', ...args);
      return syncContent();
    case 'content:check': return converter('check', ...args);
    case 'verify': case 'verify:focus': case 'verify:stage':
      return js('scripts/verification/cli.mjs', name, ...args);
    default: throw new Error(`Unknown task: ${name}`);
  }
}
try { await command(process.argv[2] ?? '', process.argv.slice(3)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (process.connected) process.disconnect(); }
