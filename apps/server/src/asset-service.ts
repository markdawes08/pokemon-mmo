import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Database } from '@pokewaterblue/database';
import { trainerAssetsSchema, type TrainerAssets } from '@pokewaterblue/protocol';
import { CharacterServiceError } from './character-service.js';
import { DEVELOPMENT_PROFILE_ID, loadDevelopmentProfile, type DevelopmentProfile } from './development-profile.js';

const commandSchema = z.strictObject({ characterId: z.uuid(), commandId: z.uuid(), profileId: z.literal('r1-squirtle-v1') });
export type SeedDevelopmentCommand = z.infer<typeof commandSchema>;
export interface SeedDevelopmentResult { characterId: string; profileId: typeof DEVELOPMENT_PROFILE_ID; revision: number; replayed: boolean }
export interface AssetServiceTestHooks {
  beforeCommit?: () => void | Promise<void>;
  commit?: (client: PoolClient) => Promise<void>;
}
interface CharacterRow {
  id: string; account_id: string; name: string; revision: string; stage: string; activity: string;
  map_id: string | null; position_x: number | null; position_y: number | null;
}
interface StoredResult { characterId: string; profileId: typeof DEVELOPMENT_PROFILE_ID; revision: number }
interface ReceiptRow { payload_hash: string; result: unknown }
const storedResultSchema = z.strictObject({ characterId: z.uuid(), profileId: z.literal('r1-squirtle-v1'), revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) });
class UnknownCommit extends Error {}
function fail(code: ConstructorParameters<typeof CharacterServiceError>[0], message: string): never { throw new CharacterServiceError(code, message); }

function databaseIdentity(value: string): string {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.search || url.hash) {
    throw new Error('Development fixtures require a loopback PostgreSQL database.');
  }
  return `${url.port || '5432'}${decodeURIComponent(url.pathname)}`;
}

/** No browser mutation route calls this service. A seed is an explicitly local, offline operator command. */
export class AssetService {
  private readonly hooks: AssetServiceTestHooks | undefined;
  constructor(private readonly database: Database, options: { testHooks?: AssetServiceTestHooks } = {}) {
    if (options.testHooks && process.env['NODE_ENV'] !== 'test') throw new Error('Asset failure injection is test-only.');
    this.hooks = options.testHooks;
  }

  private assertDevelopmentDatabase() {
    const mode = process.env['NODE_ENV'] ?? 'development';
    if (!['development', 'test'].includes(mode) || (process.env['APP_MODE'] ?? 'local-preview') !== 'local-preview') {
      fail('NOT_READY', 'Development fixtures are available only in the local development environment.');
    }
    try {
      const identity = databaseIdentity(this.database.pool.options.connectionString ?? '');
      if (mode === 'test') {
        const testUrl = process.env['TEST_DATABASE_URL'] ?? '';
        if (identity !== databaseIdentity(testUrl) || !decodeURIComponent(new URL(testUrl).pathname).endsWith('_test')
          || identity === databaseIdentity(process.env['DATABASE_URL'] ?? '')) throw new Error('An isolated test database is required.');
      }
    } catch { fail('NOT_READY', 'Development fixtures require the local development database or a distinct configured test database.'); }
  }

