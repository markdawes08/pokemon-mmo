import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = resolve(root, '.local');
const data = resolve(local, 'postgres');
const bin = resolve(root, '.tools/postgres/pgsql/bin');
const configPath = resolve(local, 'database.json');
const archiveName = 'postgresql-17.11-4-windows-x64-binaries.zip';
const url = `https://get.enterprisedb.com/postgresql/${archiveName}`;
const sha256 = 'b9424ee7bc60b52450ff910a3630225df32e633f3cb29c1d126d9299d59aea28';
const run = (command, args, options = {}) => new Promise((yes, no) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  child.once('error', no);
  child.once('exit', code => code === 0 ? yes() : no(new Error(`${command} exited ${code}`)));
});
async function config() {
  if (!existsSync(configPath)) throw new Error('Local database is not configured. Run npm run db:setup first.');
  const settings = JSON.parse(await readFile(configPath, 'utf8'));
  if (settings.host !== '127.0.0.1') throw new Error('Local PostgreSQL host must remain 127.0.0.1.');
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) throw new Error('Stored local PostgreSQL port must be an integer from 1 to 65535.');
  return settings;
}
async function setup() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Portable setup supports Windows x64. On other platforms use compose.yaml and explicit DATABASE_URL/TEST_DATABASE_URL.');
  }
  // First setup chooses a port; subsequent setup preserves the existing cluster's settings.
  let initialPort;
  if (!existsSync(configPath)) {
    const requestedPort = process.env.LOCAL_DB_PORT ?? '5433';
    initialPort = Number(requestedPort);
    if (!/^\d+$/.test(requestedPort) || !Number.isInteger(initialPort) || initialPort < 1 || initialPort > 65535) {
      throw new Error('LOCAL_DB_PORT must be an integer from 1 to 65535.');
    }
  }
  await mkdir(local, { recursive: true });
  if (!existsSync(resolve(bin, 'pg_ctl.exe'))) {
    const archive = resolve(root, '.tools/downloads', archiveName);
    await mkdir(dirname(archive), { recursive: true });
    if (!existsSync(archive)) {
      console.log(JSON.stringify({ event: 'postgres_download', version: '17.11-4', url }));
      const response = await fetch(url);
      if (!response.ok) throw new Error(`PostgreSQL download failed: ${response.status}`);
      await writeFile(archive, new Uint8Array(await response.arrayBuffer()));
    }
    const actual = createHash('sha256').update(await readFile(archive)).digest('hex');
    if (actual !== sha256) throw new Error('PostgreSQL archive SHA-256 mismatch. Refusing extraction.');
    // Only the database tools, runtime libraries, shared data and their licenses are needed.
    const script = 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); members=[n for n in z.namelist() if n.startswith(("pgsql/bin/","pgsql/lib/","pgsql/share/")) or n in ("pgsql/server_license.txt","pgsql/commandlinetools_3rd_party_licenses.txt")]; z.extractall(sys.argv[2],members)';
    await run('py', ['-3', '-c', script, archive, resolve(root, '.tools/postgres')]);
  }
  if (!existsSync(configPath)) {
    if (existsSync(resolve(data, 'PG_VERSION'))) throw new Error('Existing cluster without its credential record; restore .local/database.json before continuing.');
    const password = randomBytes(24).toString('hex');
    await writeFile(configPath, JSON.stringify({
      host: '127.0.0.1', port: initialPort, user: 'pokewaterblue', password,
      databaseUrl: `postgresql://pokewaterblue:${password}@127.0.0.1:${initialPort}/pokewaterblue`,
      testDatabaseUrl: `postgresql://pokewaterblue:${password}@127.0.0.1:${initialPort}/pokewaterblue_test`,
    }, null, 2) + '\n', { mode: 0o600 });
  }
  if (!existsSync(resolve(data, 'PG_VERSION'))) {
    const settings = await config();
    const passwordFile = resolve(local, 'postgres-init-password.tmp');
    await writeFile(passwordFile, settings.password, { mode: 0o600 });
    try {
      await run(resolve(bin, 'initdb.exe'), ['-D', data, '-U', settings.user, '--pwfile', passwordFile, '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale=C']);
    } finally { await rm(passwordFile, { force: true }); }
  }
  await writeFile(resolve(local, 'postgres-binary.json'), JSON.stringify({ version: '17.11-4', url, sha256, provenance: 'SHA-256 measured from EDB HTTPS download on 2026-09-25; pinned for subsequent installs.' }, null, 2) + '\n');
  const settings = await config();
  console.log(JSON.stringify({ event: 'postgres_setup_complete', host: settings.host, port: settings.port }));
}
async function start() {
  const settings = await config();
  const { default: pg } = await import('pg');
  const admin = new pg.Client({ host: settings.host, port: settings.port, user: settings.user, password: settings.password, database: 'postgres', connectionTimeoutMillis: 2000 });
  const status = await new Promise((yes, no) => {
    const child = spawn(resolve(bin, 'pg_ctl.exe'), ['status', '-D', data], { cwd: root, stdio: 'ignore', windowsHide: true });
    child.once('error', no); child.once('exit', yes);
  });
  if (status !== 0) await run(resolve(bin, 'pg_ctl.exe'), ['start', '-D', data, '-l', resolve(local, 'postgres.log'), '-o', `-h ${settings.host} -p ${settings.port}`, '-w']);
  await admin.connect();
  try {
    for (const name of ['pokewaterblue', 'pokewaterblue_test']) {
      const result = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
      if (!result.rowCount) await admin.query(`CREATE DATABASE "${name}"`);
    }
  } finally { await admin.end(); }
  console.log(JSON.stringify({ event: 'postgres_ready', host: settings.host, port: settings.port }));
}
async function stop() {
  if (!existsSync(resolve(data, 'postmaster.pid'))) { console.log('Local PostgreSQL is already stopped.'); return; }
  await run(resolve(bin, 'pg_ctl.exe'), ['stop', '-D', data, '-m', 'fast', '-w']);
}
async function main() {
  const command = process.argv[2];
  if (command === 'setup') await setup();
  else if (command === 'start') await start();
  else if (command === 'stop') await stop();
  else if (command === 'migrate' || command === 'test') {
    if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
    await run(process.execPath, ['--import', 'tsx', 'packages/database/src/cli.ts', command], { env: process.env });
  } else throw new Error('Usage: node scripts/db.mjs setup|start|stop|migrate|test');
}
main().catch(error => { console.error(JSON.stringify({ event: 'database_command_failed', message: error.message })); process.exitCode = 1; });
