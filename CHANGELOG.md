# Changelog

All notable changes to Q-Lab. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/). One version covers the backend,
the dashboard, the Docker images and the `qlab-sdk` Python package.

## [Unreleased]

### Added
- Ask your assistant: `qlab-mcp` (`pip install "qlab-sdk[mcp]"`), a read-only MCP server that runs
  on your machine over stdio, so your own AI assistant can list your runs, summarise or compare
  them, say why an outcome happened or why a run got worse, show a run across time and its
  forecast, and read the hardware board and Rewind's history. Each tool is one `GET` with your own
  key, under the same ownership checks as the dashboard. API keys now have a scope: tick
  "Read-only" in Settings, API keys. A read-only key can only `GET` (anything else is refused before
  it reaches an endpoint), and requests marked `X-Client: mcp/<tool>` need one: full keys and
  sign-in tokens are refused with a message saying how to make one. Each tool call is written to
  the audit log (`mcp.tool_call`: tool, key id and prefix, path, status; never the key or the
  answer). Setup in `docs/ASK_YOUR_ASSISTANT.md`.
- "Why this outcome?" on a run's page: pick a bar in "What was measured" and Q-Lab names the error
  sources that make that outcome likely ("Qubit 2's readout error (8.0%) explains ~70% of this
  outcome in the model"), with a confidence level and its reasons, and highlights them on the
  qubits and couplers around the run. It builds a noise model from the run's own calibration (or
  Rewind's stored one from within 36 hours) and removes one source at a time: readout per qubit,
  each two-qubit coupler, single-qubit gates per qubit, T1/T2 per qubit. Exact density-matrix
  simulation, bounded (8 qubits, 800 operations, 30 s by default) and cached per run. Without a
  calibration from that day or the compiled circuit it says what's missing instead of guessing.
  `GET /api/v1/runs/{run_id}/why?outcome=…`; method in `docs/WHY_METHOD.md`.
- Rewind's screen, `/rewind`, open without an account (a new Rewind channel in the top bar and in
  Ctrl K). Pick a machine, slide over the days that machine has a stored calibration for (it shows
  which calibration that day uses), paste or drop a circuit or take an example (Bell, GHZ-5, a QFT
  round trip), and Run (Ctrl+Enter). The answer comes first ("On ibm_fez as of 3 Oct 2026, your
  Bell circuit gave 00/11 in 94% of shots…"), then the counts (top 12 and "other", with the
  noiseless probability marked), the IBM label, the accuracy note as the API gives it, the
  calibration's sha256 (copyable), software versions, and what isn't modelled (behind the dial).
  With no IBM key the page says collection hasn't started and shows nothing invented.
- Compare across time: the same circuit on one calibration per month, up to 12 months, run one
  after another on the server (`POST /api/v1/rewind/compare`, poll `GET /api/v1/rewind/compare/{job}`)
  and drawn as a line of Hellinger fidelity, or share of shots on the noiseless outcomes.
