import curriculum from '../../../shared/curriculum.json';

export const ALPHABET: Record<string, string> = curriculum.alphabet;
export const LEVELS = curriculum.levels;
const reverse = Object.fromEntries(Object.entries(ALPHABET).map(([key, value]) => [value, key]));
export const dotMs = (wpm: number) => 1200 / wpm;
export const symbolFor = (duration: number, wpm: number) => (duration < 2 * dotMs(wpm) ? '.' : '-');
export const codeFor = (durations: number[], wpm: number) =>
  durations.map((d) => symbolFor(d, wpm)).join('');
export const decode = (code: string) => reverse[code] ?? '�';
export const displayCode = (code: string) => code.replaceAll('.', '·').replaceAll('-', '−');

export type Tone = { start: number; duration: number };
export function scheduleSignal(signal: string[], wpm: number): { tones: Tone[]; duration: number } {
  const unit = dotMs(wpm) / 1000;
  const tones: Tone[] = [];
  let time = 0;
  signal.forEach((character, characterIndex) => {
    [...character].forEach((symbol, symbolIndex) => {
      const duration = (symbol === '.' ? 1 : 3) * unit;
      tones.push({ start: time, duration });
      time += duration;
      if (symbolIndex < character.length - 1) time += unit;
    });
    if (characterIndex < signal.length - 1) time += 3 * unit;
  });
  return { tones, duration: time };
}

export class MorseAudio {
  private context?: AudioContext;
  private keyGain?: GainNode;
  private keyOscillator?: OscillatorNode;
  private playback?: OscillatorNode;
  muted = false;
  frequency = 600;

  async unlock() {
    this.context ??= new AudioContext({ latencyHint: 'interactive' });
    await this.context.resume();
  }

  key(down: boolean) {
    const context = this.context;
    if (!context) return;
    if (!this.keyOscillator) {
      this.keyGain = context.createGain();
      this.keyGain.gain.value = 0;
      this.keyOscillator = context.createOscillator();
      this.keyOscillator.connect(this.keyGain).connect(context.destination);
      this.keyOscillator.start();
    }
    this.keyOscillator.frequency.setValueAtTime(this.frequency, context.currentTime);
    this.keyGain!.gain.setTargetAtTime(down && !this.muted ? 0.12 : 0, context.currentTime, 0.003);
  }

  async play(signal: string[], wpm: number, onEnd: () => void) {
    await this.unlock();
    this.stop();
    const context = this.context!;
    const { tones, duration } = scheduleSignal(signal, wpm);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = this.frequency;
    gain.gain.value = 0;
    oscillator.connect(gain).connect(context.destination);
    const origin = context.currentTime + 0.08;
    for (const tone of tones) {
      gain.gain.setValueAtTime(0, origin + tone.start);
      gain.gain.linearRampToValueAtTime(this.muted ? 0 : 0.12, origin + tone.start + 0.003);
      gain.gain.setValueAtTime(this.muted ? 0 : 0.12, origin + tone.start + tone.duration - 0.003);
      gain.gain.linearRampToValueAtTime(0, origin + tone.start + tone.duration);
    }
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      if (this.playback === oscillator) this.playback = undefined;
      onEnd();
    };
    oscillator.start(origin);
    oscillator.stop(origin + duration + 0.03);
    this.playback = oscillator;
  }

  stop() {
    if (this.playback) {
      this.playback.onended = null;
      this.playback.stop();
      this.playback.disconnect();
      this.playback = undefined;
    }
    this.key(false);
  }

  dispose() {
    this.stop();
    this.keyOscillator?.stop();
    void this.context?.close();
    this.context = undefined;
    this.keyOscillator = undefined;
  }
}
