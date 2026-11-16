/*
 * The state-vector arithmetic of the in-browser simulator (/try), on the CPU.
 *
 * apply1/apply2 are line-for-line the same index arithmetic as the WGSL kernels in shaders.ts: one
 * loop iteration here is one GPU invocation there. The CPU engine runs them on a Float64Array; the
 * tests also run them on a Float32Array, which stores every amplitude in the GPU's float32 format,
 * to check the GPU path's logic and precision where no GPU is available (see scripts/test-sim.mjs).
 *
 * The state is interleaved [re0, im0, re1, im1, ...]; amplitude index bit q is qubit q.
 */

import type { Circuit, Op } from "./qasm";

export type State = Float64Array | Float32Array;

/** Invocation i -> the index with zero bits inserted at `pos` (ascending) and the controls set. */
export function baseIndex(i: number, pos: number[], cmask: number): number {
  let x = i;
  for (const q of pos) {
    const low = x & ((1 << q) - 1);
    x = ((x >>> q) << (q + 1)) | low;
  }
  return x | cmask;
}

export function apply1(s: State, nQubits: number, op: Extract<Op, { k: 1 }>): void {
  const count = 1 << (nQubits - op.pos.length);
  const m = op.m;
  const tb = 1 << op.t;
  for (let i = 0; i < count; i++) {
    const i0 = baseIndex(i, op.pos, op.cmask);
    const i1 = i0 | tb;
    const xr = s[2 * i0], xi = s[2 * i0 + 1], yr = s[2 * i1], yi = s[2 * i1 + 1];
    s[2 * i0] = m[0] * xr - m[1] * xi + m[2] * yr - m[3] * yi;
    s[2 * i0 + 1] = m[0] * xi + m[1] * xr + m[2] * yi + m[3] * yr;
    s[2 * i1] = m[4] * xr - m[5] * xi + m[6] * yr - m[7] * yi;
    s[2 * i1 + 1] = m[4] * xi + m[5] * xr + m[6] * yi + m[7] * yr;
  }
}

export function apply2(s: State, nQubits: number, op: Extract<Op, { k: 2 }>): void {
  const count = 1 << (nQubits - op.pos.length);
  const m = op.m;
  const ab = 1 << op.a, bb = 1 << op.b;
  const idx = [0, 0, 0, 0];
  const vr = [0, 0, 0, 0], vi = [0, 0, 0, 0];
  for (let i = 0; i < count; i++) {
    const base = baseIndex(i, op.pos, op.cmask);
    idx[0] = base; idx[1] = base | ab; idx[2] = base | bb; idx[3] = base | ab | bb;
    for (let c = 0; c < 4; c++) { vr[c] = s[2 * idx[c]]; vi[c] = s[2 * idx[c] + 1]; }
    for (let r = 0; r < 4; r++) {
      let or = 0, oi = 0;
      for (let c = 0; c < 4; c++) {
        const mr = m[(r * 4 + c) * 2], mi = m[(r * 4 + c) * 2 + 1];
        or += mr * vr[c] - mi * vi[c];
        oi += mr * vi[c] + mi * vr[c];
      }
      s[2 * idx[r]] = or; s[2 * idx[r] + 1] = oi;
    }
  }
}

/** Run every gate on |0...0>. `f32` stores amplitudes as float32, like the GPU. */
export function simulate(c: Circuit, opts: { f32?: boolean; onProgress?: (done: number) => void } = {}): State {
  const s: State = opts.f32 ? new Float32Array(2 << c.nQubits) : new Float64Array(2 << c.nQubits);
  s[0] = 1;
  c.ops.forEach((op, i) => {
    if (op.k === 1) apply1(s, c.nQubits, op); else apply2(s, c.nQubits, op);
    if (opts.onProgress && (i & 63) === 63) opts.onProgress(i + 1);
  });
  return s;
}

export function probabilities(s: State): Float64Array {
  const n = s.length >> 1;
  const p = new Float64Array(n);
  for (let i = 0; i < n; i++) p[i] = s[2 * i] * s[2 * i] + s[2 * i + 1] * s[2 * i + 1];
  return p;
}

/**
 * Probabilities of the classical outcomes: amplitude index -> classical bits through measure[].
 * When every qubit is read into the bit of the same number the array is returned as it is.
 */
