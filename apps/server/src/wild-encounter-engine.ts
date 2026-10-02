/** Server-only Route 1 test encounter seam. Persist every accepted candidate
 * with its completed world step; never expose or recreate a saved RNG stream. */
import { randomBytes } from 'node:crypto';
import { battleRngSchema, type BattleRngState } from '@pokewaterblue/battle-core';
import { advanceEncounterRng, checkpointDigest, loadEncounterCore,
  type EncounterCheckpoint, type EncounterCore, type EncounterCreature, type EncounterStep,
} from '../../../tools/encounter-core/encounter.js';

export type { EncounterCheckpoint } from '../../../tools/encounter-core/encounter.js';
export class WildEncounterEngine {
  constructor(private readonly core: EncounterCore) {}
  create(trainerId: number): EncounterCheckpoint {
    const seeds = randomBytes(6);
    return this.core.create({ mainSeed: seeds.readUInt32LE(0), wildSeed: seeds.readUInt16LE(4), trainerId }).snapshot();
  }
  restore(checkpoint: EncounterCheckpoint): EncounterCheckpoint { return this.core.restore(checkpoint).snapshot(); }
  /** Source overworld map loading calls ResetEncounterRateModifiers. Its two
   * assignments preserve both RNG streams, previous terrain and serial. */
  mapTransfer(checkpoint: EncounterCheckpoint): EncounterCheckpoint {
    const restored = this.core.restore(checkpoint);
    if (restored.view().phase !== 'ready') throw new Error('A pending encounter cannot transfer maps.');
    const { digest: _digest, ...body } = restored.snapshot();
    body.words[6] = 0; body.words[7] = 0;
    return this.core.restore({ ...body, digest: checkpointDigest(body) }).snapshot();
  }
  step(checkpoint: EncounterCheckpoint, input: EncounterStep): { checkpoint: EncounterCheckpoint; encounter: boolean } {
    const candidate = this.core.restore(checkpoint), result = candidate.step(input);
    return { checkpoint: candidate.snapshot(), encounter: result.kind === 'encounter' };
  }
  pending(checkpoint: EncounterCheckpoint): { creature: EncounterCreature; seed: number } {
    const view = this.core.restore(checkpoint).view();
    if (view.phase !== 'pending-encounter' || !view.creature || view.trainerId !== 1)
      throw new Error('Wild testing requires a pending source encounter for the temporary Squirtle trainer.');
    return { creature: view.creature, seed: view.generalRng.state };
  }
  /** Called only after PracticeEngine restores and binds the saved wild battle.
   * Battle and field share the source general LCG. The encounter-rate stream
   * and cooldown remain untouched; battle draws cannot rewind or reseed either. */
  continue(checkpoint: EncounterCheckpoint, rawRng: BattleRngState): EncounterCheckpoint {
    const restored = this.core.restore(checkpoint), view = restored.view(), rng = battleRngSchema.parse(rawRng);
    if (view.phase !== 'pending-encounter' || rng.algorithm !== 'firered-lcg32' || rng.version !== 1)
      throw new Error('A pending encounter and its compatible battle RNG are required.');
    const bytes = Buffer.from(rng.privateState.data, 'base64');
    if (rng.privateState.encoding !== 'base64' || bytes.length !== 4)
      throw new Error('The source battle RNG has an invalid representation.');
    const totalDraws = view.generalRng.draws + rng.draws;
    if (!Number.isSafeInteger(totalDraws) || totalDraws > 0xFFFFFFFF || rng.draws > 0xFFFFFFFF
      || advanceEncounterRng(view.generalRng.state, rng.draws, 24691) !== bytes.readUInt32LE())
      throw new Error('The source battle RNG cannot continue this encounter history.');
    const { digest: _digest, ...body } = restored.snapshot();
    body.words[1] = bytes.readUInt32LE(); body.words[3] = totalDraws;
    const candidate = this.core.restore({ ...body, digest: checkpointDigest(body) });
    candidate.continueAfterEncounter();
    return candidate.snapshot();
  }
}

export async function loadWildEncounterEngine(): Promise<WildEncounterEngine> {
  return new WildEncounterEngine(await loadEncounterCore());
}
