/** Test-only canonical fixture IO. Runtime engines must not import this module. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

export interface FixtureEntry {
  path: string;
  archive: string;
  canonicalBytes: number;
  canonicalSha256: string;
  archiveBytes: number;
  archiveSha256: string;
  caseCollections: string[];
  cases: number;
  sourcePaths: string[];
}
const root = fileURLToPath(new URL('../../', import.meta.url));
export async function fixtureEntries(): Promise<FixtureEntry[]> {
  const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8')) as {
    schemaVersion: number; fixtures: FixtureEntry[];
  };
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.fixtures)) throw new Error('Unsupported fixture manifest.');
  for (const row of manifest.fixtures) {
    if (!/^tools\/(battle-[a-z0-9-]+|encounter-core)\/fixtures\/(source|items)-cases\.json$/.test(row.path)
      || row.archive !== `${row.path}.gz` || !Number.isSafeInteger(row.canonicalBytes)
      || row.canonicalBytes < 1 || row.canonicalBytes > 64 * 1024 * 1024
      || !Number.isSafeInteger(row.archiveBytes) || row.archiveBytes < 1 || row.archiveBytes > row.canonicalBytes
      || !/^[a-f0-9]{64}$/.test(row.canonicalSha256) || !/^[a-f0-9]{64}$/.test(row.archiveSha256)
      || !Array.isArray(row.caseCollections) || row.caseCollections.length < 1
      || row.caseCollections.some(name => !['cases', 'factoryCases', 'stepCases'].includes(name))
      || !Array.isArray(row.sourcePaths) || row.sourcePaths.length < 1
      || row.sourcePaths.some(path => typeof path !== 'string' || path.includes('\\') || path.includes(':')
        || path.split('/').some(part => !part || part === '.' || part === '..'))
      || !Number.isSafeInteger(row.cases) || row.cases < 1) throw new Error('Invalid fixture manifest entry.');
  }
  if (new Set(manifest.fixtures.map(row => row.path)).size !== manifest.fixtures.length) throw new Error('Duplicate fixture manifest entry.');
  return manifest.fixtures;
}
function sha(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
export function decodeFixture(archive: Uint8Array, entry: FixtureEntry): Buffer {
  if (archive.byteLength !== entry.archiveBytes || sha(archive) !== entry.archiveSha256)
    throw new Error(`Fixture archive differs from its pin: ${entry.path}`);
  const bytes = gunzipSync(archive, { maxOutputLength: entry.canonicalBytes });
  if (bytes.byteLength !== entry.canonicalBytes || sha(bytes) !== entry.canonicalSha256)
    throw new Error(`Canonical fixture differs from its pin: ${entry.path}`);
  return bytes;
}
export async function readFixtureBytes(path: string): Promise<Buffer> {
  const logical = relative(root, resolve(path)).split(sep).join('/');
  const entry = (await fixtureEntries()).find(row => row.path === logical);
  if (!entry) throw new Error(`Unregistered fixture: ${path}`);
  return decodeFixture(await readFile(resolve(root, entry.archive)), entry);
}
export async function readFixtureText(path: string): Promise<string> {
  return (await readFixtureBytes(path)).toString('utf8');
}
/** Retained verification maps contain canonical fixtures and unchanged WASM files. */
export async function readRetainedBytes(path: string): Promise<Buffer> {
  return path.endsWith('.wasm') ? readFile(path) : readFixtureBytes(path);
}
