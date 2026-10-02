import { z } from 'zod';

const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const CHARACTER_ROOM = 'character' as const;
export const CHARACTER_RULES_VERSION = 'character-foundation-v1' as const;
export const CHARACTER_RECONNECT_GRACE_MS = 60_000;
export const trainerNameSchema = z.string().trim().regex(/^[A-Za-z]{1,7}$/, 'Use 1–7 letters.').transform(value => value.toUpperCase());
export const characterViewSchema = z.strictObject({
  id: z.uuid(), name: z.string().regex(/^[A-Z]{1,7}$/), revision: counter,
  stage: z.enum(['awaiting-new-game', 'development-fixture']),
  activity: z.enum(['overworld', 'scripted_event', 'battle', 'trade', 'transferring', 'recovering']),
  activityId: z.uuid(), createdAt: z.iso.datetime(), savedAt: z.iso.datetime().nullable(),
});
export const accountViewSchema = z.strictObject({
  user: z.strictObject({ id: z.string().min(1).max(128), email: z.email() }),
  character: characterViewSchema.nullable(),
});
export const createCharacterSchema = z.strictObject({ commandId: z.uuid(), name: trainerNameSchema });
export const characterTicketSchema = z.strictObject({ ticket: z.string().min(32).max(256), expiresAt: z.iso.datetime() });
export const characterJoinSchema = z.strictObject({ protocolVersion: z.literal(1), ticket: z.string().min(32).max(256) });
export const characterSnapshotSchema = z.strictObject({
  protocolVersion: z.literal(1), serverVersion: z.string().min(1).max(64),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/), rulesVersion: z.literal(CHARACTER_RULES_VERSION),
  character: characterViewSchema, connectionGeneration: counter.min(1), worldActive: z.boolean().optional(),
});
export const saveProfileCommandSchema = z.strictObject({
  commandId: z.uuid(), type: z.literal('save-profile'), version: z.literal(1),
  activityId: z.uuid(), expectedRevision: counter, payload: z.strictObject({}),
});
export const profileSavedSchema = z.strictObject({ commandId: z.uuid(), character: characterViewSchema, replayed: z.boolean() });
export const characterErrorSchema = z.strictObject({
  code: z.enum(['AUTH_REQUIRED', 'NOT_FOUND', 'NAME_INVALID', 'CHARACTER_EXISTS', 'COMMAND_CONFLICT',
    'STALE_REVISION', 'SESSION_REPLACED', 'LEASE_EXPIRED', 'DATABASE_UNAVAILABLE', 'INVALID_MESSAGE',
    'UNSUPPORTED_MESSAGE', 'NOT_READY', 'PROTOCOL_MISMATCH', 'RATE_LIMITED', 'RECONNECT_REQUIRED',
    'COMMAND_OUTCOME_UNKNOWN', 'BUSY', 'TICKET_INVALID']),
  message: z.string().min(1).max(256), snapshot: characterSnapshotSchema.optional(), commandId: z.uuid().optional(),
});
export type CharacterView = z.infer<typeof characterViewSchema>;
export type AccountView = z.infer<typeof accountViewSchema>;
export type CreateCharacter = z.infer<typeof createCharacterSchema>;
export type CharacterSnapshot = z.infer<typeof characterSnapshotSchema>;
export type SaveProfileCommand = z.infer<typeof saveProfileCommandSchema>;
export type ProfileSaved = z.infer<typeof profileSavedSchema>;
export type CharacterError = z.infer<typeof characterErrorSchema>;
