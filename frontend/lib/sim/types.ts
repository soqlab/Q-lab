/*
 * Shared between the page and the simulator's worker. Kept apart from protocol.ts so the worker's
 * bundle never contains the code that starts the worker.
 */

import type { GpuInfo } from "./gpu";
import type { Summary } from "./statevector";

/** 20 qubits is 16 MiB of float64 state: quick enough in JavaScript on a phone. */
export const CPU_MAX_QUBITS = 20;

export type EngineChoice = "auto" | "gpu" | "cpu";

export type RunResult = Summary & {
  type: "result"; id: number;
  engine: "gpu" | "cpu"; device: string; precision: "float32" | "float64";
  gateMs: number; readMs: number; sampleMs: number; notes: string[];
};

export type Probe = { gpu: GpuInfo; cpuMaxQubits: number };
