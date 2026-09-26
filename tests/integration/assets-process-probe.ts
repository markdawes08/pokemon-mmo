import { AssetService } from '../../apps/server/src/asset-service.js';
import { createDatabase } from '@pokewaterblue/database';
import { accountTestDatabaseUrl } from './account-fixtures.js';

// A fresh OS process reconstructs the public projection exclusively from durable
// rows. IDs are explicit fixture IDs passed by the parent, never auth bypasses.
const [accountId, characterId] = process.argv.slice(2);
if (!accountId || !characterId) throw new Error('Asset recovery probe requires explicit owned fixture IDs.');
const database = createDatabase(accountTestDatabaseUrl());
try { console.log(JSON.stringify(await new AssetService(database).readOwnAssets(accountId, characterId))); }
finally { await database.close(); }
