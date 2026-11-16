/*
 * The simulator's Web Worker: both engines run here, off the page's main thread.
 * Messages in:  { type: "probe" } | { type: "run", id, circuit, engine: "auto" | "gpu" | "cpu", shots, seed }
 * Messages out: { type: "probe", gpu, cpuMaxQubits } | { type: "progress", id, done, total }
 *               { type: "result", id, ... } | { type: "error", id, message }
 */

import { DeviceLost, GpuEngine } from "./gpu";
import type { Circuit } from "./qasm";
import { CPU_MAX_QUBITS, type EngineChoice, type RunResult } from "./types";
import { outcomeDistribution, probabilities, simulate, summarize } from "./statevector";

const gpu = new GpuEngine();
const post = (m: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(m);

async function runCpu(id: number, c: Circuit) {
  const t0 = performance.now();
  const s = simulate(c, { onProgress: (done) => { if ((done & 1023) === 0) post({ type: "progress", id, done, total: c.ops.length }); } });
  const gateMs = performance.now() - t0;
  const t1 = performance.now();
  const p = probabilities(s);
  return { probs: p, gateMs, readMs: performance.now() - t1 };
}

async function run(id: number, c: Circuit, choice: EngineChoice, shots: number, seed: number) {
  const notes: string[] = [];
  let engine: "gpu" | "cpu" = "cpu";
  if (choice !== "cpu") {
    const info = await gpu.init();
    if (info.ok && c.nQubits <= info.maxQubits) engine = "gpu";
    else if (choice === "gpu") throw new Error(info.ok ? `This GPU engine takes up to ${info.maxQubits} qubits.` : info.reason);
  }
  if (engine === "cpu" && c.nQubits > CPU_MAX_QUBITS) {
    throw new Error(`${c.nQubits} qubits needs the GPU engine; the CPU engine here takes up to ${CPU_MAX_QUBITS}.`);
  }
  let out: { probs: Float64Array | Float32Array; gateMs: number; readMs: number };
  if (engine === "gpu") {
    try {
      out = await gpu.run(c, (done) => post({ type: "progress", id, done, total: c.ops.length }));
    } catch (e) {
      if (!(e instanceof DeviceLost)) throw e;
      if (c.nQubits > CPU_MAX_QUBITS) throw new Error(`The GPU device was lost (${e.message}). Run again to reopen it.`);
      notes.push(`The GPU device was lost during the run (${e.message}), so it ran again on the CPU.`);
      engine = "cpu";
      out = await runCpu(id, c);
    }
  } else {
    out = await runCpu(id, c);
  }
  const t2 = performance.now();
  const dist = outcomeDistribution(out.probs, c.nQubits, c.measure);
  const summary = summarize(dist, shots, seed);
  const sampleMs = performance.now() - t2;
  const info = gpu.info;
  const result: RunResult = {
    type: "result", id, engine,
    device: engine === "gpu" && info?.ok ? info.name : "JavaScript, float64, in a background thread",
    precision: engine === "gpu" ? "float32" : "float64",
    gateMs: out.gateMs, readMs: out.readMs, sampleMs, notes, ...summary,
  };
  post(result);
}

self.onmessage = (ev: MessageEvent) => {
  const m = ev.data as { type: string; id: number; circuit: Circuit; engine: EngineChoice; shots: number; seed: number };
  if (m.type === "probe") {
    void gpu.init().then((g) => post({ type: "probe", gpu: g, cpuMaxQubits: CPU_MAX_QUBITS }));
    return;
  }
  if (m.type === "run") {
    run(m.id, m.circuit, m.engine, m.shots, m.seed).catch((e: unknown) => post({ type: "error", id: m.id, message: (e as Error)?.message || String(e) }));
  }
};
