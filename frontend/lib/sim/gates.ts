/*
 * The gate matrices of the in-browser simulator (/try), exactly as Qiskit defines them, global phase
 * included (it matters once a gate is controlled). Complex numbers are flat [re, im] pairs, row-major.
 * A 1-qubit matrix is 8 numbers (m00 m01 m10 m11); a 2-qubit matrix is 32, with the basis index
 * bit(first qubit) + 2 * bit(second qubit), which is Qiskit's little-endian order.
 */

export type M2 = number[];
export type M4 = number[];

const S = Math.SQRT1_2;

/** e^{i x} as [re, im]. */
const cis = (x: number): [number, number] => [Math.cos(x), Math.sin(x)];

export function U(theta: number, phi: number, lam: number, gamma = 0): M2 {
  const c = Math.cos(theta / 2), s = Math.sin(theta / 2);
  const [gr, gi] = cis(gamma);
  const [lr, li] = cis(lam + gamma);
  const [pr, pi] = cis(phi + gamma);
  const [qr, qi] = cis(phi + lam + gamma);
  return [c * gr, c * gi, -s * lr, -s * li, s * pr, s * pi, c * qr, c * qi];
}

const diag = (a: [number, number], b: [number, number]): M2 => [a[0], a[1], 0, 0, 0, 0, b[0], b[1]];

export const ID: M2 = [1, 0, 0, 0, 0, 0, 1, 0];
export const X: M2 = [0, 0, 1, 0, 1, 0, 0, 0];
export const Y: M2 = [0, 0, 0, -1, 0, 1, 0, 0];
export const Z: M2 = [1, 0, 0, 0, 0, 0, -1, 0];
export const H: M2 = [S, 0, S, 0, S, 0, -S, 0];
export const SX: M2 = [0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5];
export const SXDG: M2 = [0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5];
export const phase = (lam: number): M2 => diag([1, 0], cis(lam));
export const rx = (t: number): M2 => [Math.cos(t / 2), 0, 0, -Math.sin(t / 2), 0, -Math.sin(t / 2), Math.cos(t / 2), 0];
export const ry = (t: number): M2 => [Math.cos(t / 2), 0, -Math.sin(t / 2), 0, Math.sin(t / 2), 0, Math.cos(t / 2), 0];
export const rz = (t: number): M2 => diag(cis(-t / 2), cis(t / 2));

export const SWAP: M4 = (() => {
  const m = new Array(32).fill(0);
  for (const [r, c] of [[0, 0], [1, 2], [2, 1], [3, 3]]) m[(r * 4 + c) * 2] = 1;
  return m;
})();

/** exp(-i t/2 Z⊗Z): a phase by parity. */
export function rzz(t: number): M4 {
  const m = new Array(32).fill(0);
  const even = cis(-t / 2), odd = cis(t / 2);
  [even, odd, odd, even].forEach((v, k) => { m[(k * 4 + k) * 2] = v[0]; m[(k * 4 + k) * 2 + 1] = v[1]; });
  return m;
}

/** exp(-i t/2 X⊗X) = cos(t/2) I - i sin(t/2) X⊗X. */
export function rxx(t: number): M4 {
  const m = new Array(32).fill(0);
  const c = Math.cos(t / 2), s = Math.sin(t / 2);
  for (let k = 0; k < 4; k++) {
    m[(k * 4 + k) * 2] = c;
    m[(k * 4 + (3 - k)) * 2 + 1] = -s;
  }
  return m;
}

/** How a gate name maps onto the simulator's two kernels. */
export type GateDef = {
  params: number;
  qubits: number;
  /** Leading operands that are controls. */
  controls: number;
  /** The matrix on the remaining (target) operands: 2x2 for one target, 4x4 for two. */
  matrix: (p: number[]) => M2 | M4;
};

const g = (params: number, qubits: number, controls: number, matrix: (p: number[]) => M2 | M4): GateDef => ({ params, qubits, controls, matrix });
const k = (m: M2 | M4) => () => m;

/** Gates every OpenQASM version has without an include. */
const BUILTIN_2: Record<string, GateDef> = {
  U: g(3, 1, 0, (p) => U(p[0], p[1], p[2])),
  CX: g(0, 2, 1, k(X)),
};
const BUILTIN_3: Record<string, GateDef> = {
  U: g(3, 1, 0, (p) => U(p[0], p[1], p[2])),
};

