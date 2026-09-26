import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { characters } from './character-schema.js';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`);
const characterId = () => uuid('character_id').notNull().references(() => characters.id, { onDelete: 'restrict' });
const contentHash = () => text('content_hash').notNull().references(() => contentVersions.contentHash, { onDelete: 'restrict' });
const sourceDefinition = () => ({ contentHash: contentHash(), sourceId: integer('source_id').notNull(), name: text('name').notNull() });
const object = (name: string) => jsonb(name).$type<Record<string, unknown>>().notNull();

export const contentVersions = pgTable('content_versions', {
  contentHash: text('content_hash').primaryKey(), sourceFingerprint: text('source_fingerprint').notNull(),
  schemaVersion: integer('schema_version').notNull(), createdAt: createdAt(),
}, table => [
  check('content_versions_content_hash_check', sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`),
  check('content_versions_source_fingerprint_check', sql`${table.sourceFingerprint} ~ '^[0-9a-f]{64}$'`),
  check('content_versions_schema_version_check', sql`${table.schemaVersion} > 0`),
]);
export const contentSpecies = pgTable('content_species', {
  ...sourceDefinition(), baseHp: integer('base_hp').notNull(), baseAttack: integer('base_attack').notNull(),
  baseDefense: integer('base_defense').notNull(), baseSpeed: integer('base_speed').notNull(),
  baseSpAttack: integer('base_sp_attack').notNull(), baseSpDefense: integer('base_sp_defense').notNull(), growthRate: integer('growth_rate').notNull(),
}, table => [
  primaryKey({ columns: [table.contentHash, table.sourceId] }),
  check('content_species_source_id_check', sql`${table.sourceId} BETWEEN 1 AND 411`),
  check('content_species_name_check', sql`length(${table.name}) BETWEEN 1 AND 10`),
  ...([['base_hp', table.baseHp], ['base_attack', table.baseAttack], ['base_defense', table.baseDefense],
    ['base_speed', table.baseSpeed], ['base_sp_attack', table.baseSpAttack], ['base_sp_defense', table.baseSpDefense]] as const)
    .map(([name, column]) => check(`content_species_${name}_check`, sql`${column} BETWEEN 1 AND 255`)),
  check('content_species_growth_rate_check', sql`${table.growthRate} BETWEEN 0 AND 5`),
]);
export const contentMoves = pgTable('content_moves', {
  ...sourceDefinition(), basePp: integer('base_pp').notNull(),
}, table => [
  primaryKey({ columns: [table.contentHash, table.sourceId] }),
  check('content_moves_source_id_check', sql`${table.sourceId} BETWEEN 1 AND 354`),
  check('content_moves_name_check', sql`length(${table.name}) BETWEEN 1 AND 12`),
  check('content_moves_base_pp_check', sql`${table.basePp} BETWEEN 1 AND 255`),
]);
export const contentAbilities = pgTable('content_abilities', sourceDefinition(), table => [
  primaryKey({ columns: [table.contentHash, table.sourceId] }),
  check('content_abilities_source_id_check', sql`${table.sourceId} BETWEEN 0 AND 77`),
  check('content_abilities_name_check', sql`length(${table.name}) BETWEEN 1 AND 12`),
]);
export const contentItems = pgTable('content_items', { ...sourceDefinition(), pocket: text('pocket').notNull() }, table => [
  primaryKey({ columns: [table.contentHash, table.sourceId] }), unique().on(table.contentHash, table.sourceId, table.pocket),
  check('content_items_source_id_check', sql`${table.sourceId} BETWEEN 0 AND 374`),
  check('content_items_name_check', sql`length(${table.name}) BETWEEN 1 AND 14`),
  check('content_items_pocket_check', sql`${table.pocket} IN ('POCKET_ITEMS','POCKET_KEY_ITEMS','POCKET_POKE_BALLS','POCKET_TM_CASE','POCKET_BERRY_POUCH')`),
]);

