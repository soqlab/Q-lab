"""Rewind on the command line. Run from backend/:

    python -m app.rewind keygen                       a new QLAB_REWIND_SIGNING_KEY (printed once)
    python -m app.rewind status                       what is stored
    python -m app.rewind harvest                      harvest now (needs QISKIT_IBM_TOKEN)
    python -m app.rewind probe --machine ibm_fez --days 400 --step 7
                                                      how far back IBM's history goes (stores nothing)
    python -m app.rewind backfill [--machine ibm_fez] [--max-days 60]
    python -m app.rewind manifest --date 2026-11-14   build, sign and print that day's manifest
    python -m app.rewind run --machine ibm_fez --date 2026-11-14 --qasm file.qasm --shots 4000
                                                      replay a circuit (signed-in limits)
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date


def _db():
    from ..database import SessionLocal, init_db
    init_db()
    return SessionLocal()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.rewind", description="Q-Lab Rewind")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("keygen", help="print a new signing key for QLAB_REWIND_SIGNING_KEY")
    sub.add_parser("status", help="machines and snapshot counts")
    sub.add_parser("harvest", help="store today's calibration of every machine")
    p = sub.add_parser("probe", help="how far back IBM's calibration history goes (read-only)")
    p.add_argument("--machine", required=True)
    p.add_argument("--days", type=int, default=60)
    p.add_argument("--step", type=int, default=1)
    p.add_argument("--sleep", type=float, default=1.0)
    b = sub.add_parser("backfill", help="store past calibration, walking back day by day")
    b.add_argument("--machine")
    b.add_argument("--max-days", type=int)
    b.add_argument("--misses", type=int)
    m = sub.add_parser("manifest", help="build and print a day's manifest")
    m.add_argument("--date", required=True)
    r = sub.add_parser("run", help="replay a circuit on a machine as calibrated on a date")
    r.add_argument("--machine", required=True)
    r.add_argument("--date", required=True)
    r.add_argument("--qasm", help="OpenQASM 2/3 file")
    r.add_argument("--qpy", help="QPY file")
    r.add_argument("--shots", type=int, default=1024)
    r.add_argument("--seed", type=int)
    args = ap.parse_args(argv)

    if args.cmd == "keygen":
        from .signing import generate_key, parse_key
        key = generate_key()
        print(key)
        print(f"# key id {parse_key(key).key_id}. Set the line above as QLAB_REWIND_SIGNING_KEY; keep it secret.",
              file=sys.stderr)
        return 0

    from . import harvest as hv
    from . import store
    if args.cmd == "probe":
        if not hv.configured():
            print(hv.not_configured_reason())
            return 1
        backend = hv.hb._provider().backend(args.machine)
        rows = hv.probe(backend, days=args.days, step=args.step, sleep_s=args.sleep)
        for r in rows:
            print(f"{r['day']}  {r['calibrated_at'] or '-':22}  {'ok' if r['ok'] else 'miss'}  {r.get('error', '')}")
        ok = [r for r in rows if r["ok"]]
        print(f"# {len(ok)}/{len(rows)} days answered; oldest answered: {ok[-1]['day'] if ok else 'none'}")
        return 0
    with _db() as db:
        if args.cmd == "status":
            print(json.dumps(store.machines(db, include_simulated=hv.simulated()), indent=1))
        elif args.cmd == "harvest":
            print(json.dumps(hv.harvest(db), indent=1))
        elif args.cmd == "backfill":
            print(json.dumps(hv.backfill(db, machine=args.machine, max_days=args.max_days, miss_limit=args.misses),
                             indent=1))
        elif args.cmd == "run":
            from .replay import ReplayError, replay
            if bool(args.qasm) == bool(args.qpy):
                print("give one of --qasm or --qpy", file=sys.stderr)
                return 2
            if args.qasm:
                text, fmt = open(args.qasm, encoding="utf-8").read(), "qasm"
            else:
                import base64
                text, fmt = base64.b64encode(open(args.qpy, "rb").read()).decode("ascii"), "qpy"
            try:
                out = replay(db, args.machine, date.fromisoformat(args.date), text, fmt, args.shots, args.seed,
                             signed_in=True, include_simulated=hv.simulated())
            except ReplayError as exc:
                print(exc.message, file=sys.stderr)
                return 1
            print(out["label"], file=sys.stderr)
            print(json.dumps(out, indent=1))
        elif args.cmd == "manifest":
            print(json.dumps(store.build_manifest(db, date.fromisoformat(args.date)), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
