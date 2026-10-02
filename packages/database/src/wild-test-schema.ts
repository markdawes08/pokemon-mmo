import { sql } from 'drizzle-orm';
import { bigint, boolean, check, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { characters } from './character-schema.js';

export const characterWildTestState = pgTable('character_wild_test_state', {
  characterId: uuid('character_id').primaryKey().references(() => characters.id, { onDelete: 'restrict' }),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0), enabled: boolean('enabled').notNull().default(false),
  checkpoint: jsonb('checkpoint').$type<Record<string, unknown>>(), lastStepId: uuid('last_step_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, table => [
  check('character_wild_test_state_revision_check', sql`${table.revision} BETWEEN 0 AND 9007199254740991`),
  check('character_wild_test_state_checkpoint_check', sql`${table.checkpoint} IS NULL OR jsonb_typeof(${table.checkpoint}) = 'object'`),
  check('character_wild_test_state_enabled_check', sql`NOT ${table.enabled} OR ${table.checkpoint} IS NOT NULL`),
]);
export const wildTestCommandReceipts = pgTable('wild_test_command_receipts', {
  characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'restrict' }),
  commandId: uuid('command_id').notNull(), payloadHash: text('payload_hash').notNull(),
  result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, table => [
  primaryKey({ columns: [table.characterId, table.commandId] }),
  check('wild_test_command_receipts_payload_hash_check', sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`),
  check('wild_test_command_receipts_result_check', sql`jsonb_typeof(${table.result}) = 'object'`),
]);
