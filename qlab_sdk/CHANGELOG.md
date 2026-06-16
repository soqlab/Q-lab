# Changelog

## [0.2.0] — 2026-06-15

### Added
- Persistent SQLite backend via `store.py`
- `qlab.create_campaign()` and `qlab.campaign_combinations()`
- Jupyter magic: `%load_ext qlab`, `%qlab runs`, `%qlab watch <id>`
- CLI commands: `qlab status`, `qlab runs`, `qlab push`, `qlab circuit-diff`
- Full Pydantic v2 support
- `py.typed` marker for mypy support

## [0.1.0] — 2026-06-07

### Added
- Initial release
- Passive Qiskit experiment tracking via `qlab.init()`
- Automatic circuit fingerprinting, calibration capture, result tracking
- `with qlab.run(qc) as r:` context manager
- Multi-provider support (IBM Quantum, IonQ, Braket, simulator)
