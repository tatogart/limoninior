// A stable pentatonic signature. No random source or uploaded audio is involved.
const SCALE = [60, 62, 64, 67, 69, 72, 74, 76, 79];
export function melodyNotes(text) {
  let seed = 2166136261;
  for (const char of String(text).normalize('NFC').trim()) {
    seed = Math.imul(seed ^ char.codePointAt(0), 16777619) >>> 0;
  }
  return Array.from({ length: 12 }, () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0;
    const midi = SCALE[seed % SCALE.length];
    return { frequency: 440 * 2 ** ((midi - 69) / 12), duration: seed % 3 === 0 ? 0.3 : 0.2, height: 18 + (midi - 60) * 2 };
  });
}
