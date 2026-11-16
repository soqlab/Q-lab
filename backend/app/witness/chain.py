"""Hash chains: append to a local store, and check a whole sequence of receipts."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from .canonical import loads_strict
from .keys import KeysDocument, SigningKey
from .receipt import receipt_digest, schema_errors
from .sign import next_link, seal
from .verify import verify


@dataclass(frozen=True)
class Head:
    seq: int
    digest: str

    def __str__(self) -> str:
        return f"{self.seq}:{self.digest}"

    @classmethod
    def parse(cls, text: str) -> Head:
        seq, _, digest = text.partition(":")
        if not seq.isdecimal() or not digest:
            raise ValueError("a head is written as <seq>:<digest>")
        return cls(int(seq), digest)


@dataclass(frozen=True)
class ChainIssue:
    code: str
    seq: int | None
    reason: str


@dataclass
class ChainReport:
    count: int = 0
    head: Head | None = None
    issues: list[ChainIssue] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return not self.issues

    def to_dict(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "count": self.count,
            "head": asdict(self.head) if self.head else None,
            "issues": [asdict(issue) for issue in self.issues],
        }


def verify_chain(
    receipts: Iterable[dict[str, Any]],
    keys: KeysDocument | None = None,
    *,
    known_head: Head | None = None,
    complete: bool = True,
) -> ChainReport:
    """Check a sequence of receipts for gaps, forks, breaks and rollback.

    With keys, every receipt's signatures are checked too. Set complete=False for a
    run of receipts that does not begin at seq 1, as one tenant sees on a shared chain.
    A chain cannot reveal its own truncation, so pass known_head to detect it.
    """
    report = ChainReport()
    by_seq: dict[int, dict[str, Any]] = {}
    for receipt in receipts:
        errors = schema_errors(receipt)
        if errors:
            seq = receipt.get("chain", {}).get("seq") if isinstance(receipt, dict) else None
            report.issues.append(
                ChainIssue("invalid_receipt", seq if isinstance(seq, int) else None, errors[0])
            )
            continue
        seq = int(receipt["chain"]["seq"])
        existing = by_seq.get(seq)
        if existing is not None:
            if receipt_digest(existing) != receipt_digest(receipt):
                report.issues.append(
                    ChainIssue("fork", seq, f"two different receipts have seq {seq}")
                )
            continue
        by_seq[seq] = receipt

    previous: dict[str, Any] | None = None
    for seq in sorted(by_seq):
        receipt = by_seq[seq]
        report.count += 1
        if keys is not None:
            failed = verify(receipt, keys).failed
            if failed:
                report.issues.append(
                    ChainIssue("invalid_receipt", seq, f"failed checks: {', '.join(failed)}")
                )
        if previous is None:
            if complete and seq != 1:
                report.issues.append(ChainIssue("bad_start", seq, f"chain begins at seq {seq}"))
        else:
            _check_link(report, previous, receipt)
        previous = receipt

    if previous is not None:
        report.head = Head(int(previous["chain"]["seq"]), receipt_digest(previous))
    _check_anchors(report, by_seq)
    if known_head is not None:
        _check_known_head(report, by_seq, known_head)
    return report


def _check_anchors(report: ChainReport, by_seq: dict[int, dict[str, Any]]) -> None:
    for seq, receipt in sorted(by_seq.items()):
        if receipt["kind"] != "witness.anchor":
            continue
        head = receipt["subject"]["head"]
        anchored = by_seq.get(int(head["seq"]))
        if anchored is not None and receipt_digest(anchored) != head["digest"]:
            report.issues.append(
                ChainIssue(
                    "anchor_mismatch",
                    seq,
                    f"anchor covers another receipt at seq {head['seq']}: history was rewritten",
                )
            )


def _check_link(report: ChainReport, previous: dict[str, Any], receipt: dict[str, Any]) -> None:
    seq, before = int(receipt["chain"]["seq"]), int(previous["chain"]["seq"])
    if seq != before + 1:
        report.issues.append(ChainIssue("gap", seq, f"seq jumps from {before} to {seq}"))
    elif receipt["chain"]["prev"] != receipt_digest(previous):
        report.issues.append(
            ChainIssue("broken_link", seq, f"chain.prev does not match receipt {before}")
        )
    if receipt["issuer"]["name"] != previous["issuer"]["name"]:
        report.issues.append(ChainIssue("issuer_changed", seq, "issuer.name changed"))
    if receipt["chain"].get("id") != previous["chain"].get("id"):
        report.issues.append(ChainIssue("chain_changed", seq, "chain.id changed"))
    if receipt["issued_at"] < previous["issued_at"]:
        report.issues.append(
            ChainIssue("time_rollback", seq, "issued_at is earlier than the previous receipt's")
        )


def _check_known_head(report: ChainReport, by_seq: dict[int, dict[str, Any]], known: Head) -> None:
    receipt = by_seq.get(known.seq)
    if receipt is None:
        latest = report.head.seq if report.head else 0
        report.issues.append(
            ChainIssue(
                "truncated", known.seq, f"known head is seq {known.seq}, chain ends at {latest}"
            )
        )
    elif receipt_digest(receipt) != known.digest:
        report.issues.append(
            ChainIssue("fork", known.seq, "the receipt at the known head has a different digest")
        )


class ChainStore:
    """A SQLite file holding one issuer's receipts, for the CLI and small deployments."""

    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        self._db = sqlite3.connect(self.path, isolation_level=None)
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS receipts ("
            "seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, "
            "digest TEXT NOT NULL, body TEXT NOT NULL)"
        )

    def close(self) -> None:
        self._db.close()

    def __enter__(self) -> ChainStore:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @contextmanager
    def _write(self) -> Iterator[None]:
        self._db.execute("BEGIN IMMEDIATE")
        try:
            yield
        except BaseException:
            self._db.execute("ROLLBACK")
            raise
        self._db.execute("COMMIT")

    def head_receipt(self) -> dict[str, Any] | None:
        row = self._db.execute("SELECT body FROM receipts ORDER BY seq DESC LIMIT 1").fetchone()
        return loads_strict(row[0]) if row else None

    def append(self, build: Callable[[int, str | None], dict[str, Any]]) -> dict[str, Any]:
        """Atomically build the next receipt at the next chain position and store it."""
        with self._write():
            seq, prev = next_link(self.head_receipt())
            receipt = build(seq, prev)
            self._db.execute(
                "INSERT INTO receipts (seq, id, digest, body) VALUES (?, ?, ?, ?)",
                (seq, receipt["id"], receipt_digest(receipt), json.dumps(receipt)),
            )
        return receipt

    def seal(self, kind: str, subject: dict[str, Any], key: SigningKey) -> dict[str, Any]:
        return self.append(lambda seq, prev: seal(kind, subject, key, seq=seq, prev=prev))

    def all(self) -> list[dict[str, Any]]:
        rows = self._db.execute("SELECT body FROM receipts ORDER BY seq").fetchall()
        return [loads_strict(row[0]) for row in rows]
