# How "Why this outcome?" works

On a run's page, clicking an outcome in "What was measured" asks Q-Lab which of the machine's
error sources made that outcome likely. The answer is from a **model** of the machine built from its
calibration, not a measurement of what physically happened in your job.

Method version: `why-ablation-1`. Code: `backend/app/why_failed.py`.
API: `GET /api/v1/runs/{run_id}/why?outcome=0101`.

## 1. The calibration

In this order, and nothing else (no live call to the provider):

1. **The calibration captured with the run.** The Q-Lab SDK reads `backend.properties()` (or the
   backend's target) when the job is submitted: T1, T2, readout error per qubit, gate error and
   duration per gate. When it came from the target, it carries no calibration date, and the answer
   says so.
2. **Rewind's stored calibration** of the run's machine, the one nearest the run's time, only if it
   was calibrated within 36 hours of the run. Rewind's snapshots also carry asymmetric readout errors
   (P(1|0) and P(0|1)) and the machine's coupling map.
3. Otherwise the answer says the calibration is missing and does not guess. Simulator runs have no
   calibration. A Q-Lab server stores daily calibrations only when it has an IBM Quantum token
   configured; the hosted server currently has none, so there it relies on (1).

## 2. The circuit that ran

The transpiled circuit the SDK captured (QPY, with physical qubit numbers), checked against the
run's gate counts. Without it, the stored circuit is used only if every gate in it is one the
calibration lists on those exact qubits. Otherwise the answer says the layout is unknown: pointing at
a physical qubit would be a guess.

## 3. The model and its error sources

After each gate of the circuit, explicit noise channels, each belonging to one source:

| Source | Channel |
|---|---|
| readout of qubit q | the reported readout error (asymmetric when reported), applied to the output probabilities |
| gate on pair a–b | the depolarizing part of every two-qubit gate on that pair |
| single-qubit gates on q | the depolarizing part of every single-qubit gate on q |
| decoherence of q | thermal relaxation from T1 and T2 during q's gates, explicit delays, and idle gaps between two of q's gates (as-soon-as-possible schedule) |

Each gate's depolarizing part is what remains of its reported error after its relaxation, the same
composition Rewind's replays and qiskit-aer's device models use.

## 4. Ablation

Exact probabilities (Aer density matrix, no sampling) are computed with every source on, with every
source off (the noise-free answer) and with each non-readout source off in turn; removing a readout
error is done analytically on the probabilities. For a clicked outcome `b` the noise-free circuit
never gives (probability under 1e-9):

- each source's effect = P(b, all sources) − P(b, that source removed);
- its **share** = its effect / the sum of all positive effects.

"Qubit 2's readout error (8.0%) explains ~95% of this outcome in the model" means: in the model,
removing that readout error alone removes 95% of the summed effects.

An outcome the noise-free circuit does give is not blamed on noise; the answer gives its noise-free
probability instead.

## 5. Confidence

High, medium or low, with the reasons listed. It drops when:

- the model's probability for `b` and the measured share disagree by more than a factor of 2 and
  more than 3 standard deviations of shot noise (low when the model gives too little: something
  outside the model is at work);
- fewer than 10 shots landed on `b`;
- the calibration is undated, is Rewind's stored one rather than the run's own, or is over 36 hours
  from the run;
- the effects don't add up (their sum is outside 70–130% of the modelled excess over noise-free):
  sources interact and the shares are approximate;
- some gates or readouts have no reported error (they count as perfect), or gate durations weren't
  captured (no decoherence in the model).

## Not modelled

Crosstalk, leakage, coherent (over- or under-rotation) errors, correlated readout errors, drift
between calibration and job, and idle decoherence before a qubit's first gate or after its last.
A large unexplained gap between model and measurement (see confidence) usually points at one of
these.

## Bounds

Exact simulation of a 4^n density matrix: up to `QLAB_WHY_MAX_QUBITS` active qubits (default 8, at
most 10) and 800 operations; total work (simulations × 4^n × instructions) up to `QLAB_WHY_MAX_WORK`
(default 2e9); one explanation at a time per server, `QLAB_WHY_TIME_LIMIT_S` seconds (default 30).
Larger runs get a plain refusal with the limits. Results are cached per run and calibration: one set
of simulations answers every outcome of that run, so the second click is instant.

Calibration data shown is as published by the machine's provider; Q-Lab is not affiliated with IBM.
