import { previewAudioSchema, type PreviewAudioContent } from '@pokewaterblue/content-schema';

export interface AudioState { enabled: boolean; ready: boolean; paused: boolean; error: string | null }
type Song = PreviewAudioContent['music'];
type Track = Song['tracks'][number];
type Note = Track['notes'][number];
type Voice = PreviewAudioContent['voices'][string];
interface PlayingNode { source: AudioScheduledSourceNode; gain: GainNode; pan: StereoPannerNode; effect: boolean }

// A deliberately bounded source-sample/pulse renderer, not a GBA sound driver.
// Scheduling uses the audio clock. Only one short lookahead timer exists, and
// stopping cancels even nodes scheduled to start after the current instant.
export class PreviewAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private content?: PreviewAudioContent;
  private loading?: Promise<void>;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly pulses = new Map<number, PeriodicWave>();
  private readonly playing = new Set<PlayingNode>();
  private enabled = false;
  private focused = document.hasFocus();
  private destroyed = false;
  private volume = 0.35;
  private music: string | null = null;
  private error: string | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private lifecycle = Promise.resolve();

  constructor(private readonly url: string, private readonly onState: (state: AudioState) => void) {
    window.addEventListener('blur', this.blur);
    window.addEventListener('focus', this.focus);
    document.addEventListener('visibilitychange', this.visibility);
    this.emit();
  }

  private emit(): void {
    this.onState({ enabled: this.enabled, ready: !!this.content,
      paused: this.enabled && (!this.focused || document.hidden), error: this.error });
  }

  private wanted(): boolean { return this.enabled && !this.destroyed && this.focused && !document.hidden; }

  async setEnabled(enabled: boolean): Promise<void> {
    if (this.destroyed || (enabled === this.enabled && !this.error)) return;
    this.enabled = enabled;
    this.error = null;
    const generation = ++this.generation;
    this.stop();
    this.emit();
    if (!enabled) { await this.syncLifecycle(); return; }
    // Create/resume synchronously from the explicit button gesture, before any
    // network await. Data loading never causes autoplay on its own.
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.volume * 0.3;
        this.master.connect(this.context.destination);
      }
      await this.context.resume();
      if (!this.loading) this.loading = this.load().catch(error => { this.loading = undefined; throw error; });
      await this.loading;
      if (generation !== this.generation || this.destroyed) return;
      await this.syncLifecycle();
      this.emit();
    } catch (error) {
      if (generation !== this.generation || this.destroyed) return;
      this.enabled = false;
      this.error = `Audio unavailable. Run npm.cmd run content:build, then retry Sound. ${error instanceof Error ? error.message : String(error)}`;
      this.stop();
      await this.syncLifecycle();
      this.emit();
    }
  }

  setVolume(value: number): void {
    if (!Number.isFinite(value)) return;
    this.volume = Math.min(1, Math.max(0, value));
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume * 0.3, this.context.currentTime, 0.015);
  }

  setMusic(id: string | null): void {
    if (this.music === id) return;
    this.music = id;
    this.stop();
    this.startMusic();
  }

  playSelect(): void {
    if (!this.wanted() || !this.content || this.context?.state !== 'running') return;
    // The source uses a single select-effect slot. Rapid page changes replace
    // its previous notes instead of accumulating overlapping effects.
    for (const node of this.playing) if (node.effect) this.stopNode(node);
    const start = this.context.currentTime + 0.01;
    for (const track of this.content.soundEffect.tracks) {
      for (const note of track.notes) this.schedule(note, track, start + note.time, true);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.enabled = false;
    this.generation++;
    this.stop();
    window.removeEventListener('blur', this.blur);
    window.removeEventListener('focus', this.focus);
    document.removeEventListener('visibilitychange', this.visibility);
    void this.context?.close();
    this.buffers.clear();
    this.pulses.clear();
  }

  private readonly blur = (): void => { this.focused = false; this.stop(); void this.syncLifecycle(); this.emit(); };
  private readonly focus = (): void => { this.focused = true; void this.syncLifecycle(); this.emit(); };
  private readonly visibility = (): void => { if (document.hidden) this.stop(); void this.syncLifecycle(); this.emit(); };

  private syncLifecycle(): Promise<void> {
    this.lifecycle = this.lifecycle.then(async () => {
      const context = this.context;
      if (!context || this.destroyed || context.state === 'closed') return;
      if (!this.wanted()) { this.stop(); await context.suspend(); }
      else {
        await context.resume();
        if (this.wanted()) this.startMusic();
        else { this.stop(); await context.suspend(); }
      }
    }).catch(error => {
      if (this.destroyed) return;
      this.enabled = false;
      this.error = `Audio unavailable. Retry Sound. ${String(error)}`;
      this.stop();
      this.emit();
    });
    return this.lifecycle;
  }

  private async load(): Promise<void> {
    const response = await fetch(this.url);
    if (!response.ok) throw new Error('Missing source audio content.');
    const content = previewAudioSchema.parse(await response.json());
    const urls = [...new Set(Object.values(content.voices).filter(voice => voice.kind === 'sample').map(voice => voice.url))];
    const buffers = await Promise.all(urls.map(async url => {
      const sample = await fetch(url);
      if (!sample.ok) throw new Error('Missing source instrument sample.');
      const buffer = await this.context!.decodeAudioData(await sample.arrayBuffer());
      if (buffer.numberOfChannels !== 1 || buffer.duration <= 0) throw new Error('Invalid source instrument sample.');
      return [url, buffer] as const;
    }));
    if (this.destroyed) return;
    for (const [url, buffer] of buffers) this.buffers.set(url, buffer);
    this.content = content;
  }

  private stop(): void {
    if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined; }
    for (const node of this.playing) this.stopNode(node);
  }

  private stopNode(node: PlayingNode): void {
    node.source.onended = null;
    try { node.source.stop(); } catch { /* A naturally ended source is already silent. */ }
    node.source.disconnect(); node.gain.disconnect(); node.pan.disconnect();
    this.playing.delete(node);
  }

  private startMusic(): void {
    if (this.timer !== undefined || !this.wanted() || !this.content || !this.context
      || this.context.state !== 'running' || this.music !== this.content.music.id) return;
    const song = this.content.music;
    const events = song.tracks.flatMap(track => track.notes.map(note => ({ track, note }))).sort((a, b) => a.note.time - b.note.time);
    let start = this.context.currentTime + 0.025, cursor = 0;
    const pump = (): void => {
      const context = this.context;
      if (!context || !this.wanted()) return;
      const horizon = context.currentTime + 0.2;
      // The next event advances exactly once; delayed browser frames skip stale
      // attacks, instead of emitting a burst of old notes or overlapping loops.
      while (start + events[cursor].note.time < horizon) {
        const { note, track } = events[cursor];
        const when = start + note.time;
        if (when >= context.currentTime - 0.02) this.schedule(note, track, Math.max(when, context.currentTime), false);
        cursor++;
        if (cursor === events.length) { cursor = 0; start += song.duration; }
      }
    };
    pump();
    this.timer = setInterval(pump, 80);
  }

  private pulse(duty: number): PeriodicWave {
    let wave = this.pulses.get(duty);
    if (!wave) {
      const real = new Float32Array(65), imaginary = new Float32Array(65);
      for (let harmonic = 1; harmonic < real.length; harmonic++) {
        real[harmonic] = 2 * Math.sin(2 * Math.PI * harmonic * duty) / (Math.PI * harmonic);
        imaginary[harmonic] = 2 * (1 - Math.cos(2 * Math.PI * harmonic * duty)) / (Math.PI * harmonic);
      }
      wave = this.context!.createPeriodicWave(real, imaginary);
      this.pulses.set(duty, wave);
    }
    return wave;
  }

  private schedule(note: Note, track: Track, when: number, effect: boolean): void {
    const context = this.context!, voice = this.content!.voices[note.voice];
    const gain = context.createGain(), pan = context.createStereoPanner();
    let source: AudioBufferSourceNode | OscillatorNode, pitch: AudioParam;
    if (voice.kind === 'sample') {
      const sample = context.createBufferSource();
      sample.buffer = this.buffers.get(voice.url)!;
      sample.loop = true; sample.loopStart = voice.loopStart; sample.loopEnd = voice.loopEnd;
      sample.playbackRate.value = (voice.sourceRate / voice.sampleRate) * 2 ** ((note.key - voice.rootKey) / 12);
      source = sample; pitch = sample.detune;
    } else {
      const oscillator = context.createOscillator();
      oscillator.setPeriodicWave(this.pulse(voice.duty));
      oscillator.frequency.value = 440 * 2 ** ((note.key - 69) / 12);
      source = oscillator; pitch = oscillator.detune;
    }
    const release = voice.kind === 'sample' ? Math.min(1.5, Math.log(0.002) / Math.log(Math.max(1, voice.envelope[3]) / 256) / 60) : voice.envelope[3] * 15 / 64;
    const total = note.duration + Math.max(0.015, release);
    const node = { source, gain, pan, effect };
    source.connect(gain); gain.connect(pan); pan.connect(this.master!);
    this.playing.add(node);
    source.onended = () => { this.playing.delete(node); source.disconnect(); gain.disconnect(); pan.disconnect(); };
    let controlIndex = 0;
    while (controlIndex + 1 < track.controls.length && track.controls[controlIndex + 1].time <= note.time) controlIndex++;
    let level = voice.kind === 'sample' ? 0 : voice.envelope[0] ? 0 : 1;
    let elapsed = 0;
    gain.gain.setValueAtTime(0, when);
    while (elapsed < total) {
      const dt = Math.min(1 / 60, total - elapsed);
      while (controlIndex + 1 < track.controls.length && track.controls[controlIndex + 1].time <= note.time + elapsed) controlIndex++;
      const control = track.controls[controlIndex];
      level = envelopeLevel(voice, level, elapsed, note.duration, dt);
      const at = when + elapsed;
      gain.gain.linearRampToValueAtTime(Math.max(0, level) * note.velocity / 127 * control.volume / 127 * (voice.kind === 'square' ? 0.35 : 1), at);
      pan.pan.setValueAtTime(control.pan / 64, at);
      const phase = ((note.time + elapsed) * control.lfoSpeed * 60 / 256) % 1;
      const triangle = 1 - 4 * Math.abs(phase - 0.5);
      let cents = control.bend * control.bendRange * 100 / 64 + triangle * control.modulation * 100 / 16;
      if (voice.kind === 'square' && voice.sweep) {
        const period = (voice.sweep >> 4) & 7, shift = voice.sweep & 7;
        if (period && shift) {
          let register = 2048 - 131072 / (440 * 2 ** ((note.key - 69) / 12));
          for (let step = 0; step < Math.floor(elapsed * 128 / period); step++) register += (voice.sweep & 8 ? -1 : 1) * Math.floor(register / 2 ** shift);
          if (register >= 2048) gain.gain.setValueAtTime(0, at);
          else cents += 1200 * Math.log2((131072 / (2048 - register)) / (440 * 2 ** ((note.key - 69) / 12)));
        }
      }
      pitch.setValueAtTime(cents, at);
      elapsed += dt;
    }
    gain.gain.linearRampToValueAtTime(0, when + total);
    source.start(when); source.stop(when + total + 0.005);
  }
}

function envelopeLevel(voice: Voice, level: number, elapsed: number, duration: number, dt: number): number {
  const [attack, decay, sustain, release] = voice.envelope;
  if (voice.kind === 'sample') {
    if (elapsed >= duration) return level * (release / 256) ** (dt * 60);
    const attackDuration = Math.ceil(255 / Math.max(1, attack)) / 60;
    if (elapsed < attackDuration) return Math.min(1, level + attack / 255 * dt * 60);
    return Math.max(sustain / 255, level * (decay / 256) ** (dt * 60));
  }
  if (elapsed >= duration) return Math.max(0, level - dt * 64 / Math.max(1, release * 15));
  const attackDuration = attack * 15 / 64;
  if (elapsed < attackDuration) return Math.min(1, level + dt / attackDuration);
  return Math.max(sustain / 15, level - dt * 64 / Math.max(1, decay * 15));
}
