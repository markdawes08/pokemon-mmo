import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createDatabase } from '@pokewaterblue/database';
import { AssetService } from './asset-service.js';
import { CharacterServiceError } from './character-service.js';

if (existsSync('.env')) process.loadEnvFile('.env');

async function main() {
  if ((process.env['NODE_ENV'] ?? 'development') !== 'development' || (process.env['APP_MODE'] ?? 'local-preview') !== 'local-preview') {
    throw new Error('db:seed:dev is available only in local development, never in tester or production mode.');
  }
  const args = process.argv.slice(2), values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!['--character', '--profile', '--command'].includes(name) || !value || value.startsWith('--') || values.has(name)) {
      throw new Error('Usage: npm.cmd run db:seed:dev -- --character <UUID> --profile r1-squirtle-v1 [--command <UUID>]');
    }
    values.set(name, value);
  }
  if (!values.has('--character') || values.get('--profile') !== 'r1-squirtle-v1') {
    throw new Error('Select an existing trainer with --character <UUID> and --profile r1-squirtle-v1.');
  }
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('Missing local DATABASE_URL. Run project setup first.');
  const database = createDatabase(databaseUrl);
  try {
    const commandId = values.get('--command') ?? randomUUID();
    const result = await new AssetService(database).seedDevelopmentFixture({ characterId: values.get('--character')!, commandId, profileId: 'r1-squirtle-v1' });
    console.log(JSON.stringify({ event: 'development-fixture', commandId, ...result, scope: 'Persisted development assets only; world movement and battles remain unavailable.' }));
  } finally { await database.close(); }
}

main().catch(error => {
  const message = error instanceof CharacterServiceError || error instanceof Error && !('code' in error) ? error.message : 'Development fixture failed; no success was acknowledged.';
  console.error(JSON.stringify({ event: 'development-fixture-failed', code: error instanceof CharacterServiceError ? error.code : 'INVALID_CONFIGURATION', message }));
  process.exitCode = 1;
});
