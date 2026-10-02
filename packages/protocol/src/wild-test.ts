import { z } from 'zod';

const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const wildTestStateSchema = z.strictObject({ enabled: z.boolean(), revision });
export const wildTestCommandSchema = z.strictObject({ commandId: z.uuid(), expectedRevision: revision, enabled: z.boolean() });
export const wildTestSnapshotSchema = z.strictObject({ commandId: z.uuid().nullable(), replayed: z.boolean(), state: wildTestStateSchema });
export type WildTestState = z.infer<typeof wildTestStateSchema>;
export type WildTestCommand = z.infer<typeof wildTestCommandSchema>;
export type WildTestSnapshot = z.infer<typeof wildTestSnapshotSchema>;
