import { sql } from 'drizzle-orm';
import { bigint, check, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { characters } from './character-schema.js';

export const characterPracticeState = pgTable('character_practice_state', {
  characterId: uuid('character_id').primaryKey().references(() => characters.id, { onDelete: 'restrict' }),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0), battleId: uuid('battle_id'),
  checkpoint: jsonb('checkpoint').$type<Record<string, unknown>>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, table => [
  check('character_practice_state_revision_check', sql`${table.revision} BETWEEN 0 AND 9007199254740991`),
  check('character_practice_state_check', sql`(${table.battleId} IS NULL AND ${table.checkpoint} IS NULL) OR (${table.battleId} IS NOT NULL AND ${table.checkpoint} IS NOT NULL AND jsonb_typeof(${table.checkpoint}) = 'object')`),
]);
export const practiceCommandReceipts = pgTable('practice_command_receipts', {
  characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'restrict' }),
  commandId: uuid('command_id').notNull(), payloadHash: text('payload_hash').notNull(),
  result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, table => [
  primaryKey({ columns: [table.characterId, table.commandId] }),
  check('practice_command_receipts_payload_hash_check', sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`),
  check('practice_command_receipts_result_check', sql`jsonb_typeof(${table.result}) = 'object'`),
]);
