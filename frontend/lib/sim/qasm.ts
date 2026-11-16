/*
 * A small, strict OpenQASM 2 / 3 reader for the in-browser simulator (/try).
 *
 * It takes unitary circuits with measurements at the end: registers, the standard gates of
 * qelib1.inc (version 2) or stdgates.inc (version 3), barrier and measure. Anything else (gate
 * definitions, if, reset, loops, modifiers, other includes) is refused with a message that names
 * the line, rather than guessed at. Qubits are numbered in declaration order and an outcome is read
 * with classical bit 0 on the right, the way Qiskit does both.
 */

import { type GateDef, gateTable, libraryNames } from "./gates";

export const LIMITS = { source: 200_000, qubits: 24, clbits: 24, operations: 20_000 };

/** One kernel call. `pos` are the qubits it touches (controls and targets), sorted ascending. */
export type Op =
  | { k: 1; t: number; cmask: number; pos: number[]; m: number[]; name: string }
  | { k: 2; a: number; b: number; cmask: number; pos: number[]; m: number[]; name: string };

export type Circuit = {
  version: 2 | 3;
  nQubits: number;
  nClbits: number;
  ops: Op[];
  /** measure[clbit] = the qubit read into it, or -1 when the bit is never written (it reads 0). */
  measure: number[];
  /** True when the circuit had no measurement and every qubit is read instead. */
  implicitMeasure: boolean;
  qregs: { name: string; size: number }[];
  cregs: { name: string; size: number }[];
  gateCounts: Record<string, number>;
  twoQubitGates: number;
};

export class QasmError extends Error {
  line: number;
  constructor(line: number, message: string) {
    super(line > 0 ? `Line ${line}: ${message}` : message);
    this.line = line;
  }
}

type Tok = { t: "id" | "num" | "str" | "sym"; v: string; line: number };

const SYMS = ["->", "**", "==", ";", ",", "(", ")", "[", "]", "{", "}", "+", "-", "*", "/", "^", "=", "@", ":", "<", ">", "!", "&", "|", "%", "~"];

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0, line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v" || c === "﻿") { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) throw new QasmError(line, "A /* comment is never closed.");
      for (let j = i; j < end; j++) if (src[j] === "\n") line++;
      i = end + 2; continue;
    }
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0 || src.slice(i, end).includes("\n")) throw new QasmError(line, "A quoted name is never closed.");
      out.push({ t: "str", v: src.slice(i + 1, end), line }); i = end + 1; continue;
    }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i, i + 64));
    if (num && /[\d.]/.test(c)) { out.push({ t: "num", v: num[0], line }); i += num[0].length; continue; }
    const id = /^[A-Za-z_πτℯ$][A-Za-z0-9_]*/.exec(src.slice(i, i + 256));
    if (id) { out.push({ t: "id", v: id[0], line }); i += id[0].length; continue; }
    const sym = SYMS.find((s) => src.startsWith(s, i));
    if (sym) { out.push({ t: "sym", v: sym, line }); i += sym.length; continue; }
    throw new QasmError(line, `Unexpected character "${c}".`);
  }
  return out;
}

const REFUSED: Record<string, string> = {
  gate: "Custom gate definitions aren't supported here; write the circuit with the standard gates.",
  opaque: "Opaque gates can't be simulated.",
  if: "Classically controlled gates (if) aren't supported: this simulator takes unitary circuits with measurements at the end.",
  reset: "reset isn't supported: this simulator takes unitary circuits with measurements at the end.",
  for: "Loops aren't supported here; write the gates out.",
  while: "Loops aren't supported here; write the gates out.",
  def: "Subroutines (def) aren't supported here.",
  defcal: "Pulse-level calibrations (defcal) aren't supported.",
  cal: "Pulse-level calibrations (cal) aren't supported.",
  defcalgrammar: "Pulse-level calibrations aren't supported.",
  let: "Aliases (let) aren't supported here; use the register names directly.",
  const: "Constants aren't supported here; write the numbers in the gate.",
  input: "Circuit inputs aren't supported here; write the numbers in the gate.",
  output: "Circuit outputs aren't supported here.",
  delay: "delay has no effect on an ideal simulator and isn't supported; remove it.",
  box: "box isn't supported here.",
  ctrl: "Gate modifiers (ctrl @) aren't supported; use cx, ccx, cp, crz and the other controlled gates.",
  negctrl: "Gate modifiers (negctrl @) aren't supported.",
  inv: "Gate modifiers (inv @) aren't supported; use the inverse gate (sdg, tdg, a negative angle).",
  pow: "Gate modifiers (pow @) aren't supported.",
  gphase: "gphase changes nothing measurable and isn't supported; remove it.",
  extern: "extern isn't supported.",
  switch: "switch isn't supported: this simulator takes unitary circuits with measurements at the end.",
  int: "Classical variables aren't supported here.",
  uint: "Classical variables aren't supported here.",
  float: "Classical variables aren't supported here.",
  angle: "Classical variables aren't supported here.",
  bool: "Classical variables aren't supported here.",
  complex: "Classical variables aren't supported here.",
  duration: "Classical variables aren't supported here.",
  stretch: "Classical variables aren't supported here.",
  array: "Classical variables aren't supported here.",
};

