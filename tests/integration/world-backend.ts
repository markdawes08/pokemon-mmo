import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

/** Reuse the isolated source-backend executable; each start gets fresh auth counters. */
export class WorldTestBackend {
  origin = '';
  readonly pids: number[] = [];
  readonly lifecycleEvents: { at: string; event: string }[] = [];
  private child: ChildProcess | undefined;
  private exited: Promise<number | null> | undefined;

  async start() {
    assert(!this.child, 'Stop the previous owned test backend before restarting it.');
    const child = spawn(process.execPath, ['--import', 'tsx', 'tests/integration/world-browser-server.ts'], {
      cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, NODE_ENV: 'test', WORLD_TEST_PORT: this.origin ? new URL(this.origin).port : '0' },
    });
    this.child = child;
    const observe = (stream: NonNullable<ChildProcess['stdout']>) => {
      let pending = '';
      stream.on('data', (chunk: Buffer) => {
        pending += chunk.toString('utf8');
        const lines = pending.split(/\r?\n/); pending = lines.pop()!.slice(-8192);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as { event?: unknown };
            // Retain controlled lifecycle event names only, never URLs, cookies,
            // identifiers or arbitrary exception text from the backend stream.
            if (typeof parsed.event === 'string' && /^[a-z_]{1,64}$/.test(parsed.event)) this.lifecycleEvents.push({ at: new Date().toISOString(), event: parsed.event });
          } catch { /* Non-JSON framework output is deliberately omitted. */ }
        }
      });
    };
    observe(child.stdout!); observe(child.stderr!);
    assert(child.pid && child.pid !== process.pid); this.pids.push(child.pid);
    this.exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', () => resolve(null)); });
    this.origin = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => { detach(); reject(new Error('Owned world test backend did not become ready.')); }, 15_000);
      const failed = () => { detach(); reject(new Error('Owned world test backend exited before readiness.')); };
      const ready = (message: unknown) => {
        if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'world-browser-ready' || !('origin' in message) || typeof message.origin !== 'string') return;
        const url = new URL(message.origin);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) { failed(); return; }
        detach(); resolve(url.origin);
      };
      function detach() { clearTimeout(timeout); child.off('message', ready); child.off('error', failed); child.off('exit', failed); }
      child.on('message', ready); child.once('error', failed); child.once('exit', failed);
    });
  }

  async stop() {
    const child = this.child;
    if (!child) return;
    this.lifecycleEvents.push({ at: new Date().toISOString(), event: 'test_shutdown_requested' });
    if (child.connected) child.send({ type: 'shutdown' }, () => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reaped = false, forced = false;
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        void this.exited!.then(value => { reaped = true; resolve(value); });
        timer = setTimeout(() => {
          forced = true; this.lifecycleEvents.push({ at: new Date().toISOString(), event: 'test_forced_termination' }); child.kill();
          timer = setTimeout(() => reject(new Error(`Owned world backend PID ${child.pid} failed to exit after termination.`)), 2000);
        }, 10_000);
      });
      if (this.origin) await new Promise<void>((resolve, reject) => {
        const probe = createServer(); probe.once('error', reject);
        probe.listen(Number(new URL(this.origin).port), '127.0.0.1', () => probe.close(() => resolve()));
      });
      assert.equal(forced, false, 'World backend must stop gracefully'); assert.equal(code, 0);
    } finally { clearTimeout(timer); if (reaped) this.child = undefined; }
  }

  /** Kill only this helper's child to exercise process-loss recovery, never the shared preview. */
  async crash() {
    const child = this.child; assert(child?.pid && this.exited, 'No owned backend process to crash.');
    child.kill('SIGKILL');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.exited, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Owned backend was not reaped after process-loss test.')), 5000); })]);
      this.child = undefined;
    } finally { clearTimeout(timer); }
    await new Promise<void>((resolve, reject) => {
      const probe = createServer(); probe.once('error', reject);
      probe.listen(Number(new URL(this.origin).port), '127.0.0.1', () => probe.close(() => resolve()));
    });
  }
}
