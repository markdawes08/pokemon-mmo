import { createDatabase } from '@pokewaterblue/database';
import { CharacterService } from '../../apps/server/src/character-service.js';
import { WorldContent } from '../../apps/server/src/world-content.js';
import { loadPracticeEngine } from '../../apps/server/src/practice-engine.js';
import { accountTestDatabaseUrl } from './account-fixtures.js';

process.env['NODE_ENV'] = 'test';
const database = createDatabase(accountTestDatabaseUrl()), service = new CharacterService(database);
try {
  const accountId = process.env['PRACTICE_TEST_ACCOUNT'], characterId = process.env['PRACTICE_TEST_CHARACTER'];
  if (!accountId || !characterId || !process.send) throw new Error('Owned practice probe requires test identifiers and IPC.');
  service.configureWorld(await WorldContent.load()); service.configurePractice(await loadPracticeEngine(), true);
  const joined = await service.acquire(accountId, characterId);
  const snapshot = await service.practiceSnapshot(joined.connection);
  process.send({ type: 'practice-probe', snapshot });
} finally {
  await service.dispose(); await database.close(); if (process.connected) process.disconnect();
}
