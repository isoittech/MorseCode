import { describe, expect, it } from 'vitest';
import { ALPHABET, codeFor, decode, dotMs, scheduleSignal, symbolFor } from './morse';

describe('international Morse timing', () => {
  it('uses the PARIS 50-unit speed convention', () => {
    expect(dotMs(20)).toBe(60);
    expect(dotMs(12)).toBe(100);
  });
  it('decodes every supported character from actual key durations', () => {
    for (const [character, code] of Object.entries(ALPHABET)) {
      const durations = [...code].map((c) => (c === '.' ? 95 : 310));
      expect(decode(codeFor(durations, 12))).toBe(character);
    }
  });
  it('classifies the boundary and does not guess unrecognized signals', () => {
    expect(symbolFor(199, 12)).toBe('.');
    expect(symbolFor(200, 12)).toBe('-');
    expect(decode('......')).toBe('�');
  });
  it('plays one-unit element gaps and three-unit character gaps', () => {
    const { tones, duration } = scheduleSignal(['.-', '-'], 12);
    expect(tones).toHaveLength(3);
    expect(tones[0].start).toBe(0);
    expect(tones[0].duration).toBeCloseTo(0.1);
    expect(tones[1].start).toBeCloseTo(0.2);
    expect(tones[1].duration).toBeCloseTo(0.3);
    expect(tones[2].start).toBeCloseTo(0.8);
    expect(duration).toBeCloseTo(1.1);
  });
});
