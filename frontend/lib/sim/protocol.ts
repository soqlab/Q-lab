/*
 * What the page and the simulator's worker (worker.ts) say to each other, and the page's side of it.
 */

import type { Circuit } from "./qasm";
import { CPU_MAX_QUBITS, type EngineChoice, type Probe, type RunResult } from "./types";

export { CPU_MAX_QUBITS, type EngineChoice, type Probe, type RunResult } from "./types";

type Pending = { resolve: (r: RunResult) => void; reject: (e: Error) => void; onProgress?: (done: number, total: number) => void };

/** One worker for the page. cancel() ends it (and any GPU work in it); the next call starts another. */
export class SimClient {
  private w: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private probeWaiters: ((p: Probe) => void)[] = [];
  private probed: Promise<Probe> | null = null;

  private worker(): Worker {
    if (this.w) return this.w;
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { type: "probe" | "progress" | "result" | "error"; id?: number; done?: number; total?: number; message?: string } & Partial<Probe>;
      if (m.type === "probe") { const p = { gpu: m.gpu!, cpuMaxQubits: m.cpuMaxQubits! }; this.probeWaiters.splice(0).forEach((f) => f(p)); return; }
      const job = m.id != null ? this.pending.get(m.id) : undefined;
      if (!job) return;
      if (m.type === "progress") job.onProgress?.(m.done!, m.total!);
      else if (m.type === "result") { this.pending.delete(m.id!); job.resolve(ev.data as RunResult); }
      else if (m.type === "error") { this.pending.delete(m.id!); job.reject(new Error(m.message)); }
    };
    w.onerror = (ev) => {
      ev.preventDefault?.();
      this.fail("The simulator's background thread stopped unexpectedly (it may have run out of memory).");
    };
    this.w = w;
    return w;
  }

  private fail(msg: string) {
    this.w?.terminate();
    this.w = null;
    this.probed = null;
    this.pending.forEach((j) => j.reject(new Error(msg)));
    this.pending.clear();
    // A worker that never started still answers the probe, so the page doesn't wait forever.
    this.probeWaiters.splice(0).forEach((f) => f({ gpu: { ok: false, reason: msg }, cpuMaxQubits: CPU_MAX_QUBITS }));
  }

  probe(): Promise<Probe> {
    if (!this.probed) {
      this.probed = new Promise<Probe>((resolve) => {
        this.probeWaiters.push(resolve);
        this.worker().postMessage({ type: "probe" });
      });
    }
    return this.probed;
  }

  run(circuit: Circuit, engine: EngineChoice, shots: number, seed: number, onProgress?: (done: number, total: number) => void): Promise<RunResult> {
    const id = ++this.seq;
    return new Promise<RunResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker().postMessage({ type: "run", id, circuit, engine, shots, seed });
    });
  }

  cancel() { this.fail("Stopped."); }

  dispose() { this.fail("Closed."); }
}