/** The parts of qelib1.inc (Qiskit's version) this simulator runs. */
const QELIB1: Record<string, GateDef> = {
  u3: g(3, 1, 0, (p) => U(p[0], p[1], p[2])),
  u: g(3, 1, 0, (p) => U(p[0], p[1], p[2])),
  u2: g(2, 1, 0, (p) => U(Math.PI / 2, p[0], p[1])),
  u1: g(1, 1, 0, (p) => phase(p[0])),
  p: g(1, 1, 0, (p) => phase(p[0])),
  id: g(0, 1, 0, k(ID)),
  x: g(0, 1, 0, k(X)),
  y: g(0, 1, 0, k(Y)),
  z: g(0, 1, 0, k(Z)),
  h: g(0, 1, 0, k(H)),
  s: g(0, 1, 0, () => phase(Math.PI / 2)),
  sdg: g(0, 1, 0, () => phase(-Math.PI / 2)),
  t: g(0, 1, 0, () => phase(Math.PI / 4)),
  tdg: g(0, 1, 0, () => phase(-Math.PI / 4)),
  sx: g(0, 1, 0, k(SX)),
  sxdg: g(0, 1, 0, k(SXDG)),
  rx: g(1, 1, 0, (p) => rx(p[0])),
  ry: g(1, 1, 0, (p) => ry(p[0])),
  rz: g(1, 1, 0, (p) => rz(p[0])),
  cx: g(0, 2, 1, k(X)),
  cy: g(0, 2, 1, k(Y)),
  cz: g(0, 2, 1, k(Z)),
  ch: g(0, 2, 1, k(H)),
  csx: g(0, 2, 1, k(SX)),
  cp: g(1, 2, 1, (p) => phase(p[0])),
  cu1: g(1, 2, 1, (p) => phase(p[0])),
  crx: g(1, 2, 1, (p) => rx(p[0])),
  cry: g(1, 2, 1, (p) => ry(p[0])),
  crz: g(1, 2, 1, (p) => rz(p[0])),
  cu3: g(3, 2, 1, (p) => U(p[0], p[1], p[2])),
  cu: g(4, 2, 1, (p) => U(p[0], p[1], p[2], p[3])),
  swap: g(0, 2, 0, k(SWAP)),
  rzz: g(1, 2, 0, (p) => rzz(p[0])),
  rxx: g(1, 2, 0, (p) => rxx(p[0])),
  ccx: g(0, 3, 2, k(X)),
  cswap: g(0, 3, 1, k(SWAP)),
};

/** The parts of OpenQASM 3's stdgates.inc this simulator runs. */
const STDGATES: Record<string, GateDef> = {
  p: QELIB1.p, phase: QELIB1.p, x: QELIB1.x, y: QELIB1.y, z: QELIB1.z, h: QELIB1.h,
  s: QELIB1.s, sdg: QELIB1.sdg, t: QELIB1.t, tdg: QELIB1.tdg, sx: QELIB1.sx,
  rx: QELIB1.rx, ry: QELIB1.ry, rz: QELIB1.rz,
  cx: QELIB1.cx, CX: QELIB1.cx, cy: QELIB1.cy, cz: QELIB1.cz, cp: QELIB1.cp, cphase: QELIB1.cp,
  crx: QELIB1.crx, cry: QELIB1.cry, crz: QELIB1.crz, ch: QELIB1.ch, cu: QELIB1.cu,
  swap: QELIB1.swap, ccx: QELIB1.ccx, cswap: QELIB1.cswap,
  id: QELIB1.id, u1: QELIB1.u1, u2: QELIB1.u2, u3: QELIB1.u3,
};

export function gateTable(version: 2 | 3, included: boolean): Record<string, GateDef> {
  if (version === 2) return included ? { ...QELIB1, ...BUILTIN_2 } : BUILTIN_2;
  return included ? { ...STDGATES, ...BUILTIN_3 } : BUILTIN_3;
}

/** The names a version's include provides, for messages. */
export function libraryNames(version: 2 | 3): string[] {
  return Object.keys(version === 2 ? QELIB1 : STDGATES);
}
