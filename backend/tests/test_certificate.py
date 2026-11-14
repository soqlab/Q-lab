"""Provenance certificates and the Reproduced badge (app/provenance/, app/routers/certificate.py).

The certificate body is canonical JSON with a stable hash; it is signed with Ed25519 + ML-DSA-65 and
any change to it is caught. Only the owner, or anyone once the run is shared, may fetch it; the
public verification page and badge exist only while the run is shared, and say honestly whether
re-runs agreed.
"""
import copy
import json
import subprocess
import sys
import uuid

import pytest

from app.provenance import certificate as cert
from app.provenance import verify as cv
from app.rewind import signing as rewind_signing
from tests.helpers import client, make_user, push_run

GIT = "0123456789abcdef0123456789abcdef01234567"


@pytest.fixture
def key(monkeypatch):
    k = rewind_signing.generate_key()
    monkeypatch.setenv("QLAB_REWIND_SIGNING_KEY", k)
    monkeypatch.delenv("QLAB_CERT_SIGNING_KEY", raising=False)
    monkeypatch.setenv("QLAB_APP_URL", "https://qlab.example")
    return rewind_signing.parse_key(k)


def _run(headers, counts=None, **kw):
    ctx = kw.pop("context", {})
    return push_run(headers, results={"counts": counts or {"00": 500, "11": 500}},
                    context={"git_commit": GIT, "platform": "Linux-secret-host", "python_version": "3.11.9",
                             "library_versions": {"qiskit": "2.6.2", "qlab_sdk": "0.4.0"}, **ctx},
                    calibration={"t1_us": {"0": 100.5}, "last_update": "2026-11-01T08:00:00+00:00"}, **kw)


def _repro(headers, of, counts):
    return _run(headers, counts=counts, context={"reproduction_of": of})


def _share(headers, run_id):
    return client.post(f"/api/v1/runs/{run_id}/share", headers=headers).json()["share_token"]


# ── Canonical JSON ───────────────────────────────────────────────────────────

def test_canonical_json_is_stable():
    a = {"schema": cv.CERT_FORMAT, "b": [1, "two", None, True], "a": {"z": "é\n\"", "y": -3}}
    b = {"a": {"y": -3, "z": "é\n\""}, "schema": cv.CERT_FORMAT, "b": [1, "two", None, True]}
    assert cv.canonical_bytes(a) == cv.canonical_bytes(b)
    assert cv.canonical_bytes(a) == ('{"a":{"y":-3,"z":"é\\n\\""},"b":[1,"two",null,true],'
                                     '"schema":"qlab-provenance-certificate/1"}').encode("utf-8")
    # Pinned: a change to the canonical form would break every certificate already issued.
    assert cv.body_sha256(a) == "0d63744b28eec2f60fc32f58b3064b7adea03bebee9f222a25bf18198cbf167f"


def test_canonical_json_is_rfc8785():
    """The same bytes as any RFC 8785 (JCS) implementation, as SOQLAB Witness receipts use."""
    rfc8785 = pytest.importorskip("rfc8785")
    sample = {"schema": cv.CERT_FORMAT, "a": {"z": "\u00e9\n\"\x01\x7f\u2028 \\ /", "y": -3,
                                              "b": [1, None, True, False, "\U0001f600"]}, "B": 2 ** 53 - 1, "_": ""}
    assert cv.canonical_bytes(sample) == rfc8785.dumps(sample)


@pytest.mark.parametrize("bad", [{"x": 0.5}, {"x": 2 ** 60}, {"x": "\ud800"}, {1: "a"}, {"ü": 1}, {"x": {1, 2}}])
def test_canonical_json_refuses_what_browsers_would_write_differently(bad):
    with pytest.raises(cv.CertificateError):
        cv.canonical_bytes(bad)


def test_issued_body_is_canonical_and_hash_is_repeatable(key):
    me = make_user(prefix="cc")
    rid = _run(me)
    doc = client.get(f"/api/v1/runs/{rid}/certificate", headers=me).json()
    assert doc["body_sha256"] == cv.body_sha256(doc["certificate"])
    # The same bytes after a JSON round trip with keys in another order.
    shuffled = json.loads(json.dumps(doc["certificate"], sort_keys=False))
    assert cv.body_sha256(dict(reversed(list(shuffled.items())))) == doc["body_sha256"]


# ── Signing and tamper detection ─────────────────────────────────────────────

