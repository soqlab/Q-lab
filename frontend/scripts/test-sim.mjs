// Tests of the in-browser simulator (/try): node scripts/test-sim.mjs
//
// lib/sim/*.ts is compiled with the TypeScript compiler the project already has, into a temporary
// folder, and tested with node:test. No browser and no GPU are needed:
//   - the CPU engine (float64) must match crosscheck.json within 1e-6. Those numbers are Qiskit's,
//     from the backend's own ideal-simulation path (backend/app/local_sim.py), and
//     backend/tests/test_browser_sim_crosscheck.py keeps them true;
//   - the GPU engine's kernels are checked through the CPU reference: apply1/apply2 are the same
//     index arithmetic as the WGSL shaders, and run on a Float32Array (float32 storage, like the
//     GPU) they must stay within 1e-5; they are also checked against a plain dense-matrix product;
//   - the parser refuses what it doesn't support, with the line.
// node scripts/test-sim.mjs --sync rewrites the example circuits into crosscheck.json (then run the
// backend test with QLAB_WRITE_CROSSCHECK=1 to fill in Qiskit's numbers).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const here = fileURLToPath(new URL("../lib/sim/", import.meta.url));
const out = mkdtempSync(join(tmpdir(), "qlab-sim-"));
for (const f of readdirSync(here).filter((f) => f.endsWith(".ts") && f !== "worker.ts" && f !== "protocol.ts")) {
  const js = ts.transpileModule(readFileSync(join(here, f), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from "\.\/([a-z0-9]+)"/g, 'from "./$1.mjs"');
  writeFileSync(join(out, f.replace(/\.ts$/, ".mjs")), js);
}
const load = (m) => import(pathToFileURL(join(out, `${m}.mjs`)).href);
const { parseQasm, QasmError, LIMITS } = await load("qasm");
const sv = await load("statevector");
const { EXAMPLES } = await load("examples");
const shaders = await load("shaders");
const handoff = await load("handoff");
process.on("exit", () => rmSync(out, { recursive: true, force: true }));

const fixturePath = join(here, "crosscheck.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

if (process.argv.includes("--sync")) {
  const byName = new Map(fixture.cases.map((c) => [c.name, c]));
  for (const e of EXAMPLES.filter((x) => !x.needsGpu)) {
    const old = byName.get(`example:${e.id}`);
    if (old && old.qasm === e.qasm) continue;
    byName.set(`example:${e.id}`, { name: `example:${e.id}`, qasm: e.qasm, probabilities: null });
  }
  fixture.cases = [...byName.values()];
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`crosscheck.json: ${fixture.cases.length} cases`);
  process.exit(0);
}

function distribution(qasm, f32 = false) {
  const c = parseQasm(qasm);
  const probs = sv.probabilities(sv.simulate(c, { f32 }));
  const dist = sv.outcomeDistribution(probs, c.nQubits, c.measure);
  const out = {};
  dist.forEach((p, i) => { if (p > 1e-12) out[sv.bits(i, c.nClbits)] = p; });
  return out;
}

function maxDiff(a, b) {
  let d = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) d = Math.max(d, Math.abs((a[k] ?? 0) - (b[k] ?? 0)));
  return d;
}

test("every example is in crosscheck.json, unchanged (those over 20 qubits: below)", () => {
  for (const e of EXAMPLES.filter((x) => !x.needsGpu)) {
    const c = fixture.cases.find((x) => x.name === `example:${e.id}`);
    assert.ok(c, `example ${e.id} is missing: run node scripts/test-sim.mjs --sync`);
    assert.equal(c.qasm, e.qasm, `example ${e.id} changed: run --sync and regenerate`);
  }
});

for (const c of fixture.cases) {
  test(`CPU float64 matches Qiskit within 1e-6: ${c.name}`, () => {
    assert.ok(c.probabilities, "no Qiskit numbers yet: run the backend test with QLAB_WRITE_CROSSCHECK=1");
    const d = maxDiff(distribution(c.qasm), c.probabilities);
    assert.ok(d <= 1e-6, `largest difference ${d}`);
  });
  const n = parseQasm(c.qasm).nQubits;
  if (n <= 20) {
    test(`GPU kernels (float32 reference) match Qiskit within 1e-5: ${c.name}`, () => {
      const d = maxDiff(distribution(c.qasm, true), c.probabilities);
      assert.ok(d <= 1e-5, `largest difference ${d}`);
    });
  }
}

test("over the server's 20-qubit limit: the 22-qubit QFT example gives its four known peaks", () => {
  const e = EXAMPLES.find((x) => x.id === "qft22");
  const c = parseQasm(e.qasm);
  assert.equal(c.nQubits, 22);
  const d = distribution(e.qasm);
  const want = Object.fromEntries([0, 1, 2, 3].map((k) => [sv.bits(k << 20, 22), 0.25]));
  assert.ok(maxDiff(d, want) <= 1e-6, JSON.stringify(Object.entries(d).slice(0, 8)));
});

