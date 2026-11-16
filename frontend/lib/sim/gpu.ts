/*
 * The GPU engine of the in-browser simulator: WebGPU compute shaders (shaders.ts) on a float32
 * state vector. It runs inside the simulator's Web Worker (worker.ts), so the page never waits on
 * it. WebGPU types are declared locally (only what is used) to keep the build free of extra
 * packages.
 */

import type { Circuit } from "./qasm";
import { APPLY1, APPLY2, grid, PROBS, SLOT } from "./shaders";

/* eslint-disable @typescript-eslint/no-explicit-any */
type GPUBuffer = { size: number; destroy(): void; mapAsync(mode: number): Promise<void>; getMappedRange(): ArrayBuffer; unmap(): void };
type GPUDevice = {
  limits: Record<string, number>;
  lost: Promise<{ reason: string; message: string }>;
  queue: { writeBuffer(b: GPUBuffer, off: number, data: ArrayBufferView | ArrayBuffer): void; submit(c: unknown[]): void; onSubmittedWorkDone(): Promise<void> };
  createBuffer(d: { size: number; usage: number; mappedAtCreation?: boolean }): GPUBuffer;
  createShaderModule(d: { code: string }): any;
  createComputePipeline(d: any): any;
  createComputePipelineAsync?(d: any): Promise<any>;
  createBindGroupLayout(d: any): any;
  createPipelineLayout(d: any): any;
  createBindGroup(d: any): any;
  createCommandEncoder(): any;
  pushErrorScope(f: string): void;
  popErrorScope(): Promise<{ message: string } | null>;
  destroy(): void;
  addEventListener?(t: string, f: (e: any) => void): void;
};
type GPUAdapter = {
  limits: Record<string, number>;
  info?: { vendor?: string; architecture?: string; description?: string; device?: string };
  isFallbackAdapter?: boolean;
  requestDevice(d?: any): Promise<GPUDevice>;
};
type GPU = { requestAdapter(o?: any): Promise<GPUAdapter | null> };
/* eslint-enable @typescript-eslint/no-explicit-any */

