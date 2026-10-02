import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth-schema.js';

export const characters = pgTable('characters', {
  id: uuid('id').primaryKey(),
  accountId: text('account_id').notNull().unique().references(() => user.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  stage: text('stage').notNull().default('awaiting-new-game'),
  activity: text('activity').notNull().default('recovering'),
  activityId: uuid('activity_id').notNull(),
  mapId: text('map_id'), positionX: integer('position_x'), positionY: integer('position_y'),
  positionElevation: integer('position_elevation'), positionFacing: text('position_facing'),
  transitionGeneration: bigint('transition_generation', { mode: 'number' }).notNull().default(0),
  worldCheckpointId: uuid('world_checkpoint_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  savedAt: timestamp('saved_at', { withTimezone: true }),
}, table => [
  check('characters_name_check', sql`${table.name} ~ '^[A-Z]{1,7}$'`),
  check('characters_revision_check', sql`${table.revision} BETWEEN 0 AND 9007199254740991`),
  check('characters_stage_check', sql`${table.stage} IN ('awaiting-new-game', 'development-fixture')`),
  check('characters_activity_check', sql`${table.activity} IN ('overworld', 'scripted_event', 'battle', 'trade', 'transferring', 'recovering')`),
  check('characters_position_x_check', sql`${table.positionX} >= 0`),
  check('characters_position_y_check', sql`${table.positionY} >= 0`),
  check('characters_location_complete', sql`(${table.mapId} IS NULL AND ${table.positionX} IS NULL AND ${table.positionY} IS NULL) OR (${table.mapId} IS NOT NULL AND length(${table.mapId}) > 0 AND ${table.positionX} IS NOT NULL AND ${table.positionY} IS NOT NULL)`),
  check('characters_staged_profile', sql`${table.stage} <> 'awaiting-new-game' OR (${table.activity} = 'recovering' AND ${table.mapId} IS NULL)`),
  check('characters_development_profile', sql`${table.stage} <> 'development-fixture' OR (${table.activity} IN ('recovering','overworld','transferring','battle') AND ${table.mapId} IS NOT NULL)`),
  check('characters_position_elevation_check', sql`${table.positionElevation} BETWEEN 0 AND 15`),
  check('characters_position_facing_check', sql`${table.positionFacing} IN ('north','south','west','east')`),
  check('characters_transition_generation_check', sql`${table.transitionGeneration} BETWEEN 0 AND 9007199254740991`),
  check('characters_world_location_complete', sql`(${table.mapId} IS NULL AND ${table.positionElevation} IS NULL AND ${table.positionFacing} IS NULL) OR (${table.mapId} IS NOT NULL AND ${table.positionElevation} IS NOT NULL AND ${table.positionFacing} IS NOT NULL)`),
  check('characters_world_activity', sql`${table.activity} NOT IN ('overworld','transferring') OR (${table.stage}='development-fixture' AND ${table.transitionGeneration}>0 AND ${table.worldCheckpointId} IS NOT NULL)`),
]);

export const characterLeases = pgTable('character_leases', {
  characterId: uuid('character_id').primaryKey().references(() => characters.id, { onDelete: 'restrict' }),
  ownerId: uuid('owner_id').notNull(),
  leaseGeneration: bigint('lease_generation', { mode: 'number' }).notNull(),
  connectionGeneration: bigint('connection_generation', { mode: 'number' }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, table => [
  check('character_leases_lease_generation_check', sql`${table.leaseGeneration} BETWEEN 1 AND 9007199254740991`),
  check('character_leases_connection_generation_check', sql`${table.connectionGeneration} BETWEEN 1 AND 9007199254740991`),
  index('character_leases_expiry_idx').on(table.expiresAt),
]);

export const accountCreationReceipts = pgTable('account_creation_receipts', {
  accountId: text('account_id').notNull().references(() => user.id, { onDelete: 'restrict' }),
  commandId: uuid('command_id').notNull(), payloadHash: text('payload_hash').notNull(),
  result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, table => [
  primaryKey({ columns: [table.accountId, table.commandId] }),
  check('account_creation_receipts_payload_hash_check', sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`),
  check('account_creation_receipts_result_check', sql`jsonb_typeof(${table.result}) = 'object'`),
]);

export const characterCommandReceipts = pgTable('character_command_receipts', {
  characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'restrict' }),
  commandId: uuid('command_id').notNull(), payloadHash: text('payload_hash').notNull(),
  result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, table => [
  primaryKey({ columns: [table.characterId, table.commandId] }),
  check('character_command_receipts_payload_hash_check', sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`),
  check('character_command_receipts_result_check', sql`jsonb_typeof(${table.result}) = 'object'`),
]);