// A dense reference: the gate as a full 2^n x 2^n product, built bit by bit, nothing shared with apply1/apply2.
function dense(state, n, op) {
  const N = 1 << n, outS = new Float64Array(2 * N);
  const targets = op.k === 1 ? [op.t] : [op.a, op.b];
  const dim = 1 << targets.length;
  for (let col = 0; col < N; col++) {
    const ar = state[2 * col], ai = state[2 * col + 1];
    if (!ar && !ai) continue;
    if ((col & op.cmask) !== op.cmask) { outS[2 * col] += ar; outS[2 * col + 1] += ai; continue; }
    let sub = 0;
    targets.forEach((t, j) => { if ((col >> t) & 1) sub |= 1 << j; });
    for (let r = 0; r < dim; r++) {
      let row = col;
      targets.forEach((t, j) => { row = (r >> j) & 1 ? row | (1 << t) : row & ~(1 << t); });
      const mr = op.m[(r * dim + sub) * 2], mi = op.m[(r * dim + sub) * 2 + 1];
      outS[2 * row] += mr * ar - mi * ai;
      outS[2 * row + 1] += mr * ai + mi * ar;
    }
  }
  return outS;
}

test("kernel index arithmetic equals a dense matrix product, every gate shape", () => {
  const rand = sv.rng(7);
  const n = 5;
  const gates = ["h q[3];", "u(0.3,1.1,-0.7) q[0];", "cx q[4],q[1];", "ccx q[0],q[4],q[2];", "cp(0.9) q[2],q[0];", "cu(0.4,0.2,1.3,0.6) q[1],q[3];",
    "swap q[0],q[4];", "rzz(0.7) q[3],q[1];", "rxx(1.9) q[2],q[4];", "cswap q[2],q[0],q[3];", "cswap q[4],q[3],q[1];", "csx q[0],q[3];"];
  for (const g of gates) {
    const c = parseQasm(`OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[${n}];\n${g}\n`);
    let s = new Float64Array(2 << n);
    for (let i = 0; i < s.length; i++) s[i] = rand() - 0.5;
    const ref = dense(s, n, c.ops[0]);
    if (c.ops[0].k === 1) sv.apply1(s, n, c.ops[0]); else sv.apply2(s, n, c.ops[0]);
    for (let i = 0; i < s.length; i++) assert.ok(Math.abs(s[i] - ref[i]) < 1e-12, `${g}: entry ${i}`);
  }
});

test("baseIndex visits every amplitude group exactly once", () => {
  const n = 6, pos = [1, 3, 4], cmask = 1 << 4;
  const seen = new Set();
  for (let i = 0; i < 1 << (n - pos.length); i++) {
    const b = sv.baseIndex(i, pos, cmask);
    assert.equal(b & ((1 << 1) | (1 << 3)), 0);
    assert.equal(b & cmask, cmask);
    seen.add(b);
  }
  assert.equal(seen.size, 1 << (n - pos.length));
});

test("the WGSL shaders keep the layout the engine writes", () => {
  for (const k of ["APPLY1", "APPLY2"]) {
    const w = shaders[k];
    assert.match(w, /head: vec4<u32>,\s*\/\/[^\n]*\n\s*pos: vec4<u32>/);
    assert.match(w, /m: array<vec4<f32>, 8>/);
    assert.match(w, /@workgroup_size\(256\)/);
  }
  assert.equal(shaders.SLOT, 256);
  assert.deepEqual(shaders.grid(1), { x: 1, y: 1, stride: 256 });
  const g = shaders.grid(2 ** 23);
  assert.ok(g.x <= 65535 && g.x * g.y * 256 >= 2 ** 23);
  const big = shaders.grid(65535 * 256 * 3);
  assert.equal(big.x, 65535); assert.equal(big.y, 3);
});

test("float32 drift stays small on a long circuit", () => {
  const lines = ['OPENQASM 2.0;', 'include "qelib1.inc";', "qreg q[10];"];
  const r = sv.rng(3);
  for (let i = 0; i < 3000; i++) {
    const a = Math.floor(r() * 10), b = (a + 1 + Math.floor(r() * 9)) % 10;
    lines.push(i % 3 ? `u(${r() * 6},${r() * 6},${r() * 6}) q[${a}];` : `cx q[${a}],q[${b}];`);
  }
  const qasm = lines.join("\n");
  const d = maxDiff(distribution(qasm, true), distribution(qasm));
  assert.ok(d < 1e-5, `float32 vs float64 after 3000 gates: ${d}`);
});

test("shots are seeded, add up, and follow the probabilities", () => {
  const dist = new Float64Array([0.5, 0, 0.25, 0.25]);
  const a = sv.summarize(dist, 100000, 42), b = sv.summarize(dist, 100000, 42);
  assert.deepEqual(a.counts, b.counts);
  assert.equal(a.counts.reduce((s, [, n]) => s + n, 0), 100000);
  const m = new Map(a.counts);
  assert.equal(m.get(1), undefined);
  assert.ok(Math.abs(m.get(0) / 1e5 - 0.5) < 0.01 && Math.abs(m.get(2) / 1e5 - 0.25) < 0.01);
  assert.equal(a.possible, 3);
  assert.deepEqual(a.top.map(([i]) => i), [0, 2, 3]);
  assert.notDeepEqual(sv.summarize(dist, 1000, 1).counts, sv.summarize(dist, 1000, 2).counts);
});

