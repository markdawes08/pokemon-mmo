import { z } from 'zod';

const time = z.number().finite().nonnegative().max(600);
const byte = z.number().int().min(0).max(127);
const voiceId = z.string().regex(/^voicegroup\d+:\d+$/);
const envelope = z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]);
const voice = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sample'), url: z.string().regex(/^\/content\/audio\/samples\/[a-z0-9_]+\.wav$/),
    sampleRate: z.number().int().min(1000).max(96000), sourceRate: z.number().min(1000).max(96000), rootKey: byte,
    loopStart: time, loopEnd: time, frames: z.number().int().positive().max(1000000), envelope }),
  z.object({ kind: z.literal('square'), duty: z.union([z.literal(0.125), z.literal(0.25), z.literal(0.5), z.literal(0.75)]),
    sweep: byte, envelope }),
]);
const control = z.object({ time, volume: byte, pan: z.number().int().min(-64).max(63), bend: z.number().int().min(-64).max(63),
  bendRange: byte, lfoSpeed: byte, modulation: byte });
const note = z.object({ time, duration: time.positive(), key: byte, velocity: byte.min(1), voice: voiceId });
const song = z.object({ id: z.enum(['MUS_PALLET', 'SE_SELECT']), voiceGroup: z.string().regex(/^voicegroup\d+$/),
  tempo: z.number().int().min(1).max(510), ticksPerBeat: z.literal(24), duration: time.positive(),
  loopStart: time.nullable(), loopEnd: time.nullable(), sourceReverb: byte,
  tracks: z.array(z.object({ notes: z.array(note).nonempty().max(5000), controls: z.array(control).nonempty().max(5000) })).nonempty().max(16),
});

export const previewAudioSchema = z.object({
  schemaVersion: z.literal(1), status: z.literal('bounded-prototype'), music: song, soundEffect: song,
  voices: z.record(voiceId, voice), limitations: z.array(z.string().min(1)).nonempty(),
}).superRefine((audio, context) => {
  const error = (message: string) => context.addIssue({ code: 'custom', message });
  if (audio.music.id !== 'MUS_PALLET' || audio.music.loopStart !== 0 || audio.music.loopEnd !== audio.music.duration
    || audio.soundEffect.id !== 'SE_SELECT' || audio.soundEffect.loopStart !== null || audio.soundEffect.loopEnd !== null) error('Unsupported audio loop policy');
  for (const value of Object.values(audio.voices)) {
    if (value.kind === 'sample' && !(value.loopStart < value.loopEnd && value.loopEnd <= value.frames / value.sampleRate)) error('Invalid sample loop bounds');
    if (value.kind === 'square' && (value.envelope[0] > 7 || value.envelope[1] > 7 || value.envelope[2] > 15 || value.envelope[3] > 7)) error('Invalid PSG envelope');
  }
  for (const value of [audio.music, audio.soundEffect]) {
    for (const track of value.tracks) {
      if (track.controls[0]?.time !== 0) error('Missing initial audio control state');
      let lastNote = -1, lastControl = -1;
      for (const item of track.notes) {
        if (!(item.voice in audio.voices) || item.time < lastNote || item.time + item.duration > value.duration + 0.000001) error('Invalid audio note reference/time');
        lastNote = item.time;
      }
      for (const item of track.controls) {
        if (item.time < lastControl || item.time > value.duration) error('Invalid audio control time');
        lastControl = item.time;
      }
    }
  }
});

export type PreviewAudioContent = z.infer<typeof previewAudioSchema>;
