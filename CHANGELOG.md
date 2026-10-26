# Changelog

All notable changes to Q-Lab. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/). One version covers the backend,
the dashboard, the Docker images and the `qlab-sdk` Python package.

## [Unreleased]

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