// GPUBufferUsage / GPUMapMode / GPUShaderStage flags (fixed by the WebGPU spec).
const U = { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
const MAP_READ = 1;
const COMPUTE = 4;

export const GPU_MAX_QUBITS = 24;
/**
 * Gates per submitted command buffer: progress is reported after each, and no single submit runs
 * long enough to trip the operating system's GPU watchdog. 256 gates up to 20 qubits, then fewer
 * (16 at 24 qubits, about a third of a second on a laptop's integrated GPU).
 */
export const batchSize = (nQubits: number) => Math.max(1, Math.min(256, Math.floor(2 ** 28 / 2 ** nQubits)));

export type GpuInfo = { ok: true; name: string; maxQubits: number; fallbackAdapter: boolean } | { ok: false; reason: string };

export class DeviceLost extends Error {}

export class GpuEngine {
  private device: GPUDevice | null = null;
  private pipes: { apply1: unknown; apply2: unknown; probs: unknown; gateLayout: unknown; probLayout: unknown } | null = null;
  private lostMessage: string | null = null;
  info: GpuInfo | null = null;

  private gpu(): GPU | null {
    return ((globalThis as unknown as { navigator?: { gpu?: GPU } }).navigator?.gpu) ?? null;
  }

  /** Find an adapter and open a device (again, after a loss). */
  async init(): Promise<GpuInfo> {
    if (this.device && this.info?.ok) return this.info;
    const gpu = this.gpu();
    if (!gpu) return (this.info = { ok: false, reason: "This browser has no WebGPU (or not in a background thread)." });
    let adapter: GPUAdapter | null = null;
    try { adapter = await gpu.requestAdapter({ powerPreference: "high-performance" }); } catch { adapter = null; }
    if (!adapter) return (this.info = { ok: false, reason: "WebGPU is present but no GPU adapter is available (it may be blocked or switched off)." });
    const lim = adapter.limits;
    const bytes = Math.min(lim.maxStorageBufferBindingSize ?? 134217728, lim.maxBufferSize ?? 268435456);
    const maxQubits = Math.min(GPU_MAX_QUBITS, Math.floor(Math.log2(bytes / 8)));
    let device: GPUDevice;
    try { device = await adapter.requestDevice(); } catch (e) {
      return (this.info = { ok: false, reason: `The GPU wouldn't open a device: ${(e as Error).message || "unknown reason"}.` });
    }
    this.device = device;
    this.lostMessage = null;
    void device.lost.then((l) => {
      if (this.device === device) { this.device = null; this.pipes = null; }
      if (l.reason !== "destroyed") this.lostMessage = l.message || "the GPU device was lost";
    });
    const i = adapter.info ?? {};
    const name = [i.description, i.vendor && i.architecture ? `${i.vendor} ${i.architecture}` : i.vendor].find((x) => x && x.trim()) || "a WebGPU adapter";
    this.pipes = await this.build(device);
    return (this.info = { ok: true, name, maxQubits, fallbackAdapter: !!adapter.isFallbackAdapter });
  }

  private async build(device: GPUDevice) {
    const storage = (type: string) => ({ visibility: COMPUTE, buffer: { type } });
    const gateLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, ...storage("storage") },
        { binding: 1, visibility: COMPUTE, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 176 } },
      ],
    });
    const probLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, ...storage("read-only-storage") }, { binding: 1, ...storage("storage") }, { binding: 2, visibility: COMPUTE, buffer: { type: "uniform" } }],
    });
    const make = async (code: string, layout: unknown) => {
      const d = { layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module: device.createShaderModule({ code }), entryPoint: "main" } };
      return device.createComputePipelineAsync ? device.createComputePipelineAsync(d) : device.createComputePipeline(d);
    };
    const [apply1, apply2, probs] = await Promise.all([make(APPLY1, gateLayout), make(APPLY2, gateLayout), make(PROBS, probLayout)]);
    return { apply1, apply2, probs, gateLayout, probLayout };
  }

  /**
   * Run the circuit; returns |amplitude|^2 for every basis state (float32) and the time the gates
   * took on the GPU. Throws DeviceLost if the device goes away during the run.
   */
  async run(c: Circuit, onProgress: (done: number) => void): Promise<{ probs: Float32Array; gateMs: number; readMs: number; dispatches: number }> {
    const info = await this.init();
    if (!info.ok) throw new Error(info.reason);
    const device = this.device!, pipes = this.pipes!;
    if (c.nQubits > info.maxQubits) throw new Error(`This GPU takes up to ${info.maxQubits} qubits.`);
    const n = c.nQubits, amps = 2 ** n;
    const made: GPUBuffer[] = [];
    const buffer = (size: number, usage: number) => { const b = device.createBuffer({ size, usage }); made.push(b); return b; };
    device.pushErrorScope("out-of-memory");
    device.pushErrorScope("validation");
    try {
      const state = buffer(amps * 8, U.STORAGE | U.COPY_DST | U.COPY_SRC);
      device.queue.writeBuffer(state, 0, new Float32Array([1, 0]));
      const nOps = c.ops.length;
      const params = buffer(Math.max(1, nOps) * SLOT, U.UNIFORM | U.COPY_DST);
      if (nOps) {
        const data = new ArrayBuffer(nOps * SLOT);
        c.ops.forEach((op, k) => {
          const u = new Uint32Array(data, k * SLOT, 12);
          const f = new Float32Array(data, k * SLOT + 48, 32);
          const count = 2 ** (n - op.pos.length);
          u.set([count, grid(count).stride, op.pos.length, op.cmask >>> 0]);
          op.pos.forEach((q, j) => { u[4 + j] = q; });
          if (op.k === 1) { u[8] = op.t; } else { u[8] = op.a; u[9] = op.b; }
          f.set(op.m.slice(0, op.k === 1 ? 8 : 32));
        });
        device.queue.writeBuffer(params, 0, data);
      }
      const bind = device.createBindGroup({ layout: pipes.gateLayout, entries: [{ binding: 0, resource: { buffer: state } }, { binding: 1, resource: { buffer: params, size: 176 } }] });
      const t0 = performance.now();
      const BATCH = batchSize(n);
      for (let start = 0; start < nOps; start += BATCH) {
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        for (let k = start; k < Math.min(nOps, start + BATCH); k++) {
          const op = c.ops[k];
          const gsz = grid(2 ** (n - op.pos.length));
          pass.setPipeline(op.k === 1 ? pipes.apply1 : pipes.apply2);
          pass.setBindGroup(0, bind, [k * SLOT]);
          pass.dispatchWorkgroups(gsz.x, gsz.y);
        }
        pass.end();
        device.queue.submit([enc.finish()]);
        await device.queue.onSubmittedWorkDone();
        if (this.lostMessage || this.device !== device) throw new DeviceLost(this.lostMessage ?? "the GPU device was lost");
        onProgress(Math.min(nOps, start + BATCH));
      }
      const gateMs = performance.now() - t0;

      const t1 = performance.now();
      const out = buffer(amps * 4, U.STORAGE | U.COPY_SRC);
      const head = buffer(16, U.UNIFORM | U.COPY_DST);
      const pg = grid(amps);
      device.queue.writeBuffer(head, 0, new Uint32Array([amps, pg.stride, 0, 0]));
      const read = buffer(amps * 4, U.MAP_READ | U.COPY_DST);
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipes.probs);
      pass.setBindGroup(0, device.createBindGroup({ layout: pipes.probLayout, entries: [
        { binding: 0, resource: { buffer: state } }, { binding: 1, resource: { buffer: out } }, { binding: 2, resource: { buffer: head } },
      ] }));
      pass.dispatchWorkgroups(pg.x, pg.y);
      pass.end();
      enc.copyBufferToBuffer(out, 0, read, 0, amps * 4);
      device.queue.submit([enc.finish()]);
      const validation = await device.popErrorScope();
      const oom = await device.popErrorScope();
      if (oom) throw new Error(`The GPU ran out of memory for ${n} qubits (${(amps * 8 / 2 ** 20).toFixed(0)} MiB state). Try fewer qubits or the CPU engine.`);
      if (validation) throw new Error(`The GPU refused the work: ${validation.message}`);
      try { await read.mapAsync(MAP_READ); } catch (e) {
        if (this.lostMessage || this.device !== device) throw new DeviceLost(this.lostMessage ?? "the GPU device was lost");
        throw e;
      }
      const probs = new Float32Array(read.getMappedRange().slice(0));
      read.unmap();
      return { probs, gateMs, readMs: performance.now() - t1, dispatches: nOps + 1 };
    } catch (e) {
      // Error scopes left open by an early throw are closed so the next run starts clean.
      await device.popErrorScope().catch(() => null);
      await device.popErrorScope().catch(() => null);
      throw e;
    } finally {
      made.forEach((b) => b.destroy());
    }
  }
}