def test_sign_and_verify_and_tampering(key):
    me = make_user(prefix="cs")
    rid = _run(me)
    doc = client.get(f"/api/v1/runs/{rid}/certificate", headers=me).json()
    sig = doc["signature"]
    assert sig["key"] == key.key_id and sig["public_key"]["key_id"] == key.key_id
    ok = cv.verify_certificate(doc, expect_key=key.key_id)
    assert ok["valid"] and ok["ed25519"] and ok["ml_dsa_65"] and ok["body_hash_ok"]

    # Change a certified fact: the stated hash no longer matches.
    t = copy.deepcopy(doc)
    t["certificate"]["settings"]["shots"] = 999
    r = cv.verify_certificate(t)
    assert not r["valid"] and not r["body_hash_ok"]

    # ... and restate the hash too: now the signatures fail.
    t["body_sha256"] = cv.body_sha256(t["certificate"])
    r = cv.verify_certificate(t)
    assert not r["valid"] and r["body_hash_ok"] and not r["ed25519"] and not r["ml_dsa_65"]

    # A different signing time is a different message.
    t = copy.deepcopy(doc)
    t["signature"]["signed_at"] = "2020-01-01T00:00:00Z"
    assert not cv.verify_certificate(t)["valid"]

    # Valid, but not by the key you trust.
    r = cv.verify_certificate(doc, expect_key="qrk-" + "0" * 32)
    assert not r["valid"] and r["ed25519"] and r["ml_dsa_65"]

    # A Rewind manifest signature (other ML-DSA context) is no certificate signature.
    msg = cv.signed_bytes(key.key_id, sig["signed_at"], doc["body_sha256"])
    import base64
    from app.rewind import verify as rv
    t = copy.deepcopy(doc)
    t["signature"]["ml_dsa_65"] = base64.b64encode(key.ml_dsa_65.sign(msg, rv.CONTEXT)).decode()
    r = cv.verify_certificate(t)
    assert r["ed25519"] and not r["ml_dsa_65"] and not r["valid"]


def test_unsigned_without_a_key(monkeypatch):
    monkeypatch.delenv("QLAB_REWIND_SIGNING_KEY", raising=False)
    monkeypatch.delenv("QLAB_CERT_SIGNING_KEY", raising=False)
    me = make_user(prefix="cu")
    rid = _run(me)
    doc = client.get(f"/api/v1/runs/{rid}/certificate", headers=me).json()
    assert doc["signature"] is None and "no signing key" in doc["unsigned_reason"]
    r = cv.verify_certificate(doc)
    assert not r["valid"] and r["body_hash_ok"]
    assert client.get("/api/v1/certificates/public-key").json()["enabled"] is False


def test_cert_key_takes_precedence(monkeypatch, key):
    other = rewind_signing.generate_key()
    monkeypatch.setenv("QLAB_CERT_SIGNING_KEY", other)
    pk = client.get("/api/v1/certificates/public-key").json()
    assert pk["enabled"] and pk["key_env"] == "QLAB_CERT_SIGNING_KEY"
    assert pk["public_key"]["key_id"] == rewind_signing.parse_key(other).key_id != key.key_id


# ── What it contains ─────────────────────────────────────────────────────────

def test_contents_and_no_personal_data(key):
    me = make_user(prefix="cp")
    rid = _run(me)
    doc = client.get(f"/api/v1/runs/{rid}/certificate", headers=me).json()
    b = doc["certificate"]
    assert b["schema"] == cv.CERT_FORMAT and b["run"]["run_id"] == rid
    assert b["circuit"]["as_run"]["qasm_sha256"] and len(b["circuit"]["as_run"]["qasm_sha256"]) == 64
    assert b["machine"]["backend"] == "aer_simulator"
    assert b["calibration"]["recorded"] and b["calibration"]["sha256"] == cert.json_sha256(
        {"t1_us": {"0": 100.5}, "last_update": "2026-11-01T08:00:00+00:00"})
    assert b["calibration"]["calibrated_at"] == "2026-11-01T08:00:00Z"
    assert b["software"]["versions"]["qiskit"] == "2.6.2" and b["software"]["python"] == "3.11"
    assert b["settings"]["shots"] == 1000
    assert b["results"]["counts_sha256"] == cert.json_sha256({"00": 500, "11": 500})
    assert b["results"]["total_shots"] == 1000
    assert b["run"]["public_page"] is None  # not shared
    text = json.dumps(doc)
    for private in (GIT, "secret-host", "@example.com", "created_by_user_id", "org_id"):
        assert private not in text


