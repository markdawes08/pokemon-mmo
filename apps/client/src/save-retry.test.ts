import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterError, CharacterSnapshot, SaveProfileCommand } from '@pokewaterblue/protocol';
import { retryStaleSave, obsoleteSaveError } from './save-retry.js';

function fixture() {
  const current: CharacterSnapshot = { protocolVersion: 1, serverVersion: 'test', contentHash: '0'.repeat(64),
    rulesVersion: 'character-foundation-v1', connectionGeneration: 3, worldActive: true,
    character: { id: randomUUID(), name: 'SAVE', revision: 6, stage: 'development-fixture', activity: 'overworld',
      activityId: randomUUID(), createdAt: '2026-10-02T00:00:00.000Z', savedAt: null } };
  const command: SaveProfileCommand = { commandId: randomUUID(), type: 'save-profile', version: 1,
    activityId: current.character.activityId, expectedRevision: 6, payload: {} };
  const latest = structuredClone(current); latest.character.revision = 7;
  const error: CharacterError = { code: 'STALE_REVISION', commandId: command.commandId, message: 'Changed', snapshot: latest };
  return { current, command, error };
}

describe('definitively rejected Save recovery', () => {
  it('ignores an old-generation pending-UUID response even after its timer expired, while preserving current fatal errors', () => {
    const { command, current, error } = fixture(), before = structuredClone(command);
    current.connectionGeneration = 4;
    expect(obsoleteSaveError(command, current, error)).toBe(true);
    expect(command).toEqual(before);
    error.snapshot!.connectionGeneration = 4; error.code = 'AUTH_REQUIRED';
    expect(obsoleteSaveError(command, current, error)).toBe(false);
    error.snapshot!.character.id = randomUUID();
    expect(obsoleteSaveError(command, current, error)).toBe(true);
    error.commandId = randomUUID();
    expect(obsoleteSaveError(command, current, error)).toBe(false);
  });
  it('uses a fresh UUID once after a same-owner periodic checkpoint, preserving the rejected command', () => {
    const { command, current, error } = fixture(), before = structuredClone(command), id = randomUUID();
    const next = retryStaleSave(command, 3, current, error, 0, () => id);
    expect(next).toEqual({ ...before, commandId: id, expectedRevision: 7 });
    expect(command).toEqual(before);
    expect(retryStaleSave(command, 3, current, error, 1, () => randomUUID())).toBeNull();
  });
  it('never rebases unknown outcomes, BUSY or a rejection of a different command', () => {
    for (const code of ['COMMAND_OUTCOME_UNKNOWN', 'DATABASE_UNAVAILABLE', 'BUSY', 'INVALID_MESSAGE', 'COMMAND_CONFLICT'] as const) {
      const { command, current, error } = fixture(), before = structuredClone(command), id = vi.fn(() => randomUUID());
      error.code = code;
      expect(retryStaleSave(command, 3, current, error, 0, id)).toBeNull();
      expect(command).toEqual(before); expect(id).not.toHaveBeenCalled();
    }
    for (const commandId of [undefined, randomUUID()]) {
      const { command, current, error } = fixture(), before = structuredClone(command), id = vi.fn(() => randomUUID());
      if (commandId) error.commandId = commandId; else delete error.commandId;
      expect(retryStaleSave(command, 3, current, error, 0, id)).toBeNull();
      expect(command).toEqual(before); expect(id).not.toHaveBeenCalled();
    }
  });
  it('rejects missing, old, cross-owner, cross-activity and cross-generation authority', () => {
    const mutations: ((error: CharacterError, current: CharacterSnapshot) => void)[] = [
      error => { delete error.snapshot; },
      error => { error.snapshot!.character.revision = 6; },
      error => { error.snapshot!.character.id = randomUUID(); },
      error => { error.snapshot!.character.activityId = randomUUID(); },
      error => { error.snapshot!.connectionGeneration = 4; },
      (_error, current) => { current.connectionGeneration = 4; },
      (_error, current) => { current.character.activityId = randomUUID(); },
      (error, current) => { error.snapshot!.character.activity = current.character.activity = 'battle'; },
    ];
    for (const mutate of mutations) {
      const { command, current, error } = fixture(), id = vi.fn(() => randomUUID()); mutate(error, current);
      expect(retryStaleSave(command, 3, current, error, 0, id)).toBeNull(); expect(id).not.toHaveBeenCalled();
    }
  });
});
