"""Rewind: run a circuit on a replica of a quantum computer as it was calibrated on a past day.

    snapshot.py  one machine's calibration as canonical JSON
    store.py     files under QLAB_REWIND_DIR, the machine_snapshots index, signed daily manifests
    signing.py   the server's Ed25519 + ML-DSA-65 key (QLAB_REWIND_SIGNING_KEY)
    verify.py    the manifest format and its check; runs on its own
    harvest.py   the daily harvest and the backfill
    replay.py    the replica: an Aer noise model from a snapshot, and the run
    __main__.py  the command line (python -m app.rewind --help)

Rewind never runs anyone's circuit on real hardware, and never publishes the stored calibration:
only manifests (hashes, machine names, dates, signature) and per-day medians are public.
"""