export const creatures = pgTable('creatures', {
  id: uuid('id').primaryKey(), ownerId: uuid('owner_id').notNull().references(() => characters.id, { onDelete: 'restrict' }),
  contentHash: text('content_hash').notNull(), speciesId: integer('species_id').notNull(), abilityId: integer('ability_id').notNull(),
  heldItemId: integer('held_item_id').notNull().default(0), nickname: text('nickname').notNull(),
  personality: bigint('personality', { mode: 'number' }).notNull(), otId: bigint('ot_id', { mode: 'number' }).notNull(), otName: text('ot_name').notNull(),
  level: integer('level').notNull(), experience: bigint('experience', { mode: 'number' }).notNull(), friendship: integer('friendship').notNull(),
  ivHp: integer('iv_hp').notNull(), ivAttack: integer('iv_attack').notNull(), ivDefense: integer('iv_defense').notNull(),
  ivSpeed: integer('iv_speed').notNull(), ivSpAttack: integer('iv_sp_attack').notNull(), ivSpDefense: integer('iv_sp_defense').notNull(),
  evHp: integer('ev_hp').notNull(), evAttack: integer('ev_attack').notNull(), evDefense: integer('ev_defense').notNull(),
  evSpeed: integer('ev_speed').notNull(), evSpAttack: integer('ev_sp_attack').notNull(), evSpDefense: integer('ev_sp_defense').notNull(),
  maxHp: integer('max_hp').notNull(), hp: integer('hp').notNull(), attack: integer('attack').notNull(), defense: integer('defense').notNull(),
  speed: integer('speed').notNull(), spAttack: integer('sp_attack').notNull(), spDefense: integer('sp_defense').notNull(),
  status: text('status').notNull(), statusTurns: integer('status_turns').notNull().default(0),
  locationKind: text('location_kind').notNull(), boxIndex: integer('box_index').notNull(), slotIndex: integer('slot_index').notNull(),
  provenanceKind: text('provenance_kind').notNull(), provenanceKey: text('provenance_key').notNull(), createdAt: createdAt(),
}, table => [
  unique().on(table.id, table.contentHash), unique().on(table.ownerId, table.provenanceKey),
  unique().on(table.ownerId, table.locationKind, table.boxIndex, table.slotIndex),
  foreignKey({ columns: [table.contentHash, table.speciesId], foreignColumns: [contentSpecies.contentHash, contentSpecies.sourceId] }).onDelete('restrict'),
  foreignKey({ columns: [table.contentHash, table.abilityId], foreignColumns: [contentAbilities.contentHash, contentAbilities.sourceId] }).onDelete('restrict'),
  foreignKey({ columns: [table.contentHash, table.heldItemId], foreignColumns: [contentItems.contentHash, contentItems.sourceId] }).onDelete('restrict'),
  check('creatures_nickname_check', sql`length(${table.nickname}) BETWEEN 1 AND 10`),
  check('creatures_personality_check', sql`${table.personality} BETWEEN 0 AND 4294967295`),
  check('creatures_ot_id_check', sql`${table.otId} BETWEEN 0 AND 4294967295`), check('creatures_ot_name_check', sql`${table.otName} ~ '^[A-Z]{1,7}$'`),
  check('creatures_level_check', sql`${table.level} BETWEEN 1 AND 100`), check('creatures_experience_check', sql`${table.experience} BETWEEN 0 AND 4294967295`),
  check('creatures_friendship_check', sql`${table.friendship} BETWEEN 0 AND 255`),
  ...([['hp', table.ivHp], ['attack', table.ivAttack], ['defense', table.ivDefense], ['speed', table.ivSpeed],
    ['sp_attack', table.ivSpAttack], ['sp_defense', table.ivSpDefense]] as const).map(([name, column]) => check(`creatures_iv_${name}_check`, sql`${column} BETWEEN 0 AND 31`)),
  ...([['hp', table.evHp], ['attack', table.evAttack], ['defense', table.evDefense], ['speed', table.evSpeed],
    ['sp_attack', table.evSpAttack], ['sp_defense', table.evSpDefense]] as const).map(([name, column]) => check(`creatures_ev_${name}_check`, sql`${column} BETWEEN 0 AND 255`)),
  check('creatures_ev_total', sql`${table.evHp} + ${table.evAttack} + ${table.evDefense} + ${table.evSpeed} + ${table.evSpAttack} + ${table.evSpDefense} <= 510`),
  ...([['max_hp', table.maxHp], ['attack', table.attack], ['defense', table.defense], ['speed', table.speed],
    ['sp_attack', table.spAttack], ['sp_defense', table.spDefense]] as const).map(([name, column]) => check(`creatures_${name}_check`, sql`${column} BETWEEN 1 AND 65535`)),
  check('creatures_hp_check', sql`${table.hp} >= 0 AND ${table.hp} <= ${table.maxHp}`),
  check('creatures_status_check', sql`${table.status} IN ('healthy','poison','burn','sleep','paralysis','freeze','toxic')`),
  check('creatures_status_turns_check', sql`${table.statusTurns} BETWEEN 0 AND 7`),
  check('creatures_status_turns', sql`(${table.status} = 'sleep' AND ${table.statusTurns} BETWEEN 1 AND 7) OR (${table.status} <> 'sleep' AND ${table.statusTurns} = 0)`),
  check('creatures_location', sql`(${table.locationKind} = 'party' AND ${table.boxIndex} = 0 AND ${table.slotIndex} BETWEEN 1 AND 6) OR (${table.locationKind} = 'storage' AND ${table.boxIndex} BETWEEN 1 AND 14 AND ${table.slotIndex} BETWEEN 1 AND 30)`),
  check('creatures_provenance_kind_check', sql`${table.provenanceKind} IN ('development-fixture','caught','gift','trade')`),
  check('creatures_provenance_key_check', sql`length(${table.provenanceKey}) BETWEEN 1 AND 200`),
]);
export const creatureMoves = pgTable('creature_moves', {
  creatureId: uuid('creature_id').notNull(), contentHash: text('content_hash').notNull(), slotIndex: integer('slot_index').notNull(),
  moveId: integer('move_id').notNull(), pp: integer('pp').notNull(), ppUps: integer('pp_ups').notNull(),
}, table => [
  primaryKey({ columns: [table.creatureId, table.slotIndex] }), unique().on(table.creatureId, table.moveId),
  foreignKey({ columns: [table.creatureId, table.contentHash], foreignColumns: [creatures.id, creatures.contentHash] }).onDelete('restrict'),
  foreignKey({ columns: [table.contentHash, table.moveId], foreignColumns: [contentMoves.contentHash, contentMoves.sourceId] }).onDelete('restrict'),
  check('creature_moves_slot_index_check', sql`${table.slotIndex} BETWEEN 1 AND 4`),
  check('creature_moves_pp_check', sql`${table.pp} BETWEEN 0 AND 255`), check('creature_moves_pp_ups_check', sql`${table.ppUps} BETWEEN 0 AND 3`),
]);
export const characterInventory = pgTable('character_inventory', {
  characterId: characterId(), contentHash: text('content_hash').notNull(), itemId: integer('item_id').notNull(),
  pocket: text('pocket').notNull(), slotIndex: integer('slot_index').notNull(), quantity: integer('quantity').notNull(),
}, table => [
  primaryKey({ columns: [table.characterId, table.itemId] }), unique().on(table.characterId, table.pocket, table.slotIndex),
  foreignKey({ columns: [table.contentHash, table.itemId, table.pocket], foreignColumns: [contentItems.contentHash, contentItems.sourceId, contentItems.pocket] }).onDelete('restrict'),
  check('character_inventory_item_id_check', sql`${table.itemId} > 0`), check('character_inventory_quantity_check', sql`${table.quantity} BETWEEN 1 AND 999`),
  check('character_inventory_capacity', sql`${table.slotIndex} >= 1 AND ((${table.pocket} = 'POCKET_ITEMS' AND ${table.slotIndex} <= 42) OR (${table.pocket} = 'POCKET_KEY_ITEMS' AND ${table.slotIndex} <= 30) OR (${table.pocket} = 'POCKET_POKE_BALLS' AND ${table.slotIndex} <= 13) OR (${table.pocket} = 'POCKET_TM_CASE' AND ${table.slotIndex} <= 58) OR (${table.pocket} = 'POCKET_BERRY_POUCH' AND ${table.slotIndex} <= 43))`),
]);
export const characterWallets = pgTable('character_wallets', { characterId: characterId().primaryKey(), money: integer('money').notNull() }, table => [
  check('character_wallets_money_check', sql`${table.money} BETWEEN 0 AND 999999`),
]);
export const domainOutcomes = pgTable('domain_outcomes', {
  id: uuid('id').primaryKey(), characterId: characterId(), type: text('type').notNull(), businessKey: text('business_key').notNull(),
  payloadHash: text('payload_hash').notNull(), contentHash: contentHash(), result: object('result'), createdAt: createdAt(),
}, table => [
  unique().on(table.characterId, table.type, table.businessKey), unique().on(table.id, table.characterId),
  check('domain_outcomes_type_check', sql`length(${table.type}) BETWEEN 1 AND 100`), check('domain_outcomes_business_key_check', sql`length(${table.businessKey}) BETWEEN 1 AND 200`),
  check('domain_outcomes_payload_hash_check', sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`), check('domain_outcomes_result_check', sql`jsonb_typeof(${table.result}) = 'object'`),
]);
export const characterFlags = pgTable('character_flags', {
  characterId: characterId(), flagKey: text('flag_key').notNull(), setAt: timestamp('set_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, table => [primaryKey({ columns: [table.characterId, table.flagKey] }), check('character_flags_flag_key_check', sql`length(${table.flagKey}) BETWEEN 1 AND 200`)]);
export const characterVariables = pgTable('character_variables', {
  characterId: characterId(), variableKey: text('variable_key').notNull(), value: integer('value').notNull(),
}, table => [
  primaryKey({ columns: [table.characterId, table.variableKey] }), check('character_variables_variable_key_check', sql`length(${table.variableKey}) BETWEEN 1 AND 200`),
  check('character_variables_value_check', sql`${table.value} BETWEEN 0 AND 65535`),
]);
export const characterClaims = pgTable('character_claims', {
  characterId: characterId(), claimKey: text('claim_key').notNull(), domainOutcomeId: uuid('domain_outcome_id').notNull(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, table => [
  primaryKey({ columns: [table.characterId, table.claimKey] }), check('character_claims_claim_key_check', sql`length(${table.claimKey}) BETWEEN 1 AND 200`),
  foreignKey({ columns: [table.domainOutcomeId, table.characterId], foreignColumns: [domainOutcomes.id, domainOutcomes.characterId] }).onDelete('restrict'),
]);
export const characterMapPatches = pgTable('character_map_patches', {
  characterId: characterId(), mapId: text('map_id').notNull(), patchKey: text('patch_key').notNull(), contentHash: contentHash(),
  version: integer('version').notNull(), patch: object('patch'),
}, table => [
  primaryKey({ columns: [table.characterId, table.mapId, table.patchKey] }), check('character_map_patches_map_id_check', sql`${table.mapId} ~ '^MAP_[A-Z0-9_]+$'`),
  check('character_map_patches_patch_key_check', sql`length(${table.patchKey}) BETWEEN 1 AND 200`),
  check('character_map_patches_version_check', sql`${table.version} > 0`), check('character_map_patches_patch_check', sql`jsonb_typeof(${table.patch}) = 'object'`),
]);
export const characterTrainerCompletions = pgTable('character_trainer_completions', {
  characterId: characterId(), trainerKey: text('trainer_key').notNull(), contentHash: contentHash(), domainOutcomeId: uuid('domain_outcome_id').notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, table => [
  primaryKey({ columns: [table.characterId, table.trainerKey] }), check('character_trainer_completions_trainer_key_check', sql`length(${table.trainerKey}) BETWEEN 1 AND 200`),
  foreignKey({ columns: [table.domainOutcomeId, table.characterId], foreignColumns: [domainOutcomes.id, domainOutcomes.characterId] }).onDelete('restrict'),
]);
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey(), characterId: characterId(), domainOutcomeId: uuid('domain_outcome_id').notNull(), eventType: text('event_type').notNull(),
  detail: object('detail'), createdAt: createdAt(),
}, table => [
  check('audit_events_event_type_check', sql`length(${table.eventType}) BETWEEN 1 AND 100`), check('audit_events_detail_check', sql`jsonb_typeof(${table.detail}) = 'object'`),
  foreignKey({ columns: [table.domainOutcomeId, table.characterId], foreignColumns: [domainOutcomes.id, domainOutcomes.characterId] }).onDelete('restrict'),
]);
// SQL-only triggers in 0004 enforce immutable registry/outcome updates and source-derived move PP.