- `POST /api/v1/rewind/run` also returns `ideal`: the Hellinger fidelity against the noiseless
  distribution (exact, from Aer's statevector, capped like the replay) and the share of shots on
  the outcomes the noiseless circuit can give. A circuit that measures part-way says why there is none.
- QPU Watch, a tab on `/rewind`: each machine's latest median T1, T2, two-qubit and readout error,
  with sparklines over 30 days, 90 days or a year, led by a sentence ("ibm_fez's two-qubit error is
  the lowest it's been in 30 days"). `GET /api/v1/rewind/watch` gives medians only, never a
  calibration's contents; `GET /api/v1/rewind/machines/{machine}/days` lists the stored days.
- "Rewind this run" on a run's page (Actions and Ctrl K) when its backend is a machine Rewind has
  calibration for: opens `/rewind` with that machine, the run's day and its circuit.
- Signed in, "Save this to Q-Lab" keeps a replay as a run (`POST /api/v1/rewind/save`): replayed
  again on the server, so the counts can't be edited, with backend `rewind:<machine>`, tags
  `rewind` and `simulated`, and the calibration's sha256; its page says it is a replay, not hardware.
- Provenance certificate for every run (run page Actions menu and Ctrl+K: "Certificate";
  `GET /api/v1/runs/{id}/certificate`, `?download=1` for the `.json`): a signed statement, schema
  `qlab-provenance-certificate/1`, of the circuit hashes (as stored, as given to `transpile()`, as
  compiled: QPY and QASM), the machine, a hash of the calibration recorded with the run plus the
  matching Rewind snapshot's sha256 when one is stored, package and Python versions, transpiler
  settings, seeds, shots, a hash of the counts, the run record's digest from /verify, and how its
  re-runs compared. Hashes and settings only; nothing about the uploader. Signed with Ed25519 +
  ML-DSA-65 by `QLAB_CERT_SIGNING_KEY`, or Rewind's `QLAB_REWIND_SIGNING_KEY` when that is not set
  (public key at `/api/v1/certificates/public-key`). Owner only, or anyone once the run is shared.
  Checked offline by `backend/app/provenance/verify.py` (standard library + `cryptography`, served at
  `/api/v1/certificates/verify.py`; how-to in SELF_HOSTING.md) and in the browser, with
  @noble/post-quantum 0.7.1 and @noble/curves 2.4.0 vendored from `tools/pq-verify-js` (no CDN).
  `/certificate` checks any saved certificate file without uploading it.
- Reproduced badge: a shared run gets `/verified/<share token>`, answer first ("Reproduced: 2
  independent re-runs agreed within shot noise (TVD ≤ 0.02). Certificate verified in your
  browser."), and `/verified/<share token>/badge.svg` with Markdown, HTML and LaTeX
  (`\href{...}{Reproduced on Q-Lab}`) to copy (run page: "Badge for your paper"). The badge shows the
  current state honestly: reproduced, reproduced 2/3, didn't reproduce, or not yet reproduced. Re-runs
  that count are the owner's and other accounts' shared ones, so a stranger can't add or remove a
  "reproduced". Unsharing takes the page and the badge down.
- **Rewind accuracy.** Once a week the server runs a fixed 20-circuit benchmark (`rewind-bench-1`) on a few
  real IBM machines, replays the same compiled circuits on the replica of the calibration in force when
  each job ran, and publishes the Hellinger fidelity between the two (`GET /api/v1/rewind/accuracy`,
  method in `docs/REWIND_METHOD.md`). Replays now say how well their machine matched, or that it
  hasn't been measured. The hardware board and the benchmark share one QPU budget per 28 days.

## [0.4.0] - 2026-11-14

The first `qlab-sdk` on PyPI since 0.1.0: 0.3.0 was prepared but never tagged or published, so
its changes (below) ship in this release too. What you get:

- **Passkey-only sign-in.** No passwords: sign up with a passkey and a name (email optional),
  with one-time recovery codes. Older password and Google/GitHub accounts move to a passkey once.
- **Answer first.** Every run opens with one sentence on whether it did better or worse than
  the last comparable run, and why; projects have a timeline you drag through; Ctrl K finds
  any run, circuit, project or backend.
- **Pick the machine before you run.** Paste a circuit and see the expected result on each IBM
  machine from its current calibration, with the weak point named.
- **Drift alarm.** When the same circuit on the same backend moves beyond shot noise, the run
  says so and whether your side or the machine changed.
- **Reproduce a run** with one command (`uv run reproduce_<id>.py`), pinned to the recorded
  circuit, package versions, seeds and settings, and see whether the re-run agreed.
- **Your data.** Deleting an account erases it after 7 days; the export holds everything kept
  about you; shared runs can be unshared; integration secrets are stored encrypted; a plain
  privacy notice and terms; the dashboard tracks nothing and loads nothing from other sites.
- **SDK.** Amazon Braket and IonQ capture, seeds and calibration from Qiskit 2 targets, QPY
  circuits, `qlab ci check`; Aer's `SamplerV2` (and runtime local mode) is recorded once, not
  twice; no install ping for self-hosted setups.
- **Rewind, part 1.** Given an IBM key, the server archives every IBM machine's calibration once
  a day, and back through IBM's history, with signed daily manifests: the record that will
  answer "what was the machine like when my run ran".
- **No invented numbers.** Every Labs tool computes from your runs, exact simulation or your
  input, or it was removed; hardware prices come from one sourced table.

### Added
- Rewind, part 2: the replica (`app/rewind/replay.py`, `POST /api/v1/rewind/run`, no account needed,
  and `python -m app.rewind run --machine ibm_fez --date 2026-11-14 --qasm file.qasm --shots 4000`).
  The calibration stored nearest the date (the answer says which, and how many days off) becomes an
  Aer noise model: thermal relaxation from T1/T2 over each gate's duration, depolarizing for the
  rest of the reported gate error, and (asymmetric where reported) readout error. The circuit
  (OpenQASM 2/3 or base64 QPY) is compiled for that day's coupling map and errors with fixed seeds,
  only the qubits it touches are simulated, and the counts come back with the snapshot's sha256,
  the software versions and a noise model summary, labelled "Simulated from IBM-published
  calibration of <machine> as of <date>; not affiliated with or endorsed by IBM." `accuracy` is
  null until it is measured. Limits: 20 qubits after compiling, 8192 shots signed in and 4096
  without an account, a work bound, one replay at a time, 60 s, per-address rate limit (all env
  settings, see SELF_HOSTING.md). Nothing runs on real hardware.
- Rewind, part 1: the calibration harvester (`app/rewind/`). Once a day, for every IBM machine the
  server's `QISKIT_IBM_TOKEN` sees, it stores the calibration (qubits, coupling map, basis gates,
  T1/T2, readout errors and durations, gate errors and durations, `last_update_date`, the useful
  parts of the configuration) as one gzip-compressed canonical JSON file per calibration under
  `QLAB_REWIND_DIR`, indexed in `machine_snapshots` (migration `009_rewind_snapshots`); repeats are
  skipped. Each UTC day gets a manifest of file hashes, signed with Ed25519 + ML-DSA-65 when
  `QLAB_REWIND_SIGNING_KEY` is set (`GET /api/v1/rewind/manifests/{date}`, checked by
  `backend/app/rewind/verify.py`, which runs on its own). A backfill walks back through IBM's
  calibration history (`properties(datetime=)`) and starts by itself as soon as there is a key;
  `python -m app.rewind probe` shows how far back it goes. `GET /api/v1/rewind/machines` says what
  is collected, or that nothing is because there is no key. The calibration files themselves are
  never served.
- Privacy notice at `/privacy` (linked from the sign-in pages, the app footer, the home page and
  Ctrl+K): what the hosted Q-Lab keeps, what the SDK sends, what is stored in the browser, who else
  receives data, retention and deletion, contact.
- Reproduce this run (every run page, Ctrl+K, `GET /api/v1/runs/{id}/reproduce`, `.../reproduce.py`,
  `.../reproduce.ipynb`): one command, `uv run reproduce_<id>.py`, re-runs the run with the recorded
  circuit (QPY of the circuit given to `transpile()` when recorded), the recorded qiskit,
  qiskit-ibm-runtime and qiskit-aer versions and Python minor version (pinned in the script's PEP 723
  header; a `pip install` line and a notebook cell too), the transpiler settings, seeds, backend and
  shots. `--as-compiled` runs the exact compiled circuit instead. The page says plainly what can't
  be pinned (hardware noise, queue time, layout on recalibrated hardware, anything unseeded) and
  what wasn't recorded. The re-run is uploaded tagged as a reproduction (`qlab.init(reproduces=...)`,
  `qlab.reproducing()` or `QLAB_REPRODUCES`), and both runs' pages and the project timeline say
  whether it agreed: "Reproduced: results agree within shot noise (TVD 0.01)" or "Didn't reproduce:
  … — the machine's calibration changed: …", with drift.py's shot-noise test and attribution
  (`app/reproduce.py`). `rerun.py` and the bundles now carry this script. Migration
  `007_reproductions` adds `runs.reproduction_of`.
- SDK: records seeds set on the primitive or backend object (`StatevectorSampler(seed=)`, Aer's
  `SamplerV2(seed=)`, runtime `options.simulator.seed_simulator`, `AerSimulator(seed_simulator=)`),
  which primitive ran the circuit (`execution.primitive`), and the settings and circuits of
  `generate_preset_pass_manager(...).run()` like `transpile()`.
- Sign-in: when the browser returns no passkey (NotAllowedError: none found or the prompt closed,
  which the browser doesn't distinguish), the page says so and offers email and password, creating
  an account, a phone passkey and a recovery code, instead of a generic error.
- Pick the machine before you run (`/hardware/pick`, Ctrl+K, and "Where should I run this next?"
  on a run page): paste or drop an OpenQASM 2/3 circuit, or take one of your runs', and the page
  answers which IBM machine to use, e.g. "On ibm_a expect ≈0.84; on ibm_b ≈0.71: qubit 3's
  readout error on ibm_b is the weak point." The circuit is compiled for each machine against a
  target rebuilt from the calibration the hardware board reads, and scored as gate × readout ×
  idle-decoherence factors (`app/machine_pick.py`); labelled as an estimate from calibration at
  the stated time. Without `QISKIT_IBM_TOKEN` it says there is no calibration and estimates
  nothing. `POST /api/v1/machine-pick` needs a signed-in caller, is rate-limited and bounded
  (40 qubits, 4000 operations, 30 s, two at a time).
- Drift alarm (`GET /api/v1/runs/{id}/drift`, the run page's answer and the project timeline):
  when the same circuit runs again on the same backend and the counts move beyond shot noise
  (p < 0.01), it says so and whether your side (compiled circuit, transpiler settings, package
  versions) or the machine (recorded calibration of the qubits used) changed, or that it can't
  tell without calibration snapshots (`app/drift.py`). No migration.
- Passkeys (WebAuthn). The sign-in page is one "Sign in with passkey" button (with passkey
  autofill); sign-up creates a passkey, never a password; Settings lists, renames, adds and
  removes passkeys (never the last one). Google and GitHub sign-in stay unless passkeys only is on. With
  `QLAB_PASSKEYS_ONLY=true` (set on the hosted service) no password is set, reset or accepted:
  a password user signs in with the password once more and must add a passkey, which deletes the
  password; "forgot password" emails a single-use 15-minute link that registers a new passkey;
  creating or revoking API keys needs a session that signed in with a passkey. SDK API keys work
  as before. Migration `004_passkeys` adds the `passkey_credentials` and `webauthn_challenges`
  tables.
- SDK: Amazon Braket and IonQ adapters (`pip install qlab-sdk[braket]`, `qlab-sdk[ionq]`), hooked
  by `qlab.init()` when installed. Braket `device.run`/`run_batch` (LocalSimulator, AwsDevice)
  record the OpenQASM 3 circuit, shots, device ARN/type/noise model, calibration from the device
  properties, task id and counts; qiskit-ionq runs add the device, noise model and IonQ
  characterization. Tested in CI on Braket's LocalSimulator, a fake AwsSession and a local
  stand-in for the IonQ API; not yet run against AWS or IonQ cloud devices.
- Runs returned by the API carry `provider` and `device` (from the SDK's provider adapters); the
  run page shows them.
- Weekly "Provider Price Check" workflow (`scripts/check_prices.py`): compares the price table
  with the AWS Braket, Azure Quantum, IBM Quantum and IQM pricing pages, fails with an `::error`
  per changed price and warns for any page it could not read. Entries record the URL checked and
  the retrieval date (`price_check`).
- SDK: calibration is also captured from `backend.target` (Qiskit 2 backends without
  `properties()`), in microseconds; shots are recorded for `backend.run` and the V2 primitives; a
  `setup_fingerprint` covers circuit, backend, transpiler options, shots and package versions; the
  circuit is stored as QPY before and after transpilation.
- `qlab ci check`: compares a run with a baseline by TVD against a shot-noise bound and writes
  JUnit XML for CI.
- CI runs ruff on `backend/` and `qlab_sdk/` (`ruff.toml`: syntax errors and undefined names).
- Tests for the core tracking API: runs, projects, compare, search, API keys, and checks that
  one user cannot read, change or delete another's runs.
- Answer first: a run opens with one sentence comparing it with the latest earlier run of the
  same circuit (share of shots on the outcomes the noise-free circuit can produce; shot noise
  decides whether a change is real, and a cause is named only when calibration or the compiled
  circuit accounts for it), then the evidence (`GET /api/v1/runs/{id}/answer`). Project timelines
  (`/projects/<slug>/timeline`), `/compare?a=&b=` links, a "how technical" dial (plain, standard,
  expert), and a command bar (Ctrl K, Cmd K or /) that recognises run ids, circuit hashes,
  projects, backends and circuit names (`GET /api/v1/lookup`).
- Why two runs differ (`GET /api/v1/runs/{a}/explain-diff/{b}`, the compare page): shot noise,
  compiler or setup changes, or calibration drift on the qubits used, or that the data can't tell.
- Verify this run (`/verify/<id>`, `GET /api/v1/runs/{id}/verify`): checks anyone can repeat
  (circuit hash, counts against shots, the headline result, the record's SHA-256), each shown as
  pass, fail or can't check.
- Hardware board (`/hardware`): IBM Quantum machines' state, queue and calibration, and a
  scheduled benchmark whose results are ordinary shared runs. Migration `006_hardware_board`.
- Accounts without email: sign-up asks for a passkey and a display name; ten single-use recovery
  codes; the email address is optional (`PUT /auth/me/email`). Migration
  `005_usernameless_accounts`.
- Stop sharing a run from its page (`DELETE /api/v1/runs/{id}/share`).
- Terms page at `/terms`; a `/trust` page showing the commit each half runs, every request the
  page makes and the CSP as sent; `GET /api/v1/build`.
- Reproducible dashboard build (CI builds twice and fails on any difference) and a public,
  signed deploy log on the `transparency` branch.
- Offline install inside a company network (`deploy/internal`): one-file bundle, the company's
  own HTTPS certificate, no outbound connections.
- Signed releases: build provenance for every release file, keyless cosign signatures on the
  images, CycloneDX SBOMs.

### Changed
- With `QLAB_PASSKEYS_ONLY`, Google and GitHub no longer sign anyone in or create accounts. An account
  made with them before passkeys uses them once ("Made your account with Google or GitHub?" on the
  sign-in page) to reach a 15-minute token that only registers its first passkey, as a password
  sign-in does; once it has a passkey they are refused for it. A new email address is refused with
  a pointer to passkey sign-up. With the setting off they work as before. No migration.
- Deleting an account now also stops its SDK API keys (they kept uploading runs).
- Six Labs tools no longer return invented numbers. The XEB Certifier (was Advantage Certifier)
  scores each run's recorded counts with linear XEB against the exact ideal distribution of its
  stored circuit. Environment Snapshots show what the SDK recorded with each run. Backend Compare
  compares runs you recorded of the same circuit on different backends, instead of simulating
  them under the backends' names. Entanglement Map and Ideal State Analysis (was State
  Tomography) compute from the exact statevector of the circuit and say it is the ideal state,
  not a hardware measurement. Each response names its source, and none is marked illustrative.
- The run page's evolutionary optimizer panel (illustrative) shows only with Labs on.
- No tool returns invented numbers any more: the illustrative list is empty. Labs tools now compute
  from a stated source: the user's recorded runs (XEB, advantage analysis, error budget, Methods
  section, run optimizer), exact simulation of the user's circuit or model (Hamiltonian spectrum,
  Clifford tableau, tensor network, QAOA, VQE landscape, optimizer comparison, Trotter evolution,
  unitary synthesis, QKD protocols), or rules on the user's input (physics checks, FAIR score,
  causal analysis). A figure that is not recorded or supplied is reported as missing, never
  defaulted. Sample people, circuits, claims and graphs are no longer created, and old ones are
  removed.
- The talent board requires sign-in and shows a profile's email only to its owner.
- Pages whose numbers are simulated or sample data now say so in a visible notice, driven by the
  `X-QLab-Data: illustrative` response header. See `backend/app/illustrative.py`.
- Q-Lab has no server-wide IBM or IonQ key: `IBM_QUANTUM_TOKEN` and `IONQ_API_KEY` are no longer
  read. Each user saves their own key under Credentials.
- The backend runs on Qiskit 2.6, qiskit-aer 0.18 and qiskit-ibm-runtime 0.51, and uses IBM's new
  `IBMQuantumComputeService` name.
- A nightly CI job tests the SDK against the latest Qiskit release and its development branch.
- The SDK's anonymous install ping is sent only when it talks to the hosted service;
  self-hosted setups never contact SOQLAB. It reports the real SDK version.
- Deleting an account (Settings or the GDPR page) locks it at once, turns off its share links
  and erases it 7 days later: runs, projects nobody else uses, keys, passkeys, webhooks and the
  rest; the security log keeps a pseudonym. Signing in before then cancels it. It used to only
  switch the account off.
- The data export holds everything kept about the account (never keys, hashes or secrets), is
  built when downloaded, and only the person who asked can download it.
- The dashboard no longer records page views and loads nothing from other sites; the CSP allows
  only Q-Lab, and CI fails if that changes.
- The sidebar is gone: one bar holds Runs, Projects, Hardware, Compare, the input, the dial and
  the account. The signed-out home page shows live server state and public runs instead of
  decoration. Public run lists show the share of shots on expected outcomes instead of a
  "quality" score.
- The GDPR "compliance report", which claimed things that were not true, is removed; the GDPR
  page links to the privacy notice.

### Removed
- Cost Arbitrage: its device error rates, T1, fidelity, queue times and availability were random.
  Cost Oracle quotes the published prices.
- 48 Labs tools whose results could not be made real with the data Q-Lab has (random draws,
  canned replies, invented device tables or sample records), among them the RB/GST/SPAM, ZNE/PEC,
  tomography, QV, mirror-circuit and DD tools, the chat copilots, community leaderboards and
  marketplaces, the HPC bridge, offline export, paper and grant drafting, and the transpiler hub.
  Real counterparts are listed in each commit.
- The old `sdk/` folder: a stale duplicate of the `qlab-sdk` package (0.1.0) that pointed at a
  retired server. The SDK is `qlab_sdk/`.

### Security
- Slack, Teams and GitHub tokens, webhook and CI signing secrets and notification channel
  addresses were stored in plain text; they are now encrypted with the key vault's key
  (migration `008_encrypt_integration_secrets`).
- Webhooks, notification channels and the records of about 20 tools were one pool for every
  caller, often without sign-in; they now belong to their creator (or organisation), and events
  go only to channels whose owner can see the run.
- Gate angles in user QASM no longer go through `eval()`. User-supplied URLs (AI endpoints,
  webhooks, notification channels, calibration peers) must resolve to public addresses
  (`QLAB_ALLOW_PRIVATE_URLS=1` for a company install). OAuth sign-in uses state and PKCE.
- Projects were shared across every account: anyone could list all project names and rename or
  redescribe someone else's project. A project is now visible to its creator and to whoever can
  see a run in it; another user's slug is refused.
- The job API (`/api/v1/jobs`) had no sign-in check: anyone could list, read and cancel every user's
  jobs and circuits. It now requires an account and shows people only their own and their
  organisation's. Older jobs, which recorded no owner, are no longer listed.

### Fixed
- SDK: Aer's `SamplerV2`, and qiskit-ibm-runtime's local mode, which uses it, recorded each run
  twice (its inner `backend.run` call runs on a worker thread). It is now one run.
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

[Unreleased]: https://github.com/soqlab/Q-lab/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/soqlab/Q-lab/releases/tag/v0.4.0
[0.3.0]: https://github.com/soqlab/Q-lab/tree/8c1f44c044dee10355ec149498f8cffc3aaaf5e8
