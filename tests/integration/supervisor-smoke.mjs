import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { Client } from '@colyseus/sdk';

// Fixed isolated ports intentionally fail before spawning if another process owns them.
const backendPort = 2568;
const clientPort = 5174;
const pause = ms => new Promise(yes => setTimeout(yes, ms));
async function canBind(port) {
  await new Promise((yes, no) => {
    const server = createServer();
    server.once('error', no);
    server.listen(port, '127.0.0.1', () => server.close(yes));
  });
}
await canBind(backendPort);
await canBind(clientPort);
let output = '';
let exit;
let spawnError;
let room;
const execute = promisify(execFile);
async function processList() {
  if (process.platform !== 'win32') return [];
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress'], { windowsHide: true });
  return JSON.parse(stdout);
}
const child = spawn(process.execPath, ['scripts/run.mjs', 'dev'], {
  cwd: process.cwd(),
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(backendPort), CLIENT_PORT: String(clientPort), APP_ORIGIN: `http://127.0.0.1:${clientPort}` },
});
child.stdout.on('data', data => { output += data; });
child.stderr.on('data', data => { output += data; });
child.on('error', error => { spawnError = error; });
child.on('exit', (code, signal) => { exit = { code, signal }; });
async function waitFor(check, label, milliseconds = 20000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (await check()) return;
    await pause(100);
  }
  throw new Error(`Timed out: ${label}`);
}
async function ready(port) {
  try { return (await fetch(`http://127.0.0.1:${port}/api/ready`, { signal: globalThis.AbortSignal.timeout(1000) })).status === 200; }
  catch { return false; }
}
try {
  await waitFor(async () => {
    if (exit) throw new Error(`Supervisor exited early: ${JSON.stringify(exit)}`);
    return await ready(backendPort) && await ready(clientPort);
  }, 'backend and Vite proxy readiness');
  room = await new Client(`http://127.0.0.1:${clientPort}/socket`).joinOrCreate('handshake', { protocolVersion: 1 });
  room.reconnection.enabled = false;
  const allProcesses = await processList();
  const ownedIds = new Set([child.pid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const process of allProcesses) {
      if (ownedIds.has(process.ParentProcessId) && !ownedIds.has(process.ProcessId)) { ownedIds.add(process.ProcessId); changed = true; }
    }
  }
  const ownedProcesses = allProcesses.filter(process => ownedIds.has(process.ProcessId));
  const welcomed = new Promise((yes, no) => {
    const timeout = setTimeout(() => no(new Error('No welcome through Vite websocket proxy')), 3000);
    room.onMessage('welcome', message => { clearTimeout(timeout); yes(message); });
  });
  room.send('hello', { protocolVersion: 1 });
  assert.equal((await welcomed).mode, 'local-preview');
  const left = new Promise((yes, no) => {
    const timeout = setTimeout(() => no(new Error('Active client did not disconnect during supervised shutdown')), 8000);
    room.onLeave(code => { clearTimeout(timeout); yes(code); });
  });
  await new Promise((yes, no) => child.send({ type: 'shutdown' }, error => error ? no(error) : yes()));
  // The Vite process can close its proxy before the backend frame arrives; either
  // closure is valid here. The direct network smoke separately asserts code 4001.
  await left;
  room = undefined;
  await waitFor(() => exit !== undefined, 'supervisor exit', 10000);
  assert.equal(exit.code, 0, `Supervisor failure: ${JSON.stringify(exit)}`);
  await canBind(backendPort);
  await canBind(clientPort);
  const remaining = await processList();
  for (const process of ownedProcesses) {
    assert(!remaining.some(candidate => candidate.ProcessId === process.ProcessId && candidate.CreationDate === process.CreationDate), `Owned process ${process.ProcessId} survived supervisor shutdown`);
  }
  assert(output.includes('"event":"server_stopped"'), 'Backend must complete its graceful shutdown handler');
  assert(output.includes('Client and backend stopped.'), 'Supervisor must finish child cleanup');
  await mkdir('reports', { recursive: true });
  await writeFile('reports/supervisor-verification.json', JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed', ports: [backendPort, clientPort], checks: ['backend-ready', 'Vite-proxy-ready', 'WebSocket-handshake-through-Vite', 'active-client-disconnect', 'IPC-shutdown', 'supervisor-zero-exit', 'backend-graceful-stop-log', 'both-listeners-released', ...(process.platform === 'win32' ? ['no-owned-descendant-processes-remain'] : [])], ownedProcessCount: ownedProcesses.length, retainedService: 'PostgreSQL on 127.0.0.1:5433 is intentionally independent' }, null, 2) + '\n');
  console.log('Supervisor smoke passed: Vite proxy handshake and coordinated shutdown released both listeners.');
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (room) await room.leave().catch(() => {});
  if (!exit && child.connected) child.send({ type: 'shutdown' }, () => {});
  if (!exit) {
    await waitFor(() => exit !== undefined, 'cleanup', 10000).catch(() => {
      // Only kill this test's known process tree on failure, never another listener.
      if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill('SIGTERM');
    });
  }
}
