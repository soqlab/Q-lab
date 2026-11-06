# Changelog

All notable changes to Q-Lab. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/). One version covers the backend,
the dashboard, the Docker images and the `qlab-sdk` Python package.

## [Unreleased]

### Added
- SDK: calibration is also captured from `backend.target` (Qiskit 2 backends without
  `properties()`), in microseconds; shots are recorded for `backend.run` and the V2 primitives; a
  `setup_fingerprint` covers circuit, backend, transpiler options, shots and package versions; the
  circuit is stored as QPY before and after transpilation.
- `qlab ci check`: compares a run with a baseline by TVD against a shot-noise bound and writes
  JUnit XML for CI.
- CI runs ruff on `backend/` and `qlab_sdk/` (`ruff.toml`: syntax errors and undefined names).
- Tests for the core tracking API: runs, projects, compare, search, API keys, and checks that
  one user cannot read, change or delete another's runs.

### Changed
- Six Labs tools no longer return invented numbers. The XEB Certifier (was Advantage Certifier)
  scores each run's recorded counts with linear XEB against the exact ideal distribution of its
  stored circuit. Environment Snapshots show what the SDK recorded with each run. Backend Compare
  compares runs you recorded of the same circuit on different backends, instead of simulating
  them under the backends' names. Entanglement Map and Ideal State Analysis (was State
  Tomography) compute from the exact statevector of the circuit and say it is the ideal state,
  not a hardware measurement. Each response names its source, and none is marked illustrative.
- The run page's evolutionary optimizer panel (illustrative) shows only with Labs on.

### Removed
- Cost Arbitrage: its device error rates, T1, fidelity, queue times and availability were random.
  Cost Oracle quotes the published prices.
- The old `sdk/` folder: a stale duplicate of the `qlab-sdk` package (0.1.0) that pointed at a
  retired server. The SDK is `qlab_sdk/`.

### Security
- Projects were shared across every account: anyone could list all project names and rename or
  redescribe someone else's project. A project is now visible to its creator and to whoever can
  see a run in it; another user's slug is refused.
- The job API (`/api/v1/jobs`) had no sign-in check: anyone could list, read and cancel every user's
  jobs and circuits. It now requires an account and shows people only their own and their
  organisation's. Older jobs, which recorded no owner, are no longer listed.

### Fixed
- Quantum hardware prices were out of date, some wrong by orders of magnitude, and had no source.
  IonQ on Amazon Braket, for example, was priced at $0.00097 a shot. AWS charges $0.08 a shot plus
  $0.30 a task. Rigetti was priced at $0.00035 a shot; AWS charges $0.000425. All prices now come
  from one table, `backend/app/provider_prices.json`, and every router reads it: the cost
  estimate, Cost Oracle, cost tracker, cost arbitrage, job router, scheduler, providers, institute
  budget and lab assistant. Each entry names its source page and the day it was checked. Each
  estimate returns both, plus a warning once the price is more than 30 days old. If a provider
  (Quantinuum, IonQ direct) publishes no price, estimates say "not public" instead of a number.
- Q-Lab no longer invents DOIs. `doi`, `dataset-publish` and `fair-data` could return made-up DOIs
  that looked citable. A DOI now only appears after a repository issues one.
- Calibration forecasts come from the calibration recorded with your own runs. They used to be
  generated from a hash of the backend name, including a random R².
- Reproducibility checks crashed on every run, and now compare with a real simulation.
- `health-forecast` read fields the SDK doesn't send, so SDK runs produced no forecast.
- Cost Oracle no longer shows random queue times. Simulated hardware jobs run the actual circuit.
- IBM's old hosts no longer exist, so calibration, queue data, the job executor and the key check
  couldn't reach IBM. All of them now use IBM's client library with each user's own key.
- Real IBM Quantum job submission: the backend asked for the "ibm_quantum" channel, which IBM
  retired and the client refuses. Circuits are now also converted to the backend's own gates before
  submission, which IBM requires. Tested against a simulated backend, not yet on IBM's hardware.
- The circuit compiler always fell back to rule-based compilation because it called an API removed
  in Qiskit 1.0. It now really uses the Qiskit transpiler.
- Noise simulation, ZX simplification and circuit search refused any circuit containing `sx`, which
  every circuit transpiled for IBM has, and quietly returned less or nothing.
- Onboarding no longer offers the raw Render address as a fallback for the hosted API.

### Changed
- Pages whose numbers are simulated or sample data now say so in a visible notice, driven by the
  `X-QLab-Data: illustrative` response header. See `backend/app/illustrative.py`.
- Q-Lab has no server-wide IBM or IonQ key: `IBM_QUANTUM_TOKEN` and `IONQ_API_KEY` are no longer
  read. Each user saves their own key under Credentials.
- The backend runs on Qiskit 2.6, qiskit-aer 0.18 and qiskit-ibm-runtime 0.51, and uses IBM's new
  `IBMQuantumComputeService` name.
- A nightly CI job tests the SDK against the latest Qiskit release and its development branch.
- The SDK's anonymous install ping is sent only when it talks to the hosted service;
  self-hosted setups never contact SOQLAB. It reports the real SDK version.

## [0.3.0] - 2026-10-26

### Security
- Upgraded the dashboard to Next.js 16 and React 19. Next.js 14 had critical advisories,
  including unauthenticated remote code execution through the image optimiser, which is now
  also switched off.
- Runs are private to their owner and organisation. Previously any caller, signed in or not,
  could list every run through the API, and full-text search returned other users' runs.
  The rule is enforced for every query on runs, including hand-written SQL and the live
  run stream; shared links, the public gallery and README badges stay public.
- Any signed-in user could create a share link for another user's run; now only for your own.
- Replaced `python-jose` (unmaintained, with open advisories) with `PyJWT`. Existing sessions
  stay valid.
- Backend dependencies are pinned to tested versions. A fresh install had picked up a FastAPI
  release that stopped the backend from starting.

### Fixed
- SDK auto-tracking recorded nothing for `AerSimulator.run`, the reference
  `StatevectorSampler`/`StatevectorEstimator` and `BackendSamplerV2`. Every backend and
  primitive is now tracked once per execution, with per-circuit results, on Qiskit 1.x and 2.x.
- The SDK could not be installed from source with current setuptools.
- `qlab queue retry` could upload queued runs twice.
- The documented Docker quick start crashed on boot (`SECRET_KEY` instead of
  `QLAB_SECRET_KEY`), and its dashboard could not reach the backend.
- CSV/JSON exports, backend drift, run analyses (quantum volume, RCA, robustness,
  mitigation advice, AEMD, UAF-CPT) and similar-run recommendations returned server errors.
- Run, project, campaign, share and verify pages, the Analytics page and the admin panel's
  Analytics, Runs, AI Usage, Security and Activity tabs failed to load.
- Random proxy errors between the dashboard and the API (connection reuse on idle sockets).

### Added
- Labs: the dashboard shows the core experiment tracker by default; about 150 experimental
  tools are behind a Labs switch at the bottom of the menu.
- Single-service deployment (dashboard and API in one container) for Render; the two-service
  layout remains available.
- CI: SDK tests on Qiskit 1.x and 2.x, backend tests, frontend type check, lint and build,
  a clean-machine Docker quick start, and weekly dependency audits.
- `SECURITY.md` with a disclosure process, and Dependabot.

### Removed
- An unused `/qlab-api` route handler that buffered every response.
- The committed `python_installer.exe`.

[Unreleased]: https://github.com/soqlab/Q-lab/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/soqlab/Q-lab/releases/tag/v0.3.0
