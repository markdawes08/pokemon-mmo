import type { CharacterError, CharacterSnapshot, SaveProfileCommand } from '@pokewaterblue/protocol';

/** Applies even after confirmation timed out: a late response from a replaced
 * transport cannot rewind the current snapshot or resolve the retained UUID. */
export function obsoleteSaveError(command: SaveProfileCommand, current: CharacterSnapshot, error: CharacterError): boolean {
  return error.commandId === command.commandId && !!error.snapshot
    && (error.snapshot.connectionGeneration !== current.connectionGeneration || error.snapshot.character.id !== current.character.id);
}

/** A correlated STALE response follows the server's receipt lookup, proving this
 * UUID did not commit. Other errors cannot authorize changing an unresolved save. */
export function retryStaleSave(command: SaveProfileCommand, sentGeneration: number,
  current: CharacterSnapshot, error: CharacterError, retries: number, newId: () => string): SaveProfileCommand | null {
  const latest = error.snapshot;
  if (retries !== 0 || error.code !== 'STALE_REVISION' || error.commandId !== command.commandId || !latest
    || current.connectionGeneration !== sentGeneration || latest.connectionGeneration !== sentGeneration
    || latest.character.id !== current.character.id || latest.character.activityId !== command.activityId
    || current.character.activityId !== command.activityId || latest.character.activity !== current.character.activity
    || !['overworld', 'recovering'].includes(latest.character.activity)
    || latest.character.revision <= command.expectedRevision) return null;
  return { ...command, commandId: newId(), expectedRevision: Math.max(current.character.revision, latest.character.revision), payload: {} };
}