def test_download_is_a_file(key):
    me = make_user(prefix="cd")
    rid = _run(me)
    r = client.get(f"/api/v1/runs/{rid}/certificate?download=1", headers=me)
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    assert r.headers["content-disposition"].endswith('.json"')


# ── Who may see it ───────────────────────────────────────────────────────────

def test_access_control_and_unshare(key):
    alice, bob = make_user(prefix="ca"), make_user(prefix="cb")
    rid = _run(alice)
    assert client.get(f"/api/v1/runs/{rid}/certificate", headers=alice).status_code == 200
    assert client.get(f"/api/v1/runs/{rid}/certificate", headers=bob).status_code == 404
    assert client.get(f"/api/v1/runs/{rid}/certificate").status_code == 404
    assert client.get(f"/api/v1/runs/{uuid.uuid4().hex}/certificate", headers=alice).status_code == 404

    token = _share(alice, rid)
    assert client.get(f"/api/v1/runs/{rid}/certificate", headers=bob).status_code == 200
    assert client.get(f"/api/v1/runs/{rid}/certificate").status_code == 200
    page = client.get(f"/api/v1/public/verified/{token}")
    assert page.status_code == 200
    d = page.json()
    assert d["state"] == "not_yet" and d["certificate"]["certificate"]["run"]["public_page"] == \
        f"https://qlab.example/verified/{token}"
    assert cv.verify_certificate(d["certificate"])["valid"]
    assert client.get(f"/api/v1/public/verified/{token}/badge.svg").status_code == 200

    client.delete(f"/api/v1/runs/{rid}/share", headers=alice)
    assert client.get(f"/api/v1/runs/{rid}/certificate", headers=bob).status_code == 404
    assert client.get(f"/api/v1/public/verified/{token}").status_code == 404
    assert client.get(f"/api/v1/public/verified/{token}/certificate").status_code == 404
    gone = client.get(f"/api/v1/public/verified/{token}/badge.svg")
    assert gone.status_code == 404 and "not shared" in gone.text
    assert client.get(f"/api/v1/runs/{rid}/certificate", headers=alice).status_code == 200
    assert client.get("/api/v1/public/verified/not-a-token!").status_code == 404


# ── Badge states ─────────────────────────────────────────────────────────────

def _state(token):
    d = client.get(f"/api/v1/public/verified/{token}").json()
    svg = client.get(f"/api/v1/public/verified/{token}/badge.svg")
    assert svg.status_code == 200 and svg.headers["content-type"].startswith("image/svg+xml")
    return d, svg.text


def test_badge_states(key):
    me, stranger = make_user(prefix="cx"), make_user(prefix="cy")
    rid = _run(me)
    token = _share(me, rid)
    d, svg = _state(token)
    assert d["state"] == "not_yet" and "not yet reproduced" in svg
    assert d["sentence"].startswith("Not yet reproduced")

    # A stranger's unshared "reproduction" does not count either way.
    _repro(stranger, rid, {"00": 1000})
    assert _state(token)[0]["state"] == "not_yet"

    _repro(me, rid, {"00": 500, "11": 500})
    d, svg = _state(token)
    assert d["state"] == "reproduced" and "reproduced exactly" in svg
    assert "exactly the same counts" in d["sentence"]

    _repro(me, rid, {"00": 510, "11": 490})
    d, svg = _state(token)
    assert d["state"] == "reproduced" and "reproduced ×2" in svg
    assert d["sentence"].startswith("Reproduced: 2 independent re-runs agreed within shot noise (TVD ≤ 0.01")
    runs = d["certificate"]["certificate"]["reproduction"]["runs"]
    assert all(r["by"] == "author" and r["run_id"] is None for r in runs)  # private: counted, not named

    # A shared reproduction by someone else that disagrees: honest, mixed.
    bad = _repro(stranger, rid, {"00": 1000})
    _share(stranger, bad)
    d, svg = _state(token)
    assert d["state"] == "mixed" and "reproduced 2/3" in svg and "1 didn't" in d["sentence"]
    named = [r for r in d["certificate"]["certificate"]["reproduction"]["runs"] if r["run_id"]]
    assert named == [next(r for r in named if r["run_id"] == bad)] and named[0]["by"] == "other"


def test_badge_didnt_reproduce(key):
    me = make_user(prefix="cn")
    rid = _run(me)
    token = _share(me, rid)
    _repro(me, rid, {"00": 900, "01": 100})
    d, svg = _state(token)
    assert d["state"] == "not_reproduced" and "didn't reproduce" in svg
    assert d["sentence"].startswith("Didn't reproduce: 1 re-run differed more than shot noise explains")


