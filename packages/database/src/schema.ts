import { check, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
export * from './auth-schema.js';
export * from './character-schema.js';
export * from './asset-schema.js';
export * from './practice-schema.js';

// Foundation metadata; reviewed account/character schemas are exported above.
export const runtimeMetadata = pgTable('runtime_metadata', {
  key: text('key').primaryKey(),
  protocolVersion: integer('protocol_version').notNull(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check('runtime_metadata_key_nonempty', sql`length(${table.key}) > 0`),
  check('runtime_metadata_protocol_positive', sql`${table.protocolVersion} > 0`),
]);