const FUNCS: Record<string, (x: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, ln: Math.log, sqrt: Math.sqrt,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
};

type Reg = { name: string; size: number; offset: number; quantum: boolean; line: number };

/** Read a circuit. Throws QasmError with a plain message when it can't be simulated here. */
export function parseQasm(src: string): Circuit {
  if (src.length > LIMITS.source) throw new QasmError(0, `The circuit is over ${LIMITS.source.toLocaleString("en-US")} characters; this page takes smaller ones.`);
  const toks = lex(src);
  let p = 0;
  const peek = (o = 0): Tok | undefined => toks[p + o];
  const lastLine = () => (toks[p] ?? toks[p - 1])?.line ?? 0;
  const fail = (msg: string, line = lastLine()): never => { throw new QasmError(line, msg); };
  const isSym = (v: string, o = 0) => peek(o)?.t === "sym" && peek(o)?.v === v;
  const eat = (v: string, what?: string) => {
    if (!isSym(v)) fail(`Expected "${v}"${what ? ` ${what}` : ""}${peek() ? `, found "${peek()!.v}"` : " at the end"}.`);
    p++;
  };
  const ident = (what: string): Tok => {
    const t = peek();
    if (!t || t.t !== "id") fail(`Expected ${what}${t ? `, found "${t.v}"` : " at the end"}.`);
    p++;
    return t!;
  };
  const integer = (what: string): number => {
    const t = peek();
    if (!t || t.t !== "num" || !/^\d+$/.test(t.v)) fail(`Expected ${what} (a whole number)${t ? `, found "${t.v}"` : ""}.`);
    p++;
    return Number(t!.v);
  };

  // Header.
  if (!peek() || peek()!.v !== "OPENQASM") fail("Start with a version line: OPENQASM 2.0; or OPENQASM 3.0;", 1);
  p++;
  const vt = peek();
  if (!vt || vt.t !== "num") fail("Expected a version number after OPENQASM.");
  p++;
  const version: 2 | 3 = /^2(\.0)?$/.test(vt!.v) ? 2 : /^3(\.0)?$/.test(vt!.v) ? 3 : fail(`OpenQASM ${vt!.v} isn't supported; use 2.0 or 3.0.`);
  eat(";", "after the version");

  let included = false;
  let table = gateTable(version, false);
  const regs = new Map<string, Reg>();
  const qregs: Reg[] = [], cregs: Reg[] = [];
  let nQ = 0, nC = 0;
  const ops: Op[] = [];
  const measured = new Map<number, number>(); // clbit -> qubit
  const measuredQubits = new Set<number>();
  const gateCounts: Record<string, number> = {};
  let twoQubit = 0;

  const declare = (name: string, size: number, quantum: boolean, line: number) => {
    if (regs.has(name)) fail(`"${name}" is declared twice.`, line);
    if (table[name] || REFUSED[name]) fail(`"${name}" is a reserved name; pick another register name.`, line);
    if (size < 1) fail(`Register "${name}" needs at least one bit.`, line);
    const r: Reg = { name, size, offset: quantum ? nQ : nC, quantum, line };
    if (quantum) {
      nQ += size;
      if (nQ > LIMITS.qubits) fail(`That makes ${nQ} qubits; this page simulates up to ${LIMITS.qubits} (each extra qubit doubles the memory).`, line);
      qregs.push(r);
    } else {
      nC += size;
      if (nC > LIMITS.clbits) fail(`That makes ${nC} classical bits; this page reads up to ${LIMITS.clbits}.`, line);
      cregs.push(r);
    }
    regs.set(name, r);
  };

  /** A register or one bit of it: the bit indices it stands for. */
  const operand = (quantum: boolean): number[] => {
    const t = ident(quantum ? "a qubit" : "a classical bit");
    const r = regs.get(t.v);
    if (!r) fail(`"${t.v}" isn't declared. Declare it first with ${version === 2 ? (quantum ? "qreg" : "creg") : (quantum ? "qubit[n]" : "bit[n]")}.`, t.line);
    if (r!.quantum !== quantum) fail(`"${t.v}" is a ${r!.quantum ? "quantum" : "classical"} register, not a ${quantum ? "quantum" : "classical"} one.`, t.line);
    if (isSym("[")) {
      p++;
      const i = integer("an index");
      if (isSym(":") || isSym(",")) fail("Register slices aren't supported; name the bits one at a time.");
      eat("]");
      if (i >= r!.size) fail(`${t.v}[${i}] is out of range: "${t.v}" has ${r!.size} bit${r!.size === 1 ? "" : "s"}.`, t.line);
      return [r!.offset + i];
    }
    return Array.from({ length: r!.size }, (_, i) => r!.offset + i);
  };

  // Angles: + - * / ^ ** and parentheses over numbers, pi/tau/euler and a few functions.
  const expr = (): number => additive();
  const additive = (): number => {
    let v = multiplicative();
    while (isSym("+") || isSym("-")) { const op = peek()!.v; p++; const r = multiplicative(); v = op === "+" ? v + r : v - r; }
    return v;
  };
  const multiplicative = (): number => {
    let v = unary();
    while (isSym("*") || isSym("/")) {
      const op = peek()!.v; p++;
      const r = unary();
      if (op === "/" && r === 0) fail("Division by zero in a gate angle.");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const unary = (): number => {
    if (isSym("-")) { p++; return -unary(); }
    if (isSym("+")) { p++; return unary(); }
    return power();
  };
  const power = (): number => {
    const base = atom();
    if (isSym("^") || isSym("**")) { p++; return base ** unary(); }
    return base;
  };
  const atom = (): number => {
    const t = peek();
    if (!t) return fail("A gate angle ends too early.");
    if (t.t === "num") { p++; return Number(t.v); }
    if (isSym("(")) { p++; const v = expr(); eat(")"); return v; }
    if (t.t === "id") {
      p++;
      if (t.v === "pi" || t.v === "π") return Math.PI;
      if (version === 3 && (t.v === "tau" || t.v === "τ")) return 2 * Math.PI;
      if (version === 3 && (t.v === "euler" || t.v === "ℯ")) return Math.E;
      const f = FUNCS[t.v];
      if (f) { eat("(", `after ${t.v}`); const v = expr(); eat(")"); return f(v); }
      return fail(`"${t.v}" isn't a number this reader knows (it reads pi${version === 3 ? ", tau, euler" : ""} and sin, cos, tan, exp, ln, sqrt).`, t.line);
    }
    return fail(`Unexpected "${t.v}" in a gate angle.`, t.line);
  };

  const push = (op: Op) => {
    if (ops.length >= LIMITS.operations) fail(`The circuit has more than ${LIMITS.operations.toLocaleString("en-US")} gate operations; this page takes smaller ones.`);
    ops.push(op);
  };

  const apply = (name: string, def: GateDef, params: number[], qs: number[], line: number) => {
    if (new Set(qs).size !== qs.length) fail(`${name} is given the same qubit twice.`, line);
    for (const q of qs) {
      if (measuredQubits.has(q)) fail(`A gate acts on qubit ${q} after it was measured. Mid-circuit measurement isn't supported: move the measurements to the end.`, line);
    }
    const controls = qs.slice(0, def.controls);
    const targets = qs.slice(def.controls);
    const cmask = controls.reduce((m, q) => m | (1 << q), 0);
    const pos = [...qs].sort((a, b) => a - b);
    const m = def.matrix(params);
    gateCounts[name] = (gateCounts[name] ?? 0) + 1;
    if (qs.length >= 2) twoQubit++;
    if (targets.length === 1) push({ k: 1, t: targets[0], cmask, pos, m, name });
    else push({ k: 2, a: targets[0], b: targets[1], cmask, pos, m, name });
  };

  const measure = (qs: number[], cs: number[], line: number) => {
    if (qs.length !== cs.length) fail(`measure needs as many classical bits as qubits (${qs.length} qubit${qs.length === 1 ? "" : "s"}, ${cs.length} bit${cs.length === 1 ? "" : "s"}).`, line);
    qs.forEach((q, i) => {
      const c = cs[i];
      if (measured.has(c)) fail(`Classical bit ${c} is measured into twice; each bit can be measured once.`, line);
      measured.set(c, q);
      measuredQubits.add(q);
    });
  };

  while (p < toks.length) {
    const t = peek()!;
    const line = t.line;
    if (t.t !== "id") fail(`Unexpected "${t.v}".`, line);
    const w = t.v;

    if (w === "OPENQASM") fail("The version line can only come first.", line);
    if (w === "include") {
      p++;
      const f = peek();
      if (!f || f.t !== "str") fail('Expected a file name in quotes after include.', line);
      p++;
      const want = version === 2 ? "qelib1.inc" : "stdgates.inc";
      if (f!.v !== want) fail(`Only include "${want}" is supported${version === 3 && f!.v === "qelib1.inc" ? ' (OpenQASM 3 uses "stdgates.inc")' : version === 2 && f!.v === "stdgates.inc" ? ' (OpenQASM 2 uses "qelib1.inc")' : ""}.`, line);
      eat(";");
      included = true;
      table = gateTable(version, true);
      continue;
    }
    if (REFUSED[w]) fail(REFUSED[w], line);
    if (w === "qreg" || w === "creg") {
      p++;
      const name = ident("a register name");
      eat("[");
      const size = integer("a register size");
      eat("]");
      eat(";");
      declare(name.v, size, w === "qreg", line);
      continue;
    }
    if (version === 3 && (w === "qubit" || w === "bit")) {
      p++;
      let size = 1;
      if (isSym("[")) { p++; size = integer("a register size"); eat("]"); }
      const name = ident("a register name");
      if (isSym("=")) fail("Initialising classical bits isn't supported here.", line);
      eat(";");
      declare(name.v, size, w === "qubit", line);
      continue;
    }
    if (w === "barrier") {
      p++;
      if (!isSym(";")) { operand(true); while (isSym(",")) { p++; operand(true); } }
      eat(";");
      continue;
    }
    if (w === "measure") {
      p++;
      const qs = operand(true);
      if (!isSym("->")) fail(version === 3 ? 'Write a measurement as "c = measure q;" or "measure q -> c;".' : 'Write a measurement as "measure q -> c;".', line);
      p++;
      const cs = operand(false);
      eat(";");
      measure(qs, cs, line);
      continue;
    }
    // OpenQASM 3 assignment form: c = measure q;  c[0] = measure q[0];
    if (version === 3 && regs.get(w) && !regs.get(w)!.quantum) {
      const cs = operand(false);
      if (!isSym("=")) fail(`Expected "= measure" after the classical bit.`, line);
      p++;
      if (peek()?.v !== "measure") fail("Only measurements can be assigned to classical bits here.", line);
      p++;
      const qs = operand(true);
      eat(";");
      measure(qs, cs, line);
      continue;
    }
    if (regs.has(w)) fail(`Expected a gate name, found the register "${w}".`, line);

    // A gate.
    p++;
    const def = table[w];
    if (!def) {
      if (!included && libraryNames(version).includes(w)) {
        fail(`"${w}" comes from ${version === 2 ? '"qelib1.inc"' : '"stdgates.inc"'}: add include "${version === 2 ? "qelib1.inc" : "stdgates.inc"}"; after the version line.`, line);
      }
      if (isSym("@")) fail(REFUSED.ctrl, line);
      fail(`"${w}" isn't a gate this simulator runs. It runs ${Object.keys(table).sort().join(", ")}.`, line);
    }
    const params: number[] = [];
    if (isSym("(")) {
      p++;
      if (!isSym(")")) {
        params.push(expr());
        while (isSym(",")) { p++; params.push(expr()); }
      }
      eat(")");
    }
    if (params.length !== def.params) fail(`${w} takes ${def.params} angle${def.params === 1 ? "" : "s"}, not ${params.length}.`, line);
    if (params.some((x) => !Number.isFinite(x))) fail(`An angle of ${w} isn't a finite number.`, line);
    const args: number[][] = [operand(true)];
    while (isSym(",")) { p++; args.push(operand(true)); }
    eat(";", `after the ${w} gate`);
    if (args.length !== def.qubits) fail(`${w} acts on ${def.qubits} qubit${def.qubits === 1 ? "" : "s"}, not ${args.length}.`, line);
    // Registers broadcast: h q; applies h to every qubit; cx a, b; pairs a[i] with b[i].
    const width = Math.max(...args.map((a) => a.length));
    if (args.some((a) => a.length !== 1 && a.length !== width)) fail(`The registers given to ${w} have different sizes.`, line);
    for (let i = 0; i < width; i++) apply(w, def, params, args.map((a) => (a.length === 1 ? a[0] : a[i])), line);
  }

  if (nQ === 0) fail("The circuit declares no qubits.", 0);
  let measure_: number[];
  let implicitMeasure = false;
  let nClbits = nC;
  if (measured.size === 0) {
    implicitMeasure = true;
    nClbits = nQ;
    measure_ = Array.from({ length: nQ }, (_, i) => i);
  } else {
    measure_ = Array.from({ length: nC }, (_, c) => measured.get(c) ?? -1);
  }
  return {
    version, nQubits: nQ, nClbits, ops, measure: measure_, implicitMeasure,
    qregs: qregs.map((r) => ({ name: r.name, size: r.size })), cregs: cregs.map((r) => ({ name: r.name, size: r.size })),
    gateCounts, twoQubitGates: twoQubit,
  };
}
