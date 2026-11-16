/*
 * WGSL compute shaders of the in-browser simulator's GPU engine (lib/sim/gpu.ts).
 *
 * The state is one storage buffer of vec2<f32> amplitudes (re, im), 8 bytes each, so 24 qubits is
 * 128 MiB: WebGPU's guaranteed maxStorageBufferBindingSize, which is why the GPU engine stops at 24.
 *
 * Each gate is one dispatch. Invocation i computes the amplitude index with zero bits inserted at
 * every qubit the gate touches (ascending) and the control bits set, exactly as baseIndex() in
 * statevector.ts; the CPU reference runs the same arithmetic, which is how the tests check this
 * logic on machines without a GPU. Gates are packed into one uniform buffer, 256 bytes per gate,
 * and selected with a dynamic offset, so a whole batch of gates is one compute pass.
 *
 * Precision: float32 (24-bit mantissa, about 6e-8 relative per rounding). Each gate adds a few
 * roundings per amplitude, so after G gates probabilities typically drift by ~1e-7 * sqrt(G) and
 * stay well inside 1e-5 for circuits of a few thousand gates. The page shows the measured drift
 * (1 - the sum of all probabilities) with every GPU result.
 */

/** Bytes per gate in the uniform buffer: the dynamic-offset alignment WebGPU guarantees. */
export const SLOT = 256;

const PARAMS = /* wgsl */ `
struct Params {
  // count: invocations; stride: invocations per row of workgroups; npos: qubits touched; cmask: controls
  head: vec4<u32>,
  // the touched qubits, ascending (first npos used)
  pos: vec4<u32>,
  // the target qubit(s): x = target (1-qubit) or first target, y = second target
  tgt: vec4<u32>,
  // the gate matrix, row-major complex numbers, two per vec4 (2x2 uses m[0], m[1])
  m: array<vec4<f32>, 8>,
};

@group(0) @binding(0) var<storage, read_write> s: array<vec2<f32>>;
@group(0) @binding(1) var<uniform> P: Params;

fn cmul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

fn mel(j: u32) -> vec2<f32> {
  let v = P.m[j >> 1u];
  if ((j & 1u) == 0u) { return v.xy; }
  return v.zw;
}

fn base_index(i: u32) -> u32 {
  var x = i;
  for (var k = 0u; k < P.head.z; k = k + 1u) {
    let q = P.pos[k];
    let low = x & ((1u << q) - 1u);
    x = ((x >> q) << (q + 1u)) | low;
  }
  return x | P.head.w;
}
`;

export const APPLY1 = /* wgsl */ `${PARAMS}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x + g.y * P.head.y;
  if (i >= P.head.x) { return; }
  let i0 = base_index(i);
  let i1 = i0 | (1u << P.tgt.x);
  let x = s[i0];
  let y = s[i1];
  s[i0] = cmul(mel(0u), x) + cmul(mel(1u), y);
  s[i1] = cmul(mel(2u), x) + cmul(mel(3u), y);
}
`;

export const APPLY2 = /* wgsl */ `${PARAMS}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x + g.y * P.head.y;
  if (i >= P.head.x) { return; }
  let b0 = base_index(i);
  let ba = 1u << P.tgt.x;
  let bb = 1u << P.tgt.y;
  var idx = array<u32, 4>(b0, b0 | ba, b0 | bb, b0 | ba | bb);
  var v = array<vec2<f32>, 4>(s[idx[0]], s[idx[1]], s[idx[2]], s[idx[3]]);
  for (var r = 0u; r < 4u; r = r + 1u) {
    var o = vec2<f32>(0.0, 0.0);
    for (var c = 0u; c < 4u; c = c + 1u) {
      o = o + cmul(mel(r * 4u + c), v[c]);
    }
    s[idx[r]] = o;
  }
}
`;

/** |amplitude|^2 into a float32 buffer the page reads back. */
export const PROBS = /* wgsl */ `
@group(0) @binding(0) var<storage, read> s: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
@group(0) @binding(2) var<uniform> head: vec4<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x + g.y * head.y;
  if (i >= head.x) { return; }
  let a = s[i];
  out[i] = dot(a, a);
}
`;

/** Workgroups for `count` invocations of 256: rows of at most 65,535 groups. */
export function grid(count: number): { x: number; y: number; stride: number } {
  const groups = Math.max(1, Math.ceil(count / 256));
  const x = Math.min(groups, 65535);
  return { x, y: Math.ceil(groups / x), stride: x * 256 };
}