  private async guarded<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof CharacterServiceError) throw error;
      fail('DATABASE_UNAVAILABLE', 'Trainer asset storage is unavailable. Retry the same command ID.');
    }
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>, writing = false): Promise<T> {
    const client = await this.database.pool.connect();
    let committing = false, destroy = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '2500ms'");
      const result = await work(client);
      if (writing) await this.hooks?.beforeCommit?.();
      committing = true;
      if (writing && this.hooks?.commit) await this.hooks.commit(client);
      else await client.query('COMMIT');
      return result;
    } catch (error) {
      if (committing) { destroy = true; throw new UnknownCommit('Receipt reconciliation is required.', { cause: error }); }
      try { await client.query('ROLLBACK'); } catch { destroy = true; }
      throw error;
    } finally { client.release(destroy); }
  }

  private async seedLock(client: PoolClient, characterId: string): Promise<CharacterRow> {
    const found = await client.query<CharacterRow>('SELECT * FROM characters WHERE id=$1 FOR UPDATE', [characterId]);
    const row = found.rows[0];
    if (!row) fail('NOT_FOUND', 'The explicitly selected trainer does not exist.');
    const lease = await client.query<{ active: boolean }>('SELECT expires_at > clock_timestamp() AS active FROM character_leases WHERE character_id=$1 FOR UPDATE', [characterId]);
    if (lease.rows[0]?.active) fail('BUSY', 'Disconnect or sign out this trainer, then retry after its lease expires.');
    return row;
  }

  private validateReceipt(row: ReceiptRow | undefined, hash: string): StoredResult | undefined {
    if (!row) return undefined;
    if (row.payload_hash !== hash) fail('COMMAND_CONFLICT', 'This command or development profile was already applied with different content.');
    return storedResultSchema.parse(row.result);
  }

  private async previous(client: PoolClient, command: SeedDevelopmentCommand, hash: string): Promise<StoredResult | undefined> {
    const receipt = await client.query<ReceiptRow>('SELECT payload_hash,result FROM character_command_receipts WHERE character_id=$1 AND command_id=$2', [command.characterId, command.commandId]);
    const receiptResult = this.validateReceipt(receipt.rows[0], hash);
    const permanent = await client.query<ReceiptRow>("SELECT payload_hash,result FROM domain_outcomes WHERE character_id=$1 AND type='development-seed' AND business_key=$2", [command.characterId, command.profileId]);
    const permanentResult = this.validateReceipt(permanent.rows[0], hash);
    // A receipt cannot authorize re-granting if its permanent business outcome was lost or corrupted.
    if (receiptResult && !permanentResult) fail('NOT_READY', 'The development fixture outcome needs operator inspection.');
    if (receiptResult && JSON.stringify(receiptResult) !== JSON.stringify(permanentResult)) fail('NOT_READY', 'The development fixture receipt is inconsistent.');
    if (permanentResult && (permanentResult.characterId !== command.characterId || permanentResult.profileId !== command.profileId)) fail('NOT_READY', 'The development fixture outcome is inconsistent.');
    return permanentResult;
  }

  private async registerContent(client: PoolClient, profile: DevelopmentProfile) {
    await client.query('INSERT INTO content_versions (content_hash,source_fingerprint,schema_version) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [profile.contentHash, profile.sourceFingerprint, profile.schemaVersion]);
    for (const species of profile.definitions.species) {
      const stats = species.stats;
      await client.query(`INSERT INTO content_species (content_hash,source_id,name,base_hp,base_attack,base_defense,base_speed,base_sp_attack,base_sp_defense,growth_rate)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`, [profile.contentHash, species.id, species.name, stats.hp, stats.attack, stats.defense, stats.speed, stats.spAttack, stats.spDefense, species.growthRate.id]);
    }
    for (const move of profile.definitions.moves) await client.query('INSERT INTO content_moves (content_hash,source_id,name,base_pp) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [profile.contentHash, move.id, move.name, move.pp]);
    for (const ability of profile.definitions.abilities) await client.query('INSERT INTO content_abilities (content_hash,source_id,name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [profile.contentHash, ability.id, ability.name]);
    for (const item of profile.definitions.items) await client.query('INSERT INTO content_items (content_hash,source_id,name,pocket) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [profile.contentHash, item.id, item.name, item.pocket.symbol]);
    // Existing immutable definitions must match this exact source version; never trust a conflicting row.
    const definitions = [
      { table: 'content_versions', columns: ['source_fingerprint', 'schema_version'], rows: [[profile.sourceFingerprint, profile.schemaVersion]] },
      { table: 'content_species', columns: ['source_id', 'name', 'base_hp', 'base_attack', 'base_defense', 'base_speed', 'base_sp_attack', 'base_sp_defense', 'growth_rate'],
        rows: profile.definitions.species.map(row => [row.id, row.name, row.stats.hp, row.stats.attack, row.stats.defense, row.stats.speed, row.stats.spAttack, row.stats.spDefense, row.growthRate.id]) },
      { table: 'content_moves', columns: ['source_id', 'name', 'base_pp'], rows: profile.definitions.moves.map(row => [row.id, row.name, row.pp]) },
      { table: 'content_abilities', columns: ['source_id', 'name'], rows: profile.definitions.abilities.map(row => [row.id, row.name]) },
      { table: 'content_items', columns: ['source_id', 'name', 'pocket'], rows: profile.definitions.items.map(row => [row.id, row.name, row.pocket.symbol]) },
    ];
    for (const definition of definitions) {
      const actual = await client.query<Record<string, string | number>>(`SELECT ${definition.columns.join(',')} FROM ${definition.table} WHERE content_hash=$1`, [profile.contentHash]);
      const canonical = (rows: (string | number)[][]) => rows.map(row => JSON.stringify(row)).sort();
      if (JSON.stringify(canonical(actual.rows.map(row => definition.columns.map(column => row[column])))) !== JSON.stringify(canonical(definition.rows))) {
        fail('NOT_READY', 'Persisted content definitions differ from the selected development profile.');
      }
    }
  }

  private async applyFixture(client: PoolClient, row: CharacterRow, command: SeedDevelopmentCommand, hash: string, profile: DevelopmentProfile): Promise<StoredResult> {
    if (row.stage !== 'awaiting-new-game' || row.activity !== 'recovering' || row.map_id !== null) fail('NOT_READY', 'Development fixtures require an untouched staged trainer.');
    if (Number(row.revision) >= Number.MAX_SAFE_INTEGER) fail('NOT_READY', 'Trainer revision capacity is exhausted.');
    // A staged trainer may have profile checkpoints, but no assets or progression to overwrite.
    const existing = await client.query<{ present: boolean }>(`SELECT EXISTS (
      SELECT 1 FROM creatures WHERE owner_id=$1 UNION ALL SELECT 1 FROM character_inventory WHERE character_id=$1
      UNION ALL SELECT 1 FROM character_wallets WHERE character_id=$1 UNION ALL SELECT 1 FROM character_flags WHERE character_id=$1
      UNION ALL SELECT 1 FROM character_variables WHERE character_id=$1 UNION ALL SELECT 1 FROM character_claims WHERE character_id=$1
      UNION ALL SELECT 1 FROM character_map_patches WHERE character_id=$1 UNION ALL SELECT 1 FROM character_trainer_completions WHERE character_id=$1
      UNION ALL SELECT 1 FROM domain_outcomes WHERE character_id=$1) AS present`, [row.id]);
    if (existing.rows[0]?.present) fail('NOT_READY', 'This trainer already has assets or progression. No fixture was applied.');
    await this.registerContent(client, profile);
    const creature = profile.creature, creatureId = randomUUID();
    const statNames = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;
    const values = [creatureId, row.id, profile.contentHash, creature.speciesId, creature.abilityId, creature.heldItemId,
      creature.nickname, creature.personality, creature.otId, row.name, creature.level, creature.experience, creature.friendship,
      ...statNames.map(name => creature.ivs[name]), ...statNames.map(name => creature.evs[name]),
      creature.stats.hp, creature.hp, creature.stats.attack, creature.stats.defense, creature.stats.speed, creature.stats.spAttack, creature.stats.spDefense,
      creature.status, creature.statusTurns, creature.locationKind, creature.boxIndex, creature.slotIndex, 'development-fixture', `${profile.id}:starter`];
    await client.query(`INSERT INTO creatures (id,owner_id,content_hash,species_id,ability_id,held_item_id,nickname,personality,ot_id,ot_name,level,experience,friendship,
      iv_hp,iv_attack,iv_defense,iv_speed,iv_sp_attack,iv_sp_defense,ev_hp,ev_attack,ev_defense,ev_speed,ev_sp_attack,ev_sp_defense,
      max_hp,hp,attack,defense,speed,sp_attack,sp_defense,status,status_turns,location_kind,box_index,slot_index,provenance_kind,provenance_key)
      VALUES (${values.map((_, index) => `$${index + 1}`).join(',')})`, values);
    for (const move of creature.moves) await client.query('INSERT INTO creature_moves (creature_id,content_hash,slot_index,move_id,pp,pp_ups) VALUES ($1,$2,$3,$4,$5,$6)', [creatureId, profile.contentHash, move.slotIndex, move.moveId, move.pp, move.ppUps]);
    for (const item of profile.inventory) await client.query('INSERT INTO character_inventory (character_id,content_hash,item_id,pocket,slot_index,quantity) VALUES ($1,$2,$3,$4,$5,$6)', [row.id, profile.contentHash, item.itemId, item.pocket, item.slotIndex, item.quantity]);
    await client.query('INSERT INTO character_wallets (character_id,money) VALUES ($1,$2)', [row.id, profile.money]);
    for (const flag of profile.flags) await client.query('INSERT INTO character_flags (character_id,flag_key) VALUES ($1,$2)', [row.id, flag]);
    for (const variable of profile.variables) await client.query('INSERT INTO character_variables (character_id,variable_key,value) VALUES ($1,$2,$3)', [row.id, variable.key, variable.value]);
    const changed = await client.query<{ revision: string }>(`UPDATE characters SET stage='development-fixture',activity='recovering',activity_id=$2,
      map_id=$3,position_x=$4,position_y=$5,position_elevation=3,position_facing='south',revision=revision+1,saved_at=clock_timestamp() WHERE id=$1 RETURNING revision`, [row.id, randomUUID(), profile.location.mapId, profile.location.x, profile.location.y]);
    const result = { characterId: row.id, profileId: profile.id, revision: Number(changed.rows[0].revision) };
    const outcomeId = randomUUID();
    await client.query(`INSERT INTO domain_outcomes (id,character_id,type,business_key,payload_hash,content_hash,result)
      VALUES ($1,$2,'development-seed',$3,$4,$5,$6)`, [outcomeId, row.id, profile.id, hash, profile.contentHash, JSON.stringify(result)]);
    await client.query('INSERT INTO character_command_receipts (character_id,command_id,payload_hash,result) VALUES ($1,$2,$3,$4)', [row.id, command.commandId, hash, JSON.stringify(result)]);
    await client.query("INSERT INTO audit_events (id,character_id,domain_outcome_id,event_type,detail) VALUES ($1,$2,$3,'development-fixture-applied',$4)", [randomUUID(), row.id, outcomeId, JSON.stringify({ profileId: profile.id, revision: result.revision })]);
    return result;
  }

  async seedDevelopmentFixture(input: SeedDevelopmentCommand): Promise<SeedDevelopmentResult> {
    this.assertDevelopmentDatabase();
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) fail('INVALID_MESSAGE', 'Select an existing trainer UUID, command UUID and the r1-squirtle-v1 profile.');
    const command = parsed.data;
    const profile = await loadDevelopmentProfile();
    const hash = createHash('sha256').update(JSON.stringify({ type: 'development-seed', version: 1, profileId: profile.id, contentHash: profile.contentHash,
      location: profile.location, creature: profile.creature, inventory: profile.inventory, money: profile.money, flags: profile.flags, variables: profile.variables })).digest('hex');
    return this.guarded(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await this.transaction(async client => {
            const row = await this.seedLock(client, command.characterId);
            const previous = await this.previous(client, command, hash);
            if (previous) {
              await client.query('INSERT INTO character_command_receipts (character_id,command_id,payload_hash,result) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [command.characterId, command.commandId, hash, JSON.stringify(previous)]);
              return { ...previous, replayed: true };
            }
            const result = await this.applyFixture(client, row, command, hash, profile);
            return { ...result, replayed: false };
          }, true);
        } catch (error) {
          if (!(error instanceof UnknownCommit)) throw error;
          const recovered = await this.transaction(async client => {
            await this.seedLock(client, command.characterId);
            return this.previous(client, command, hash);
          });
          if (recovered) return { ...recovered, replayed: true };
        }
      }
      return fail('COMMAND_OUTCOME_UNKNOWN', 'The development fixture is unresolved. Retry the same command ID.');
    });
  }

  async readOwnAssets(accountId: string, characterId: string, sessionId?: string): Promise<TrainerAssets> {
    if (!z.uuid().safeParse(characterId).success) fail('NOT_FOUND', 'No trainer belongs to this account.');
    return this.guarded(() => this.transaction(async client => {
      if (sessionId) {
        const session = await client.query('SELECT id FROM auth_session WHERE id=$1 AND user_id=$2 AND expires_at > clock_timestamp() FOR SHARE', [sessionId, accountId]);
        if (!session.rowCount) fail('AUTH_REQUIRED', 'Your account session expired. Sign in again.');
      }
      // All asset mutations lock this same parent row, so every query below observes one committed revision.
      const selected = await client.query<CharacterRow>('SELECT * FROM characters WHERE id=$1 AND account_id=$2 FOR SHARE', [characterId, accountId]);
      const character = selected.rows[0];
      if (!character) fail('NOT_FOUND', 'No trainer belongs to this account.');
      const party = await client.query<{ id: string; slot_index: number; species_id: number; name: string; nickname: string | null; level: number; hp: number; max_hp: number; status: string }>(`SELECT c.id,c.slot_index,c.species_id,s.name,c.nickname,c.level,c.hp,c.max_hp,c.status FROM creatures c
        JOIN content_species s ON s.content_hash=c.content_hash AND s.source_id=c.species_id WHERE c.owner_id=$1 AND c.location_kind='party' ORDER BY c.slot_index`, [characterId]);
      const moves = await client.query<{ creature_id: string; slot_index: number; move_id: number; name: string; pp: number; max_pp: number }>(`SELECT m.creature_id,m.slot_index,m.move_id,d.name,m.pp,d.base_pp + floor(d.base_pp*m.pp_ups/5.0)::int AS max_pp
        FROM creature_moves m JOIN creatures c ON c.id=m.creature_id JOIN content_moves d ON d.content_hash=m.content_hash AND d.source_id=m.move_id
        WHERE c.owner_id=$1 AND c.location_kind='party' ORDER BY m.slot_index`, [characterId]);
      const storage = await client.query<{ count: string }>("SELECT count(*) FROM creatures WHERE owner_id=$1 AND location_kind='storage'", [characterId]);
      const inventory = await client.query<{ item_id: number; name: string; quantity: number; pocket: string }>(`SELECT i.item_id,d.name,i.quantity,i.pocket FROM character_inventory i
        JOIN content_items d ON d.content_hash=i.content_hash AND d.source_id=i.item_id WHERE i.character_id=$1 ORDER BY i.pocket,i.slot_index`, [characterId]);
      const wallet = await client.query<{ money: number }>('SELECT money FROM character_wallets WHERE character_id=$1', [characterId]);
      const flags = await client.query<{ flag_key: string }>("SELECT flag_key FROM character_flags WHERE character_id=$1 AND flag_key=$2 ORDER BY flag_key", [characterId, `development:${DEVELOPMENT_PROFILE_ID}:initialized`]);
      const profile = await client.query<{ business_key: string }>("SELECT business_key FROM domain_outcomes WHERE character_id=$1 AND type='development-seed' AND business_key=$2", [characterId, DEVELOPMENT_PROFILE_ID]);
      return trainerAssetsSchema.parse({ version: 1, characterId, revision: Number(character.revision), profileId: profile.rows[0]?.business_key ?? null,
        party: party.rows.map(member => ({ id: member.id, slot: member.slot_index - 1, speciesId: member.species_id, name: member.name, nickname: member.nickname,
          level: member.level, hp: member.hp, maxHp: member.max_hp, status: member.status === 'toxic' ? 'bad-poison' : member.status,
          moves: moves.rows.filter(move => move.creature_id === member.id).map(move => ({ slot: move.slot_index - 1, moveId: move.move_id, name: move.name, pp: move.pp, maxPp: move.max_pp })) })),
        storage: { used: Number(storage.rows[0].count), capacity: 420 }, inventory: inventory.rows.map(item => ({ itemId: item.item_id, name: item.name, quantity: item.quantity, pocket: item.pocket })),
        money: wallet.rows[0]?.money ?? 0, location: character.map_id === null ? null : { mapId: character.map_id, x: character.position_x, y: character.position_y }, developmentFlags: flags.rows.map(flag => flag.flag_key) });
    }));
  }
}
