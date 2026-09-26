import { z } from 'zod';
import { characterViewSchema } from './accounts.js';

const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const WORLD_POLICY = 'r1-exploration-v1' as const;
export const WORLD_MAP_HASHES = {
  MAP_PALLET_TOWN: '74fca5a87d5b217034adb2b8139a3d10520f78cbea6ba1d93f8bd06f1deab6f4',
  MAP_ROUTE1: 'd3cec4551bad92ccbaa4ff05dc6e7ef624eb78f0c0a63d9f00c88438316d6249',
  MAP_PALLET_TOWN_PLAYERS_HOUSE_1F: '0b171b0ce01c265e4db3cb3c1fc9d0041b18cef0d1977e0ebfb527746dab6452',
} as const;
export const worldDirectionSchema = z.enum(['north', 'south', 'west', 'east']);
export const worldLocationSchema = z.strictObject({ mapId: z.enum(['MAP_PALLET_TOWN', 'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F', 'MAP_ROUTE1']), x: counter.max(1023), y: counter.max(1023), elevation: counter.max(15) });
export const worldCommandSchema = z.strictObject({ commandId: z.uuid(), activityId: z.uuid(), expectedRevision: counter });
export const worldInputSchema = z.strictObject({ sequence: counter.min(1), connectionGeneration: counter.min(1), zoneGeneration: counter.min(1), direction: worldDirectionSchema, run: z.boolean() });
export const worldMotionSchema = z.strictObject({ from: worldLocationSchema, to: worldLocationSchema, startedAt: counter, durationMs: z.number().positive().max(1000), kind: z.enum(['step', 'jump']), movementMode: z.enum(['walk', 'run']) });
export const worldAvatarSchema = worldLocationSchema.extend({ id: z.uuid(), name: z.string().regex(/^[A-Z]{1,7}$/), direction: worldDirectionSchema, motion: worldMotionSchema.nullable() });
export const worldTransitionSchema = z.strictObject({ id: z.uuid(), via: z.enum(['warp', 'connection']), from: worldLocationSchema, to: worldLocationSchema, arrival: worldLocationSchema.nullable(), direction: worldDirectionSchema, durationMs: z.number().positive().max(1000) });
export const worldSnapshotSchema = z.strictObject({
  mode: z.literal('shared-development'), policy: z.literal(WORLD_POLICY), contentHash: z.string().regex(/^[0-9a-f]{64}$/), sourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  serverTime: counter, connectionGeneration: counter.min(1), zoneGeneration: counter.min(1), lastInputSequence: counter,
  self: worldAvatarSchema, nearby: z.array(worldAvatarSchema).max(63), transition: worldTransitionSchema.optional(),
});
export const worldLeftSchema = z.strictObject({ commandId: z.uuid(), character: characterViewSchema });
export type WorldLocation = z.infer<typeof worldLocationSchema>;
export type WorldCommand = z.infer<typeof worldCommandSchema>;
export type WorldInput = z.infer<typeof worldInputSchema>;
export type WorldAvatar = z.infer<typeof worldAvatarSchema>;
export type WorldSnapshot = z.infer<typeof worldSnapshotSchema>;
export type WorldTransition = z.infer<typeof worldTransitionSchema>;
export type WorldLeft = z.infer<typeof worldLeftSchema>;