# ── The offline verifier ─────────────────────────────────────────────────────

def test_offline_verifier(key, tmp_path):
    me = make_user(prefix="co")
    rid = _run(me)
    token = _share(me, rid)
    doc = client.get(f"/api/v1/public/verified/{token}/certificate").json()
    good = tmp_path / "c.json"
    good.write_text(json.dumps(doc), encoding="utf-8")
    qasm = tmp_path / "c.qasm"
    from tests.helpers import BELL
    qasm.write_text(BELL, encoding="utf-8", newline="")
    tampered = copy.deepcopy(doc)
    tampered["certificate"]["machine"]["backend"] = "ibm_other"
    tampered["body_sha256"] = cv.body_sha256(tampered["certificate"])
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps(tampered), encoding="utf-8")

    # Served as a download, and identical to the module.
    served = client.get("/api/v1/certificates/verify.py")
    assert served.status_code == 200 and "def verify_certificate" in served.text
    script = tmp_path / "verify_certificate.py"
    script.write_bytes(served.content)

    def run(*args):
        # -I: isolated, so it can't import anything from Q-Lab.
        return subprocess.run([sys.executable, "-I", str(script), *args], capture_output=True, text=True,
                               cwd=str(tmp_path), timeout=120)

    r = run("--file", str(good), "--key", key.key_id, "--qasm", str(qasm))
    assert r.returncode == 0, r.stdout + r.stderr
    assert "VALID" in r.stdout and "matches the certificate" in r.stdout
    r = run("--file", str(bad))
    assert r.returncode == 1 and "NOT VALID" in r.stdout
    r = run("--file", str(good), "--key", "qrk-" + "1" * 32)
    assert r.returncode == 1
    good.write_text("{}", encoding="utf-8")
    assert run("--file", str(good)).returncode == 2


# ── The in-browser verifier (the same rules in JavaScript) ───────────────────

NODE_CHECK = r"""
const fs = require("fs"), vm = require("vm");
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const ctx = { TextEncoder, Uint8Array };
ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of input.scripts) vm.runInContext(fs.readFileSync(f, "utf8"), ctx);
const out = [];
for (const c of input.cases) {
  try { out.push(ctx.QLabCertificate.verify(c.doc, c.key || null)); }
  catch (e) { out.push({ malformed: String(e.message) }); }
}
out.push(ctx.QLabCertificate.bodySha256(input.sample));
process.stdout.write(JSON.stringify(out));
"""


def test_browser_verifier_agrees_with_python(key, tmp_path):
    import shutil
    from pathlib import Path
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    root = Path(__file__).resolve().parents[2] / "frontend" / "public"
    me = make_user(prefix="cj")
    rid = _run(me, circuit_name="Bell — ünïcode \"quoted\"\n")
    doc = client.get(f"/api/v1/runs/{rid}/certificate", headers=me).json()
    tampered = copy.deepcopy(doc)
    tampered["certificate"]["results"]["total_shots"] = 1
    tampered["body_sha256"] = cv.body_sha256(tampered["certificate"])
    sample = {"schema": cv.CERT_FORMAT, "b": [1, "two", None, True], "a": {"z": "é\n\"", "y": -3}}
    script = tmp_path / "check.js"
    script.write_text(NODE_CHECK, encoding="utf-8")
    payload = {"scripts": [str(root / "vendor" / "qlab-pq-verify.js"), str(root / "certificate-verify.js")],
               "cases": [{"doc": doc}, {"doc": doc, "key": key.key_id}, {"doc": doc, "key": "qrk-" + "2" * 32},
                         {"doc": tampered}, {"doc": {"format": "nope"}}],
               "sample": sample}
    r = subprocess.run([node, str(script)], input=json.dumps(payload), capture_output=True, text=True,
                       encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr
    ok, pinned, wrong_key, bad, malformed, sample_hash = json.loads(r.stdout)
    assert ok["valid"] and ok["ed25519"] and ok["ml_dsa_65"] and ok["key_id"] == key.key_id
    assert ok["body_sha256"] == doc["body_sha256"]
    assert pinned["valid"] and not wrong_key["valid"]
    assert not bad["valid"] and bad["body_hash_ok"] and not bad["ed25519"] and not bad["ml_dsa_65"]
    assert "malformed" in malformed
    assert sample_hash == cv.body_sha256(sample)
