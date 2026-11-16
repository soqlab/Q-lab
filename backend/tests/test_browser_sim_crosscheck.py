"""The browser simulator (/try) is checked against the server's ideal simulation.

frontend/lib/sim/crosscheck.json holds circuits and their exact outcome probabilities. This test
recomputes them with app.local_sim.ideal_probabilities (Qiskit's Statevector) and requires the file
to agree within 1e-9; frontend/scripts/test-sim.mjs requires the browser engines to agree with the
file within 1e-6. With QLAB_WRITE_CROSSCHECK=1 the file's numbers are rewritten instead. Circuits above
the server's 20-qubit exact limit (the GPU engine goes to 24) are checked against known answers in
the frontend test instead.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from app import local_sim

FIXTURE = Path(__file__).resolve().parents[2] / "frontend" / "lib" / "sim" / "crosscheck.json"


def _cases() -> list[dict]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def test_fixture_present_and_complete() -> None:
    cases = _cases()
    assert len(cases) >= 10
    assert {"example:bell", "example:ghz", "example:grover", "example:qft"} <= {c["name"] for c in cases}


@pytest.mark.parametrize("case", _cases(), ids=lambda c: c["name"])
def test_probabilities_are_the_servers(case: dict) -> None:
    got = local_sim.ideal_probabilities(case["qasm"])
    if os.getenv("QLAB_WRITE_CROSSCHECK") == "1":
        doc = json.loads(FIXTURE.read_text(encoding="utf-8"))
        for c in doc["cases"]:
            if c["name"] == case["name"]:
                c["probabilities"] = {k: round(v, 15) for k, v in sorted(got.items())}
        FIXTURE.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8", newline="\n")
        return
    want = case["probabilities"]
    assert want, "no numbers yet: run with QLAB_WRITE_CROSSCHECK=1"
    for key in set(got) | set(want):
        assert abs(got.get(key, 0.0) - want.get(key, 0.0)) <= 1e-9, key
