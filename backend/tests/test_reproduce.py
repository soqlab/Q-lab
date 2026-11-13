"""Reproduce this run (app/reproduce.py, app/routers/reproduce.py).

The script is generated from what the SDK recorded (versions, circuit, transpiler settings, seeds,
backend, shots), and actually re-runs the run: here it is executed against Qiskit with a stand-in
for the qlab package, and gives the original's counts exactly when everything is seeded. Uploads
tagged as a reproduction are compared with the original (drift.py's test and attribution), and only
within the caller's own runs.
"""
import base64
import contextlib
import hashlib
import io
import json
import sys
import types
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from qiskit import QuantumCircuit, qasm2, qpy, transpile

from app import drift
from tests.helpers import BELL as BELL_QASM, client, make_user
from tests.test_explain_diff import BELL, NOISY_BELL, bell_on, calibration, record, sample

VERSIONS = {"qiskit": "2.6.2", "qiskit-aer": "0.18.2", "qiskit-ibm-runtime": "0.51.0", "qlab-sdk": "0.3.0"}


@pytest.fixture(autouse=True)
def _clean():
    drift.reset_cache()
    yield


def _at(days_ago: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


def _qpy_b64(circuit: QuantumCircuit) -> dict:
    buf = io.BytesIO()
    qpy.dump(circuit, buf)
    raw = buf.getvalue()
    return {"format": "qpy", "encoding": "base64", "data": base64.b64encode(raw).decode(),
            "sha256": hashlib.sha256(raw).hexdigest(), "qiskit_version": "2.6.2"}


def _bell() -> QuantumCircuit:
    qc = QuantumCircuit(2, name="bell")
    qc.h(0)
    qc.cx(0, 1)
    qc.measure_all()
    return qc


def _post(headers, payload):
    r = client.post("/api/v1/runs", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return payload


def _hardware_pair_payload(counts, cal, *, backend, days, reproduction_of=None, qiskit="2.6.2"):
    circuit = bell_on(0, 1)
    p = record(circuit, counts, cal, qasm=qasm2.dumps(circuit), backend=backend, qiskit=qiskit)
    p["transpiler"]["qasm"] = {"before": {"format": "openqasm2", "text": BELL_QASM}}
    p["context"]["library_versions"] = {**VERSIONS, "qiskit": qiskit}
    p["context"]["python_version"] = "3.12.7 (main, Oct 1 2024)"
    p["created_at"] = _at(days)
    if reproduction_of:
        p["context"]["reproduction_of"] = reproduction_of
    return p


def _reproduce(headers, run_id, level="standard"):
    r = client.get(f"/api/v1/runs/{run_id}/reproduce?level={level}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


class _FakeQlab(types.ModuleType):
    """Stands in for the qlab package inside an executed script: records what it was asked to do."""

    def __init__(self):
        super().__init__("qlab")
        self.inits, self.reproducing_ids, self.flushed = [], [], False

    def init(self, **kw):
        self.inits.append(kw)

    @contextlib.contextmanager
    def reproducing(self, run_id):
        self.reproducing_ids.append(run_id)
        yield

    def flush(self, timeout=5.0):
        self.flushed = True


def _execute(script: str, argv=("reproduce.py",)) -> tuple[dict, _FakeQlab]:
    fake = _FakeQlab()
    old_mod, old_argv = sys.modules.get("qlab"), sys.argv
    sys.modules["qlab"], sys.argv = fake, list(argv)
    scope: dict = {"__name__": "__main__"}
    try:
        exec(compile(script, "reproduce.py", "exec"), scope)
    finally:
        sys.argv = old_argv
        if old_mod is None:
            sys.modules.pop("qlab", None)
        else:
            sys.modules["qlab"] = old_mod
    return scope, fake


# ── The recipe and the script ─────────────────────────────────────────────────

def test_aer_run_script_pins_everything_and_gives_the_same_counts():
    from qiskit_aer import AerSimulator
    me = make_user(prefix="repro")
    circuit = _bell()
    backend = AerSimulator()
    isa = transpile(circuit, backend=backend, optimization_level=1, seed_transpiler=7)
    counts = backend.run(isa, shots=1000, seed_simulator=42).result().get_counts()
    p = record(isa, counts, None, qasm=qasm2.dumps(isa), backend="aer_simulator")
    p["context"]["library_versions"] = VERSIONS
    p["context"]["python_version"] = "3.12.7"
    p["transpiler"] = {"settings": {"optimization_level": 1, "seed_transpiler": 7},
                       "qpy": {"before": _qpy_b64(circuit), "after": _qpy_b64(isa)},
                       "after": {"depth": isa.depth(), "size": isa.size()}}
    p["parameters"] = {"seed_simulator": 42}
    p["execution"] = {"shots": 1000, "primitive": {"kind": "backend", "class": "qiskit_aer.backends.aer_simulator.AerSimulator"}}
    p["project"] = f"repro-{uuid.uuid4().hex[:6]}"
    _post(me, p)

    d = _reproduce(me, p["run_id"])
    assert d["can_rerun"] is True
    s = d["sentence"]
    assert s.startswith("Re-run this with qiskit 2.6.2, qiskit-aer 0.18.2 on aer_simulator")
    assert "1,000 shots, optimization level 1, transpiler seed 7, simulator seed 42" in s
    assert "Everything that decides the result is pinned." in s
    assert d["cant_pin"] == []
    assert d["commands"]["uv"] == f"uv run reproduce_{p['run_id'][:12]}.py"
    assert any(r == "qiskit==2.6.2" for r in d["requirements"]) and any(r == "qiskit-aer==0.18.2" for r in d["requirements"])
    assert any(r.startswith("qlab-sdk @ git+https://github.com/soqlab/Q-lab@") for r in d["requirements"])
    assert "--python 3.12" in d["commands"]["uv_explicit"]
    pinned = {x["what"]: x["value"] for x in d["pinned"]}
    assert pinned["shots"] == "1000" and pinned["simulator seed"] == "42" and pinned["Python"] == "3.12"
    assert d["has_compiled"] is True and d["reproductions"] == [] and d["reproduction_of"] is None

    r = client.get(d["script_url"], headers=me)
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    script = r.text
    assert script.startswith("# /// script\n# requires-python = \"==3.12.*\"")
    assert '#   "qiskit==2.6.2",' in script and '#   "qiskit-aer==0.18.2",' in script
    assert 'TRANSPILER = {"optimization_level": 1, "seed_transpiler": 7}' in script
    assert "SEED = 42" in script and "SHOTS = 1000" in script

    scope, fake = _execute(script)
    assert scope["counts"] == counts, "the seeded re-run must give the original counts exactly"
    assert fake.reproducing_ids == [p["run_id"]] and fake.flushed
    assert fake.inits[0]["project"] == p["project"]

    # --as-compiled runs the recorded compiled circuit instead of recompiling: same counts.
    scope, _ = _execute(script, argv=("reproduce.py", "--as-compiled"))
    assert scope["counts"] == counts


def test_statevector_sampler_run_with_preset_pass_manager():
    from qiskit.primitives import StatevectorSampler
    me = make_user(prefix="repro")
    circuit = _bell()
    result = StatevectorSampler(seed=5).run([circuit], shots=300).result()
    counts = result[0].data.meas.get_counts()
    p = record(circuit, counts, None, qasm=qasm2.dumps(circuit), backend="StatevectorSampler")
    p["context"]["library_versions"] = {"qiskit": "2.6.2", "qlab-sdk": "0.3.0"}
    p["transpiler"] = {"settings": {"optimization_level": 0, "via": "generate_preset_pass_manager",
                                    "basis_gates": ["h", "cx", "measure"]},
                       "qpy": {"before": _qpy_b64(circuit)}}
    p["parameters"] = {"seed": 5}
    p["execution"] = {"shots": 300, "primitive": {"kind": "sampler", "class": "qiskit.primitives.statevector_sampler.StatevectorSampler"}}
    _post(me, p)
    script = client.get(f"/api/v1/runs/{p['run_id']}/reproduce.py", headers=me).text
    assert "generate_preset_pass_manager(**TRANSPILER).run(circuit)" in script
    assert "StatevectorSampler(seed=SEED)" in script
    header = script.split("# ///\n")[0]
    assert "qiskit-aer" not in header and "qiskit-ibm-runtime" not in header
    scope, _ = _execute(script)
    assert scope["counts"] == counts

    nb = client.get(f"/api/v1/runs/{p['run_id']}/reproduce.ipynb", headers=me)
    assert nb.status_code == 200
    cells = json.loads(nb.text)["cells"]
    assert cells[1]["source"][0].startswith('%pip install "qiskit==2.6.2"')
    cell = "".join(cells[2]["source"])
    assert "AS_COMPILED = False" in cell and "# /// script" not in cell
    scope, _ = _execute(cell)
    assert scope["counts"] == counts


def test_hardware_run_says_what_cant_be_pinned():
    me = make_user(prefix="repro")
    p = _post(me, _hardware_pair_payload(sample(BELL, 4000, 1), calibration(), backend="ibm_fez", days=1))
    d = _reproduce(me, p["run_id"])
    assert "on ibm_fez: 4,000 shots, optimization level 1." in d["sentence"]
    assert "Hardware noise and queue time can't be pinned" in d["sentence"]
    assert any("recalibrated" in c for c in d["cant_pin"]) and any("Queue time" in c for c in d["cant_pin"])
    assert any("physical qubits" in c for c in d["cant_pin"])
    assert any("seed_transpiler" in c for c in d["cant_pin"])
    script = client.get(d["script_url"], headers=me).text
    assert 'QiskitRuntimeService().backend("ibm_fez")' in script and "SamplerV2(mode=backend)" in script
    assert '#   "qiskit-ibm-runtime==0.51.0",' in script
    compile(script, "reproduce.py", "exec")
    plain = _reproduce(me, p["run_id"], "plain")
    assert "TVD" not in plain["sentence"] and "noise changes every day" in plain["sentence"]
    expert = _reproduce(me, p["run_id"], "expert")
    assert "Circuit: the circuit given to transpile(), as OpenQASM." in expert["sentence"]


def test_missing_fields_are_named_not_guessed():
    me = make_user(prefix="repro")
    p = {"run_id": f"bare-{uuid.uuid4().hex[:10]}", "circuit_name": "bare", "backend": None, "qasm": BELL_QASM,
         "fingerprint": {"num_qubits": 2}, "context": {}, "parameters": {}, "execution": {}, "results": {},
         "status": "completed", "created_at": _at(0)}
    _post(me, p)
    d = _reproduce(me, p["run_id"])
    gaps = {m["what"] for m in d["missing"]}
    assert {"qiskit version", "backend", "shots"} <= gaps
    assert "package versions weren't recorded" in d["sentence"] and "Not recorded: qiskit version, backend, shots" in d["sentence"]
    assert "qiskit" in d["requirements"]  # unpinned, and said so
    script = client.get(d["script_url"], headers=me).text
    assert "SHOTS = None" in script and "SEED = None" in script and "isa = circuit" in script
    assert "Not recorded: qiskit version" in script
    compile(script, "reproduce.py", "exec")


def test_hash_only_run_cant_be_rerun():
    me = make_user(prefix="repro")
    p = {"run_id": f"zk-{uuid.uuid4().hex[:10]}", "backend": "ibm_fez", "qasm": None,
         "fingerprint": {"num_qubits": 2, "zk_qco": True}, "context": {"library_versions": VERSIONS},
         "execution": {"shots": 100}, "results": {"counts": {"00": 100}}, "status": "completed", "created_at": _at(0)}
    _post(me, p)
    d = _reproduce(me, p["run_id"])
    assert d["can_rerun"] is False and d["notebook_cell"] is None
    assert d["sentence"].startswith("This run can't be re-run: no circuit source was recorded")
    assert "sys.exit(" in client.get(d["script_url"], headers=me).text
    assert client.get(d["notebook_url"], headers=me).status_code == 422


def test_estimator_run_asks_for_observables():
    me = make_user(prefix="repro")
    p = _hardware_pair_payload(sample(BELL, 100, 1), None, backend="fake_fez", days=0)
    p["execution"]["primitive"] = {"kind": "estimator", "class": "qiskit_ibm_runtime.estimator.EstimatorV2"}
    _post(me, p)
    d = _reproduce(me, p["run_id"])
    assert "observables" in {m["what"] for m in d["missing"]}
    script = client.get(d["script_url"], headers=me).text
    assert "OBSERVABLES = None" in script and "EstimatorV2(mode=backend)" in script
    assert 'FakeProviderForBackendV2().backend("fake_fez")' in script
    compile(script, "reproduce.py", "exec")


# ── Reproductions: linking and the verdict ───────────────────────────────────

def _original_and_repro(headers, counts_a, counts_b, cal_a=None, cal_b=None, *, backend_b=None, qiskit_b="2.6.2"):
    backend = f"ibm_{uuid.uuid4().hex[:6]}"
    a = _post(headers, _hardware_pair_payload(counts_a, cal_a, backend=backend, days=3))
    b = _post(headers, _hardware_pair_payload(counts_b, cal_b, backend=backend_b or backend, days=1,
                                              reproduction_of=a["run_id"], qiskit=qiskit_b))
    return a, b


def test_reproduction_within_shot_noise():
    me = make_user(prefix="repro")
    a, b = _original_and_repro(me, sample(BELL, 4000, 1), sample(BELL, 4000, 2))
    d = _reproduce(me, a["run_id"])
    assert len(d["reproductions"]) == 1
    rep = d["reproductions"][0]
    assert rep["run_id"] == b["run_id"] and rep["state"] == "reproduced"
    assert rep["sentence"].startswith("Reproduced: results agree within shot noise (TVD 0.0")
    assert d["summary"] == "1 of 1 reproduction agreed with this run."
    # The reproduction's own page says what it reproduced.
    of = _reproduce(me, b["run_id"])["reproduction_of"]
    assert of["state"] == "reproduced" and of["reproduction_of"] == a["run_id"]
    assert client.get(f"/api/v1/runs/{b['run_id']}", headers=me).json()["reproduction_of"] == a["run_id"]
    expert = client.get(f"/api/v1/runs/{b['run_id']}/reproduction?level=expert", headers=me).json()
    assert "shot noise alone gives about" in expert["sentence"] and "p = " in expert["sentence"]


def test_identical_counts_reproduce_exactly():
    me = make_user(prefix="repro")
    counts = sample(BELL, 1000, 3)
    a, b = _original_and_repro(me, counts, counts)
    rep = client.get(f"/api/v1/runs/{b['run_id']}/reproduction", headers=me).json()
    assert rep["state"] == "reproduced" and rep["exact"] is True
    assert rep["sentence"] == "Reproduced exactly: the same counts, shot for shot."


def test_didnt_reproduce_because_the_calibration_changed():
    me = make_user(prefix="repro")
    a, b = _original_and_repro(me, sample(BELL, 4000, 1), sample(NOISY_BELL, 4000, 2),
                               calibration(ro=0.012), calibration(ro=0.025, time="2026-11-11T08:00:00+00:00"))
    rep = client.get(f"/api/v1/runs/{b['run_id']}/reproduction", headers=me).json()
    assert rep["state"] == "not_reproduced" and rep["verdict"] == "hardware"
    assert rep["sentence"].startswith("Didn't reproduce: the result moved (TVD 0.1")
    assert "— the machine's calibration changed: qubit" in rep["sentence"]
    assert "readout error doubled since then (calibration Wed 11 Nov)" in rep["sentence"]
    plain = client.get(f"/api/v1/runs/{b['run_id']}/reproduction?level=plain", headers=me).json()
    assert "TVD" not in plain["sentence"] and plain["sentence"].startswith("Didn't reproduce: the results differ more than chance")


def test_didnt_reproduce_because_the_versions_changed():
    me = make_user(prefix="repro")
    cal = calibration()
    a, b = _original_and_repro(me, sample(BELL, 4000, 1), sample(NOISY_BELL, 4000, 2), cal, cal, qiskit_b="2.7.0")
    rep = client.get(f"/api/v1/runs/{b['run_id']}/reproduction", headers=me).json()
    assert rep["verdict"] == "code" and "— your side changed: qiskit 2.6.2 → 2.7.0." in rep["sentence"]


def test_didnt_reproduce_without_calibration_says_it_cant_tell():
    me = make_user(prefix="repro")
    a, b = _original_and_repro(me, sample(BELL, 4000, 1), sample(NOISY_BELL, 4000, 2))
    rep = client.get(f"/api/v1/runs/{b['run_id']}/reproduction", headers=me).json()
    assert rep["verdict"] == "unknown"
    assert "whether the machine changed can't be said: no calibration snapshot was recorded with the original or the reproduction" in rep["sentence"]


def test_reproduction_on_another_machine_says_so():
    me = make_user(prefix="repro")
    a, b = _original_and_repro(me, sample(BELL, 4000, 1), sample(NOISY_BELL, 4000, 2), backend_b="ibm_other")
    rep = client.get(f"/api/v1/runs/{b['run_id']}/reproduction", headers=me).json()
    assert rep["other_machine"] is True
    assert f"it ran on ibm_other instead of {a['backend']}" in rep["sentence"]


def test_pending_different_circuit_and_not_a_reproduction():
    me = make_user(prefix="repro")
    a = _post(me, _hardware_pair_payload(sample(BELL, 1000, 1), None, backend="ibm_fez", days=2))
    pending = _hardware_pair_payload({}, None, backend="ibm_fez", days=1, reproduction_of=a["run_id"])
    pending["results"], pending["status"] = {}, "submitted"
    _post(me, pending)
    other = bell_on(1, 2)
    diff = record(other, sample(BELL, 1000, 2), None, qasm=qasm2.dumps(other), backend="ibm_fez")
    diff["transpiler"]["qasm"] = {"before": {"text": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nx q[0];'}}
    diff["context"]["reproduction_of"] = a["run_id"]
    diff["created_at"] = _at(0.5)
    _post(me, diff)
    states = {r["run_id"]: r for r in _reproduce(me, a["run_id"])["reproductions"]}
    assert states[pending["run_id"]]["state"] == "pending"
    assert states[pending["run_id"]]["sentence"] == "Reproduction uploaded; waiting for its results to compare."
    assert states[diff["run_id"]]["state"] == "different_circuit"
    assert "ran a different circuit" in states[diff["run_id"]]["sentence"]
    assert _reproduce(me, a["run_id"])["summary"] == "Its reproductions can't be judged yet."
    assert client.get(f"/api/v1/runs/{a['run_id']}/reproduction", headers=me).json()["state"] == "not_a_reproduction"


def test_a_run_cant_be_its_own_reproduction():
    me = make_user(prefix="repro")
    p = _hardware_pair_payload(sample(BELL, 100, 1), None, backend="ibm_fez", days=0)
    p["context"]["reproduction_of"] = p["run_id"]
    _post(me, p)
    assert client.get(f"/api/v1/runs/{p['run_id']}", headers=me).json()["reproduction_of"] is None


def test_timeline_marks_reproductions():
    me = make_user(prefix="repro")
    project = f"repro-{uuid.uuid4().hex[:8]}"
    a = _hardware_pair_payload(sample(BELL, 4000, 1), None, backend="ibm_fez", days=3)
    a["project"] = project
    _post(me, a)
    b = _hardware_pair_payload(sample(BELL, 4000, 2), None, backend="ibm_fez", days=1, reproduction_of=a["run_id"])
    b["project"] = project
    _post(me, b)
    body = client.get(f"/api/v1/projects/{project}/timeline", headers=me).json()
    by_id = {r["run_id"]: r for r in body["runs"]}
    assert by_id[a["run_id"]]["reproduction"] is None
    mark = by_id[b["run_id"]]["reproduction"]
    assert mark["reproduction_of"] == a["run_id"] and mark["state"] == "reproduced" and mark["tvd"] < 0.05


# ── Tenant isolation ─────────────────────────────────────────────────────────

def test_another_tenants_runs_are_never_listed_compared_or_scripted():
    alice, bob = make_user(prefix="repro"), make_user(prefix="repro")
    a = _post(alice, _hardware_pair_payload(sample(BELL, 4000, 1), None, backend="ibm_fez", days=3))
    # Bob tags his upload as a reproduction of Alice's run.
    b = _post(bob, _hardware_pair_payload(sample(NOISY_BELL, 4000, 2), None, backend="ibm_fez", days=1,
                                          reproduction_of=a["run_id"]))
    assert _reproduce(alice, a["run_id"])["reproductions"] == []
    mine = client.get(f"/api/v1/runs/{b['run_id']}/reproduction", headers=bob).json()
    assert mine["state"] == "original_not_found" and "isn't in your runs" in mine["sentence"]
    for path in ("reproduce", "reproduce.py", "reproduce.ipynb", "reproduction"):
        assert client.get(f"/api/v1/runs/{a['run_id']}/{path}", headers=bob).status_code == 404
    # Signed out: nothing of either.
    assert client.get(f"/api/v1/runs/{a['run_id']}/reproduce").status_code == 404
    assert client.get(f"/api/v1/runs/{a['run_id']}/reproduce.py").status_code == 404


def test_level_is_checked():
    me = make_user(prefix="repro")
    p = _post(me, _hardware_pair_payload(sample(BELL, 100, 1), None, backend="ibm_fez", days=0))
    assert client.get(f"/api/v1/runs/{p['run_id']}/reproduce?level=loud", headers=me).status_code == 422


# ── Migration ────────────────────────────────────────────────────────────────

def test_alembic_007_adds_and_removes_the_column(tmp_path):
    import sqlite3
    from tests.test_usernameless import _alembic
    db = tmp_path / "repro.db"
    up = _alembic(db, "upgrade", "007_reproductions")
    assert up.returncode == 0, up.stderr[-2000:]
    con = sqlite3.connect(db)
    cols = {row[1] for row in con.execute("PRAGMA table_info(runs)")}
    idx = {row[1] for row in con.execute("PRAGMA index_list(runs)")}
    con.close()
    assert "reproduction_of" in cols and "ix_runs_reproduction_of" in idx
    down = _alembic(db, "downgrade", "006_hardware_board")
    assert down.returncode == 0, down.stderr[-2000:]
    con = sqlite3.connect(db)
    assert "reproduction_of" not in {row[1] for row in con.execute("PRAGMA table_info(runs)")}
    con.close()