test("the top outcomes are the most likely ones, also past 256 of them", () => {
  const dist = new Float64Array(4096);
  for (let i = 0; i < dist.length; i++) dist[i] = i + 1;
  const s = sv.summarize(dist, 10, 1);
  assert.equal(s.top.length, sv.TOP);
  assert.equal(s.top[0][0], 4095);
  assert.equal(s.top[sv.TOP - 1][0], 4096 - sv.TOP);
});

test("outcomes read classical bits, bit 0 on the right, unmeasured bits 0", () => {
  const d = distribution('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[4];\nx q[0];\nmeasure q[0] -> c[2];\nmeasure q[1] -> c[0];\n');
  assert.deepEqual(Object.keys(d), ["0100"]);
  const implicit = parseQasm('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nx q[1];\n');
  assert.ok(implicit.implicitMeasure);
  assert.deepEqual(Object.keys(distribution('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nx q[1];\n')), ["10"]);
});

test("OpenQASM 3 forms", () => {
  const c = parseQasm('OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nqubit r;\nbit[3] c;\nh q[0];\ncx q[0], r;\nU(pi/2, 0, pi) q[1];\nc[0] = measure q[0];\nc[1] = measure q[1];\nc[2] = measure r;\n');
  assert.equal(c.nQubits, 3);
  assert.deepEqual(c.measure, [0, 1, 2]);
  const d = parseQasm('OPENQASM 3;\ninclude "stdgates.inc";\nqubit[2] q;\nbit[2] c;\nrx(tau/4 + 2**-1) q[0];\nc = measure q;\n');
  assert.equal(d.ops.length, 1);
});

test("refuses what it doesn't run, naming the line", () => {
  const H2 = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\n';
  const cases = [
    [H2 + "gate g a { h a; }\n", /Line 5: Custom gate definitions/],
    [H2 + "reset q[0];\n", /Line 5: reset isn't supported/],
    [H2 + "measure q[0] -> c[0];\nif(c==1) x q[1];\n", /Line 6: Classically controlled/],
    [H2 + "measure q[0] -> c[0];\nh q[0];\n", /Line 6: .*Mid-circuit measurement/],
    [H2 + "measure q[0] -> c[0];\nmeasure q[1] -> c[0];\n", /measured into twice/],
    [H2 + "foo q[0];\n", /Line 5: "foo" isn't a gate/],
    [H2 + "h q[2];\n", /out of range/],
    [H2 + "cx q[0],q[0];\n", /same qubit twice/],
    [H2 + "rx q[0];\n", /takes 1 angle/],
    [H2 + "rx(pi/0) q[0];\n", /Division by zero/],
    [H2 + "rx(foo) q[0];\n", /"foo" isn't a number/],
    ['OPENQASM 2.0;\nqreg q[1];\nh q[0];\n', /add include "qelib1.inc"/],
    ['OPENQASM 2.0;\ninclude "other.inc";\n', /Only include "qelib1.inc"/],
    ['OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nctrl @ x q[0], q[1];\n', /Gate modifiers/],
    ['OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nrzz(0.1) q[0], q[1];\n', /"rzz" isn't a gate/],
    ['qreg q[1];\n', /Start with a version line/],
    ['OPENQASM 4.0;\n', /OpenQASM 4.0 isn't supported/],
    [`OPENQASM 2.0;\nqreg q[${LIMITS.qubits + 1}];\n`, /simulates up to 24/],
    [H2 + "h q[0];\n".repeat(LIMITS.operations + 1), /more than 20,000 gate operations/],
    ["x".repeat(LIMITS.source + 1), /characters/],
  ];
  for (const [src, re] of cases) {
    assert.throws(() => parseQasm(src), (e) => e instanceof QasmError && re.test(e.message), `expected ${re} for ${JSON.stringify(src.slice(-40))}`);
  }
});

test("register broadcasting", () => {
  const c = parseQasm('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg a[3];\nqreg b[3];\nh a;\ncx a,b;\ncx a[0],b;\n');
  assert.equal(c.ops.length, 9);
  assert.equal(c.twoQubitGates, 6);
  assert.throws(() => parseQasm('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg a[3];\nqreg b[2];\ncx a,b;\n'), /different sizes/);
});

test("the circuit carried to Rewind comes back unchanged", () => {
  for (const e of EXAMPLES) {
    const link = handoff.rewindLink(e.qasm);
    if (link.viaSession) { assert.equal(link.href, "/rewind?circuit=session"); continue; }
    const v = new URL(link.href, "https://x").searchParams.get("circuit");
    assert.equal(handoff.readHandoff(v), e.qasm);
  }
  const odd = "OPENQASM 3.0;\n// \u03c0 \u2014 \u212f\nqubit q;\n";
  assert.equal(handoff.decodeCircuit(handoff.encodeCircuit(odd)), odd);
  assert.equal(handoff.readHandoff("not base64!"), null);
  assert.equal(handoff.readHandoff(null), null);
  assert.ok(handoff.rewindLink("h q[0];\n".repeat(2000)).viaSession);
});
