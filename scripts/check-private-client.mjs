/** Focused public-output and development @fs boundary gate. Never uses accounts. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { createServer } from 'vite';

const root = process.cwd();
const dist = resolve(root, 'apps/client/dist');
const privateMarkers = ['privateEngineState', 'sRoute1_FireRed', 'encounterRateBuff', 'encounter_checkpoint', 'firered-route1-singles-v1', 'firered-route1-singles-v2',
  'firered-route1-progression-v1', 'firered-route1-loss-v1', 'firered-route1-capture-v1', 'firered-route1-evolution-v1', 'firered-family-singles-v1', 'firered-family-party-v1', 'firered-family-tactics-v1', 'firered-family-charge-v1', 'character_leases', 'command_receipts', 'password_hash', 'BETTER_AUTH_SECRET', 'DATABASE_URL'];
const files = [], sha256 = {};
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    assert(!entry.isSymbolicLink(), 'Public artifact must not be a symlink');
    if (entry.isDirectory()) { await inspect(path); continue; }
    assert(entry.isFile());
    const name = relative(dist, path).replaceAll('\\', '/');
    assert(!/(?:^|\/)(?:server|database|encounter-core|battle-spike|battle-route1|battle-progression|battle-loss|battle-capture|battle-evolution|battle-family|battle-party|battle-tactics|battle-charge)(?:\/|$)|\.wasm$/i.test(name), `Private public artifact: ${name}`);
    const bytes = await readFile(path);
    if (['.js', '.json', '.html', '.css', '.map'].includes(extname(path))) {
      const contents = bytes.toString('utf8');
      for (const marker of privateMarkers) assert(!contents.includes(marker), `Private marker ${marker} in ${name}`);
    }
    files.push(name);
    sha256[name] = createHash('sha256').update(bytes).digest('hex');
  }
}
await inspect(dist);
assert(files.includes('content/field-guide.json'));
const checks = ['public-field-guide-present', 'no-private-output-paths', 'no-WASM-or-probe-artifacts',
  'no-selected-private-auth-asset-world-encounter-identifiers'];
await writeFile('reports/client-bundle-check.json', JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed',
  scope: 'Limited public inventory and selected private identifiers; not a comprehensive security audit',
  fileCount: files.length, files: files.sort(), sha256, checks }, null, 2) + '\n');

// Use the installed Vite API and real project config on an isolated ephemeral
// loopback port. Testing status only avoids copying private bodies into reports.
const server = await createServer({ configFile: resolve(root, 'apps/client/vite.config.ts'),
  logLevel: 'silent', server: { port: 0, open: false, watch: null } });
const requests = [];
try {
  await server.listen();
  const address = server.httpServer?.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  for (const path of ['content/generated/server/gameplay.json', 'tools/encounter-core/encounter.ts',
    '.local/encounter-core/primary/encounter.wasm', 'tools/battle-spike/engine.ts',
    '.local/battle-spike/primary/probe.wasm', 'tools/battle-route1/engine.ts',
    '.local/battle-route1/primary/route1.wasm', 'apps/server/src/development-profile.ts',
    'tools/battle-progression/progression.ts', '.local/battle-progression/primary/progression.wasm',
    'tools/battle-loss/loss.ts', '.local/battle-loss/primary/loss.wasm',
    'tools/battle-capture/capture.ts', '.local/battle-capture/primary/capture.wasm',
    'tools/battle-evolution/evolution.ts', '.local/battle-evolution/primary/evolution.wasm',
    'tools/battle-family/engine.ts', '.local/battle-family/primary/family.wasm',
    'tools/battle-party/engine.ts', '.local/battle-party/primary/party.wasm',
    'tools/battle-tactics/engine.ts', '.local/battle-tactics/primary/tactics.wasm',
    'tools/battle-charge/engine.ts', '.local/battle-charge/primary/charge.wasm',
    'packages/content-schema/src/gameplay-server.ts', 'reports/encounter-dependencies.json', '.local/database.json']) {
    const absolute = resolve(root, path).replaceAll('\\', '/');
    assert((await stat(absolute)).isFile(), `Boundary test requires a real file: ${path}`);
    for (const suffix of ['', '?raw', '?url']) {
      const method = path === '.local/database.json' ? 'HEAD' : 'GET';
      const response = await fetch(`${base}/@fs/${absolute}${suffix}`, { method, signal: globalThis.AbortSignal.timeout(5000) });
      assert.equal(response.status, 403, `Private @fs access must fail: ${path}${suffix}`);
      await response.body?.cancel();
      requests.push({ path, suffix, method, status: response.status });
    }
  }
  for (const path of ['/', '/src/main.ts', '/content/world.json', '/content/field-guide.json']) {
    const response = await fetch(`${base}${path}`, { signal: globalThis.AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, `Public asset unavailable: ${path}`);
    await response.body?.cancel();
    requests.push({ path, status: response.status });
  }
} finally { await server.close(); }
await writeFile('reports/private-client-boundary.json', JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed',
  scope: 'Selected real private files denied by Vite for direct, raw and URL requests; public app assets retained. No account login or mutation.',
  requests }, null, 2) + '\n');
console.log(`Client boundary gate passed: ${files.length} built files, ${requests.length} development HTTP checks.`);
