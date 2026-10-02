/** Storage-only checks: no C builds, database, application runtime or oracle calls. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { decodeFixture, fixtureEntries, readFixtureBytes, readFixtureText, readRetainedBytes } from './io';

const entries = await fixtureEntries();
for (const entry of entries) {
  await assert.rejects(readFile(entry.path), (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
    'Registered fixtures must have one archive, without a stale plain JSON copy');
  const bytes = await readFixtureBytes(entry.path);
  assert.deepEqual(await readRetainedBytes(entry.path), bytes);
  assert.equal(await readFixtureText(entry.path), bytes.toString('utf8'));
  const fixture = JSON.parse(bytes.toString('utf8')) as Record<string, { id: string }[]>;
  const source = JSON.parse(bytes.toString('utf8')) as { sourceRecords: { path: string }[] };
  assert.deepEqual(entry.sourcePaths, [...new Set(source.sourceRecords.map(row => row.path))].sort());
  const cases = entry.caseCollections.flatMap(name => fixture[name]!);
  assert.equal(cases.length, entry.cases, entry.path);
  assert.equal(new Set(cases.map(row => row.id)).size, cases.length, entry.path);
  assert.equal(bytes.toString('utf8').replaceAll('\r\n', '').includes('\n'), false, 'Canonical CRLF retained');
}
const first = entries[0]!, archive = await readFile(first.archive);
assert.throws(() => decodeFixture(archive.subarray(1), first), /archive differs/);
const corrupt = Buffer.from(archive); corrupt[corrupt.length - 1]! ^= 1;
assert.throws(() => decodeFixture(corrupt, first), /archive differs/);
assert.throws(() => decodeFixture(archive, { ...first, canonicalSha256: '0'.repeat(64) }), /Canonical fixture differs/);
assert.throws(() => decodeFixture(archive, { ...first, canonicalBytes: first.canonicalBytes - 1 }));
await assert.rejects(() => readFixtureBytes('tools/battle-unknown/fixtures/source-cases.json'), /Unregistered fixture/);
await assert.rejects(() => readRetainedBytes('tools/fixtures/manifest.json'), /Unregistered fixture/);
const result = { status: 'passed', scope: 'Canonical fixture storage only; no mechanics verification',
  archives: entries.length, cases: entries.reduce((sum, row) => sum + row.cases, 0),
  canonicalBytes: entries.reduce((sum, row) => sum + row.canonicalBytes, 0),
  archiveBytes: entries.reduce((sum, row) => sum + row.archiveBytes, 0), rejectionChecks: 6,
  fixtures: entries.map(({ path, canonicalSha256 }) => ({ path, canonicalSha256 })) };
await writeFile('reports/fixture-storage-node.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
