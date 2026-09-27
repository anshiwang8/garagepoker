import type { RandomSource } from "../src/index.js";

/** Deterministic RandomSource (mulberry32) so statistical tests never flake. */
export function seededRandom(seed: number): RandomSource {
  let a = seed >>> 0;
  return (buf) => {
    for (let i = 0; i < buf.length; i++) {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      buf[i] = (t ^ (t >>> 14)) >>> 0;
    }
  };
}

/** The real CSPRNG, as the server will pass it in. */
export const cryptoRandom: RandomSource = (buf) => {
  (globalThis as unknown as { crypto: { getRandomValues(b: Uint32Array): void } }).crypto.getRandomValues(buf);
};
