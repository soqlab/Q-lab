# Contributing to Q-Lab

Thanks for your interest. Q-Lab is MIT-licensed and welcomes contributions.

## Ways to contribute

- **Bug reports** — open a GitHub Issue with steps to reproduce
- **Feature requests** — open an Issue describing the use case
- **Pull requests** — fork, make your change, open a PR

## Development setup

Follow the Quick Start in [README.md](README.md). The full stack (backend + frontend + SDK) runs locally with no external dependencies in dev mode.

## Pull request process

1. Fork the repo and create a branch from `main`
2. Make your change — one focused thing per PR
3. Test it locally end-to-end
4. Open a PR with a short description of what it does and why

There are no automated CI checks yet, so include a note on how you tested.

## Where things live

| Area | Location |
|---|---|
| New API endpoint | `backend/app/routers/<feature>.py` + register in `main.py` |
| New frontend page | `frontend/app/(main)/<page>/page.tsx` + add to `SideNav.tsx` |
| Quantum provider | `backend/app/backends.py` — add one entry to `QUANTUM_BACKENDS` |
| SDK behaviour | `qlab_sdk/qlab/` |

## Code style

- **Python**: follow the existing patterns; `ruff` formatting if you have it
- **TypeScript**: no strict rules, but match the style of surrounding code
- No new comments unless the *why* is non-obvious

## Security issues

Please do not open a public Issue for security vulnerabilities. Email `contact@soqlab.com` instead.