export function outcomeDistribution(probs: Float64Array | Float32Array, nQubits: number, measure: number[]): Float64Array | Float32Array {
  const identity = measure.length === nQubits && measure.every((q, c) => q === c);
  if (identity) return probs;
  // One lookup table per byte of the amplitude index: the classical bits that byte sets.
  const tables: Uint32Array[] = [];
  for (let b = 0; b * 8 < nQubits; b++) {
    const t = new Uint32Array(256);
    for (let v = 0; v < 256; v++) {
      let key = 0;
      measure.forEach((q, c) => { if (q >= 0 && q >> 3 === b && (v >> (q & 7)) & 1) key |= 1 << c; });
      t[v] = key >>> 0;
    }
    tables.push(t);
  }
  const out = new Float64Array(1 << measure.length);
  const n = 1 << nQubits;
  for (let i = 0; i < n; i++) {
    const pi = probs[i];
    if (pi === 0) continue;
    let key = 0;
    for (let b = 0; b < tables.length; b++) key |= tables[b][(i >>> (8 * b)) & 255];
    out[key] += pi;
  }
  return out;
}

/** A small seeded generator (sfc32, seeded through splitmix32), uniform in [0, 1). */
export function rng(seed: number): () => number {
  let z = seed >>> 0;
  const mix = () => {
    z = (z + 0x9e3779b9) >>> 0;
    let t = z;
    t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
    t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
    return (t ^ (t >>> 16)) >>> 0;
  };
  let a = mix(), b = mix(), c = mix(), d = mix();
  return () => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
}

export const SHOT_LIMIT = 1_000_000;
export const TOP = 256;
/** Below this an outcome counts as impossible (float32 cancellation leaves ~1e-14). */
export const ZERO = 1e-10;

export type Summary = {
  /** The most likely outcomes, most likely first: [outcome index, probability]. */
  top: [number, number][];
  /** Sampled shots per outcome, most frequent first. */
  counts: [number, number][];
  /** Outcomes with probability above ZERO. */
  possible: number;
  /** Sum of all probabilities before normalising: 1 minus this is the rounding drift. */
  norm: number;
  shots: number;
  seed: number;
};

/**
 * Exact top outcomes and `shots` samples from the outcome distribution. Shots are drawn by sorting
 * that many uniform numbers and walking the cumulative sum once, so no second array is needed.
 */
export function summarize(dist: Float64Array | Float32Array, shots: number, seed: number): Summary {
  let norm = 0, possible = 0;
  // The TOP most likely outcomes, kept in a min-heap (the least likely of them at the root).
  const hp = new Float64Array(TOP), hi = new Int32Array(TOP);
  let size = 0;
  const less = (a: number, b: number) => hp[a] < hp[b] || (hp[a] === hp[b] && hi[a] > hi[b]);
  const swap = (a: number, b: number) => {
    const p = hp[a]; hp[a] = hp[b]; hp[b] = p;
    const q = hi[a]; hi[a] = hi[b]; hi[b] = q;
  };
  const down = (j: number) => {
    for (;;) {
      const l = 2 * j + 1, r = l + 1;
      let m = j;
      if (l < size && less(l, m)) m = l;
      if (r < size && less(r, m)) m = r;
      if (m === j) return;
      swap(j, m); j = m;
    }
  };
  for (let i = 0; i < dist.length; i++) {
    const v = dist[i];
    norm += v;
    if (v <= ZERO) continue;
    possible++;
    if (size < TOP) {
      hp[size] = v; hi[size] = i;
      let j = size++;
      while (j > 0) { const parent = (j - 1) >> 1; if (!less(j, parent)) break; swap(j, parent); j = parent; }
    } else if (v > hp[0]) {
      hp[0] = v; hi[0] = i; down(0);
    }
  }
  const order = Array.from({ length: size }, (_, j) => j).sort((a, b) => hp[b] - hp[a] || hi[a] - hi[b]);
  const topI = order.map((j) => hi[j]), topP = order.map((j) => hp[j]);
  const draw = rng(seed);
  const u = new Float64Array(shots);
  for (let k = 0; k < shots; k++) u[k] = draw() * norm;
  u.sort();
  const counts = new Map<number, number>();
  let acc = 0, k = 0;
  for (let i = 0; i < dist.length && k < shots; i++) {
    const v = dist[i];
    if (v <= 0) continue;
    acc += v;
    let n = 0;
    while (k < shots && u[k] < acc) { k++; n++; }
    if (n) counts.set(i, n);
  }
  if (k < shots) {
    // Rounding at the very end of the sum: the rest go to the last possible outcome.
    let last = dist.length - 1;
    while (last > 0 && dist[last] <= 0) last--;
    counts.set(last, (counts.get(last) ?? 0) + shots - k);
  }
  return {
    top: topI.map((i, j) => [i, topP[j] / norm]),
    counts: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]),
    possible, norm, shots, seed,
  };
}

/** Outcome index -> bitstring, classical bit 0 on the right. */
export const bits = (i: number, width: number) => i.toString(2).padStart(width, "0");
