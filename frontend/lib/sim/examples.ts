/*
 * The circuits /try opens with. Each one is also in crosscheck.json, where the backend's tests
 * check its probabilities against Qiskit and the frontend's tests check the browser engines
 * against those numbers (scripts/test-sim.mjs).
 */

export type Example = { id: string; name: string; what: string; qasm: string; needsGpu?: boolean };

const HEAD = 'OPENQASM 2.0;\ninclude "qelib1.inc";\n';

/** Qiskit's QFT (with the final swaps) on n qubits, written out gate by gate. */
function qftLines(n: number): string[] {
  const out: string[] = [];
  for (let j = n - 1; j >= 0; j--) {
    out.push(`h q[${j}];`);
    for (let k = j - 1; k >= 0; k--) out.push(`cp(pi/${2 ** (j - k)}) q[${j}],q[${k}];`);
  }
  for (let i = 0; i < Math.floor(n / 2); i++) out.push(`swap q[${i}],q[${n - 1 - i}];`);
  return out;
}

function ghz(n: number): string {
  const lines = [`qreg q[${n}];`, `creg c[${n}];`, "h q[0];"];
  for (let i = 0; i < n - 1; i++) lines.push(`cx q[${i}],q[${i + 1}];`);
  lines.push("measure q -> c;");
  return HEAD + lines.join("\n") + "\n";
}

/** A state with period 4 (every 4th basis state), then the QFT: the peaks show the period. */
function periodQft(n: number): string {
  const lines = [`// Superpose every 4th basis state, then the QFT: the outcomes are the multiples of 2^${n}/4.`, `qreg q[${n}];`, `creg c[${n}];`];
  for (let i = 2; i < n; i++) lines.push(`h q[${i}];`);
  lines.push(...qftLines(n), "measure q -> c;");
  return HEAD + lines.join("\n") + "\n";
}

const GROVER = `${HEAD}// Grover search on 3 qubits for |101>: two rounds of oracle + diffuser.
qreg q[3];
creg c[3];
h q;
// round 1: oracle flips the sign of |101>
x q[1];
h q[2];
ccx q[0],q[1],q[2];
h q[2];
x q[1];
// diffuser
h q;
x q;
h q[2];
ccx q[0],q[1],q[2];
h q[2];
x q;
h q;
// round 2
x q[1];
h q[2];
ccx q[0],q[1],q[2];
h q[2];
x q[1];
h q;
x q;
h q[2];
ccx q[0],q[1],q[2];
h q[2];
x q;
h q;
measure q -> c;
`;

export const EXAMPLES: Example[] = [
  { id: "bell", name: "Bell", what: "Two qubits entangled: 00 or 11, half each.", qasm: `${HEAD}qreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;\n` },
  { id: "ghz", name: "GHZ, 5 qubits", what: "Five qubits all 0 or all 1.", qasm: ghz(5) },
  { id: "grover", name: "Grover, 3 qubits", what: "Finds the marked state 101 with about 95% probability.", qasm: GROVER },
  { id: "qft", name: "QFT, 4 qubits", what: "The Fourier transform reveals the period: four equal peaks.", qasm: periodQft(4) },
  { id: "ghz20", name: "GHZ, 20 qubits", what: "A million amplitudes; still two outcomes.", qasm: ghz(20) },
  { id: "qft22", name: "QFT, 22 qubits", what: "Four million amplitudes and 284 gates; needs the GPU engine.", qasm: periodQft(22), needsGpu: true },
];
