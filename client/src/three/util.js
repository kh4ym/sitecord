// util.js - small helpers shared by the 3D model builders and renderers.
//
// What it does: provides three tiny pure functions plus one cleanup helper:
//   - rng(seed): a seeded pseudo-random number generator, so "random" details
//     (neighbour houses, tree positions, worker poses) come out the same on
//     every page load instead of jumping around.
//   - clamp01(v): squeezes a number into the range 0..1.
//   - smooth(a, b, v): an S-shaped ease between two thresholds, used to grow
//     parts of the house in and out smoothly as the build progresses.
//   - disposeAll(materials): frees GPU memory held by a set of three.js materials.
// Where it's used: houseModel.js, neighborhoodModel.js, HouseScene.jsx,
// Neighborhood.jsx, Workers.jsx and SnapshotRenderer.jsx import from here.
// Dependencies: none (plain JavaScript, no imports).

/** Deterministic pseudo-random numbers in [0, 1) from a seed (mulberry32). */
// `export function` declares a named function and makes it importable from other files
// with `import { rng } from './util.js'`. It returns another function (a "generator" of numbers).
export function rng(seed) {
  // `>>> 0` is the unsigned right shift by zero bits: it forces the number into a
  // 32-bit unsigned integer (0 .. 4294967295). `let` declares a variable that can change.
  let a = seed >>> 0
  // Return an arrow function `() => { ... }`. It "closes over" `a` (a closure): every call
  // remembers and updates the same `a`, so each call gives the next number in the sequence.
  return () => {
    // Add a fixed odd constant (hex literal 0x6d2b79f5) and wrap back to 32 bits.
    a = (a + 0x6d2b79f5) >>> 0
    // Copy the state into a scratch variable `t` that gets scrambled below.
    let t = a
    // `^` is bitwise XOR, `|` is bitwise OR, `>>>` shifts bits right filling with zeros.
    // Math.imul multiplies two numbers as 32-bit integers (like C), which keeps the bits mixing correctly.
    t = Math.imul(t ^ (t >>> 15), t | 1)
    // `^=` means t = t ^ (...): more bit mixing so nearby seeds give unrelated outputs.
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    // Final mix, make it unsigned, then divide by 2^32 (4294967296) to get a decimal in [0, 1).
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// `export const` exports a constant; here it holds an arrow function taking `v`.
// Math.max(0, v) stops it going below 0, Math.min(1, ...) stops it going above 1.
export const clamp01 = (v) => Math.min(1, Math.max(0, v))

/** Smoothstep of `v` between `a` and `b`. */
// Returns 0 when v <= a, 1 when v >= b, and a smooth S-curve in between.
export const smooth = (a, b, v) => {
  // How far v is between a and b, as a fraction, clamped into 0..1.
  const t = clamp01((v - a) / (b - a))
  // The classic smoothstep polynomial 3t^2 - 2t^3: starts and ends gently (zero slope).
  return t * t * (3 - 2 * t)
}

/** Release the GPU side of every material in a map (shared geometries are kept). */
// Object.values(obj) gives an array of the object's values; .forEach runs the callback on each.
// `m.dispose?.()` is optional chaining: call dispose() only if the material has that method.
export const disposeAll = (materials) => Object.values(materials).forEach((m) => m.dispose?.())
