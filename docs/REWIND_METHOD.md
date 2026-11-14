# How Rewind's accuracy is measured

Rewind replays a circuit on "IBM machine X as calibrated on day Y": an Aer simulation with a noise
model built from that day's published calibration (`backend/app/rewind/replay.py`). This page says
how we check how close such a replica comes to the real machine, and what the numbers mean.

Method version: `rewind-accuracy-1`. Benchmark set: `rewind-bench-1`.
Raw numbers: `GET /api/v1/rewind/accuracy` on any Q-Lab server that runs the benchmark
(the hosted one: `https://qlab.soqlab.com/qlab-api/api/v1/rewind/accuracy`).

## The benchmark set (`rewind-bench-1`)

20 small circuits whose noise-free answer is known exactly (computed with a statevector; the
endpoint lists every ideal distribution):

| Circuits | Ideal answer |
|---|---|
| Bell pair | half `00`, half `11` |
| GHZ on 3, 4, 5, 6, 8 and 10 qubits | half all-zeros, half all-ones |
| QFT, 3 qubits, applied to the basis state `101` | every outcome equally likely |
| Inverse QFT of a prepared Fourier state, 3 and 4 qubits | always `101` / `1011` |
| 8 mirror circuits: widths 2 to 6, 4 to 8 random Clifford layers, then their exact inverse, then a fixed bit-flip pattern | always one known bitstring (never all zeros) |
| Idle probe: X, wait 40 µs, measure | always `1` without energy relaxation (T1) |
| Echo probe: H, wait 20 µs, X, wait 20 µs, H | always `0` without dephasing (T2) |

Generation is deterministic: fixed gate lists and seeds, choices made from SHA-256 of the seed
rather than a library random generator. The endpoint publishes a digest of every circuit's
operations; a changed circuit means a new set version, and numbers from different versions are
never pooled.

## On real hardware

- Once a week, on `QLAB_REWIND_BENCH_MACHINES_PER_WEEK` machines (default 3), chosen round robin
  among the operational machines whose calibration Rewind has stored from the last 48 hours, least
  recently benchmarked first.
- The whole set goes in one Sampler job per machine, `QLAB_REWIND_BENCH_SHOTS` shots per circuit
  (default 4000), compiled by Qiskit's preset pass manager (optimization level 1, seed 7) for that
  machine. Each compiled circuit is stored with the job.
- QPU time: IBM's open plan gives 10 minutes per rolling 28 days. Before each job the server
  estimates its cost with IBM's formula (about 2 s per job + 0.00035 s per shot of each circuit:
  30 s for 20 circuits x 4000 shots) and refuses to submit if the rolling 28-day total, shared with
  the hardware board's own benchmark, would pass `QLAB_REWIND_BENCH_BUDGET_SECONDS_PER_28D`
  (default 480 s, leaving headroom). Once a job ends, the usage IBM reports replaces the estimate.
- Submission, polling and storage are the hardware board's (`backend/app/hardware_board.py`).

## The replica of the same job

When a job has finished, the server waits until the daily harvest has run after the job's
execution time (at most 36 hours), so the calibration that was **in force when the job ran** (the
latest one calibrated at or before IBM's "running" timestamp) is stored. It then replays **the
same compiled circuits** (same physical qubits, same gates, same routing) on the replica built from
that calibration:

- per gate: thermal relaxation over the gate's duration (T1, T2), then a depolarizing channel making
  up the rest of the reported gate error;
- per measured qubit: the reported readout error (asymmetric where IBM reports both directions);
- explicit waits (the idle probes): thermal relaxation over the wait;
- same number of shots as the hardware job, fixed simulator seed.

This is the same model every Rewind replay uses; the benchmark does not get a better one.

## The numbers

For each circuit, the Hellinger fidelity `F(p, q) = (Σ_x √(p(x) q(x)))²` (Qiskit's
`hellinger_fidelity`) between:

- **hardware vs replica**: the accuracy figure;
- hardware vs ideal, and replica vs ideal: how noisy each side is.

Per machine we publish the median and the worst hardware-vs-replica fidelity over the latest run
and over a rolling 90 days, with the number of circuits and runs, the dates, the calibration used
(its SHA-256 and time, as in Rewind's signed daily manifests), every circuit's fidelities, and the
raw counts of both sides. A replay of that machine then says, for example:

> On ibm_fez, replicas matched real hardware with median Hellinger fidelity 0.97 (worst 0.88) on
> our 20-circuit benchmark, 11 Nov 2026.

When the median is below 0.9 it says plainly that the replica did not match well and to treat that
machine's replays as rough. A machine that has not been measured says "Not yet measured for this
machine".

## What to expect, and limits

- **Replicas should look better than reality.** The noise model has no crosstalk, no leakage, no
  coherent (over-rotation) errors, no decoherence while a qubit waits between gates (other than an
  explicit wait), and no drift between the calibration and the moment the job ran. All of these make
  the real machine noisier than its replica, so the replica-vs-ideal fidelity is usually higher than
  the hardware-vs-ideal one, and a low hardware-vs-replica figure usually means the machine was
  worse than its calibration says.
- Both sides are finite samples (4000 shots each by default), so even a perfect replica scores
  slightly under 1, most for circuits with many likely outcomes (the QFT one).
- 20 small circuits on a handful of qubits are a sample of each machine, not all of it: other qubits
  and longer circuits can match better or worse.
- One run per machine every few weeks: a calibration can be good one day and poor the next. The
  rolling window shows how stable the figure is.

## What is and isn't published

Published: benchmark circuits and ideal answers, the counts our own benchmark jobs returned from the
real machines, the replica's counts, every fidelity, job ids, dates, and the calibration's hash and
time. Not published: the calibration data itself, which is IBM's (Rewind keeps it to replay from
and only shows per-snapshot medians). Not affiliated with or endorsed by IBM.

Without an IBM Quantum key (`QISKIT_IBM_TOKEN`) nothing runs and the endpoint says so. A local
preview (`QLAB_HARDWARE_BOARD_SIMULATE=1`, refused on Render) uses IBM's fake backends on a
simulator in place of hardware; its results are labelled simulated and never shown as real.
