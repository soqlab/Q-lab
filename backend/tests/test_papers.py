"""Reproduce a paper: arXiv ids, the fetch allowlist and SSRF check, archive limits (traversal,
links, bombs, huge files, too many entries), OpenQASM-only circuit finding (never running Python),
the ideal-simulator fallback, calibrated runs, the verdict against reported numbers, and saving.

The fixture archives are built here, in memory, so every malicious one is visible in this file.
"""
from __future__ import annotations

import gzip
import io
import json
import stat
import tarfile
import zipfile

import httpx
import pytest
from sqlalchemy import delete

from app import hardware_board as hb
from app import machine_pick as mp
from app.database import SessionLocal
from app.models import MachineSnapshot
from app.papers import archive, circuits, compare, fetch, service
from app.papers import run as pr
from app.rewind import store
from app.rewind.snapshot import capture
from tests.helpers import BELL, GHZ3, client, make_user
from tests.test_rewind_harvest import DAY, FakeIBMBackend, props_for

ID = "2401.01234"
META = f"""<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/{ID}v1</id>
    <title>A GHZ state on   a small device</title>
    <summary>We prepare GHZ states. Code: https://github.com/someone/ghz-paper.</summary>
    <arxiv:comment>8 pages</arxiv:comment>
    <published>2024-01-02T00:00:00Z</published>
    <author><name>A. Author</name></author>
    <author><name>B. Author</name></author>
  </entry>
</feed>""".encode()
NO_ENTRY = b"<?xml version='1.0'?><feed xmlns='http://www.w3.org/2005/Atom'></feed>"
TEX = ("\\documentclass{article}\\begin{document}We ran\n\\begin{lstlisting}\n" + GHZ3
       + "\n\\end{lstlisting}\nand it worked.\\end{document}\n")
PY = "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.h(0)\nqc.cx(0, 1)\n"


def tar_gz(entries: list[tuple[str, bytes | None, str]]) -> bytes:
    """entries: (name, data, type) with type file / symlink / hardlink / fifo."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for name, data, kind in entries:
            info = tarfile.TarInfo(name)
            if kind == "file":
                info.size = len(data or b"")
                tf.addfile(info, io.BytesIO(data or b""))
            else:
                info.type = {"symlink": tarfile.SYMTYPE, "hardlink": tarfile.LNKTYPE, "fifo": tarfile.FIFOTYPE}[kind]
                info.linkname = "/etc/passwd" if kind != "fifo" else ""
                tf.addfile(info)
    return buf.getvalue()


def zip_bytes(entries: list[tuple[str, bytes, int]]) -> bytes:
    """entries: (name, data, unix mode)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, data, mode in entries:
            info = zipfile.ZipInfo(name)
            info.external_attr = mode << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, data)
    return buf.getvalue()


class FakeWeb:
    """fetch.get for tests: url -> bytes (or a FetchError), recording what was asked."""

    def __init__(self, routes: dict[str, bytes | fetch.FetchError]) -> None:
        self.routes = routes
        self.asked: list[str] = []

    def __call__(self, url: str, max_bytes: int, timeout_s: float = 25.0) -> fetch.Fetched:
        self.asked.append(url)
        for prefix, body in self.routes.items():
            if url.startswith(prefix):
                if isinstance(body, fetch.FetchError):
                    raise body
                return fetch.Fetched(url=url, content_type="application/octet-stream", body=body)
        raise fetch.FetchError(404, "nothing here")


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    for k in ("QISKIT_IBM_TOKEN", "QLAB_HARDWARE_BOARD_SIMULATE", "RENDER", "QLAB_REWIND_MAX_QUBITS",
              "QLAB_REWIND_MAX_SHOTS", "QLAB_REWIND_MAX_SHOTS_ANON", "QLAB_REWIND_MAX_WORK", "QLAB_ALLOW_PRIVATE_URLS"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("QLAB_REWIND_DIR", str(tmp_path / "rewind"))
    monkeypatch.setenv("QLAB_REWIND_SCHEDULER", "off")
    hb.provider = None
    monkeypatch.setattr(service, "API_GAP_S", 0.0)
    monkeypatch.setenv("QLAB_REWIND_TIME_LIMIT_S", "600")  # a busy test machine must not turn a run into a 504
    service.clear_cache()
    with SessionLocal() as db:
        db.execute(delete(MachineSnapshot))
        db.commit()
    yield
    service.clear_cache()


def web(monkeypatch, routes) -> FakeWeb:
    fake = FakeWeb(routes)
    monkeypatch.setattr(fetch, "get", fake)
    return fake


# ---------------------------------------------------------------------------
# arXiv ids and the fetch allowlist
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,want", [
    ("1707.03429", "1707.03429"), ("arXiv:1707.03429v2", "1707.03429v2"), ("https://arxiv.org/abs/2401.01234", "2401.01234"),
    ("arxiv.org/pdf/2401.01234v3.pdf", "2401.01234v3"), ("https://export.arxiv.org/abs/quant-ph/9508027", "quant-ph/9508027"),
    ("http://www.arxiv.org/abs/2401.12345?context=quant-ph", "2401.12345"),
])
def test_arxiv_ids_are_read_from_ids_and_links(text, want):
    assert service.parse_id(text) == want


@pytest.mark.parametrize("text", [
    "", "hello", "https://evil.example/abs/2401.01234", "http://169.254.169.254/latest/meta-data",
    "https://arxiv.org.evil.example/abs/2401.01234", "file:///etc/passwd", "2401.01234/../../x", "x" * 400,
])
def test_anything_else_is_refused_before_any_fetch(text, monkeypatch):
    fake = web(monkeypatch, {})
    r = client.post("/api/v1/papers/find", json={"paper": text[:300]})
    assert r.status_code == 422
    assert fake.asked == []


def test_only_arxiv_and_github_over_https_are_fetched(monkeypatch):
    monkeypatch.setattr(fetch, "require_safe_url", lambda u: u)
    fetch.check_url("https://arxiv.org/src/2401.01234")
    fetch.check_url("https://codeload.github.com/a/b/zip/abc")
    for bad in ["http://arxiv.org/src/1", "https://arxiv.org:8443/src/1", "https://user:pw@arxiv.org/src/1",
                "https://example.com/x", "https://169.254.169.254/", "https://localhost/", "https://gist.github.com/x"]:
        with pytest.raises(fetch.FetchError):
            fetch.check_url(bad)


def test_an_allowed_host_resolving_inside_the_network_is_refused(monkeypatch):
    import socket
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("10.0.0.5", 443))])
    with pytest.raises(fetch.FetchError) as e:
        fetch.check_url("https://arxiv.org/src/2401.01234")
    assert "private" in e.value.message


def test_redirects_are_checked_and_sizes_capped(monkeypatch):
    monkeypatch.setattr(fetch, "require_safe_url", lambda u: u)

    def handler(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        if u.endswith("/to-metadata"):
            return httpx.Response(302, headers={"location": "https://169.254.169.254/latest/meta-data"})
        if u.endswith("/relative"):
            return httpx.Response(301, headers={"location": "/src/ok"})
        if u.endswith("/src/ok"):
            return httpx.Response(200, content=b"fine", headers={"content-type": "application/gzip"})
        if u.endswith("/declared-huge"):
            return httpx.Response(200, headers={"content-length": "999999999"}, content=b"")
        if u.endswith("/streamed-huge"):
            return httpx.Response(200, content=b"x" * 5000)
        if u.endswith("/loop"):
            return httpx.Response(302, headers={"location": "/loop"})
        return httpx.Response(404)

    monkeypatch.setattr(fetch, "_transport", httpx.MockTransport(handler))
    with pytest.raises(fetch.FetchError) as e:
        fetch.get("https://arxiv.org/to-metadata", 1000)
    assert e.value.status == 400 and "arXiv and GitHub" in e.value.message
    assert fetch.get("https://arxiv.org/relative", 1000).body == b"fine"
    for path in ("declared-huge", "streamed-huge"):
        with pytest.raises(fetch.FetchError) as e:
            fetch.get(f"https://arxiv.org/{path}", 1000)
        assert e.value.status == 413
    with pytest.raises(fetch.FetchError):
        fetch.get("https://arxiv.org/loop", 1000)
    with pytest.raises(fetch.FetchError) as e:
        fetch.get("https://arxiv.org/missing", 1000)
    assert e.value.status == 404


# ---------------------------------------------------------------------------
# Archives
# ---------------------------------------------------------------------------

def test_traversal_links_and_devices_are_refused_and_reported():
    data = tar_gz([
        ("paper/main.tex", TEX.encode(), "file"),
        ("../evil.qasm", BELL.encode(), "file"),
        ("/etc/cron.d/evil.qasm", BELL.encode(), "file"),
        ("a/../../up.qasm", BELL.encode(), "file"),
        ("C:/win.qasm", BELL.encode(), "file"),
        ("link.qasm", None, "symlink"),
        ("hard.qasm", None, "hardlink"),
        ("pipe.qasm", None, "fifo"),
        ("figure.png", b"\x89PNG" + b"0" * 100, "file"),
    ])
    got = archive.read_archive(data)
    assert got.kind == "tar" and set(got.files) == {"paper/main.tex"}
    reasons = {s["name"]: s["reason"] for s in got.skipped}
    for name in ("../evil.qasm", "/etc/cron.d/evil.qasm", "a/../../up.qasm", "C:/win.qasm"):
        assert "outside the archive" in reasons[name]
    assert "links" in reasons["link.qasm"] and "links" in reasons["hard.qasm"]
    assert "not a regular file" in reasons["pipe.qasm"]


def test_safe_name():
    assert archive.safe_name("./a/b.qasm") == "a/b.qasm"
    assert archive.safe_name("a\\..\\..\\b") is None
    assert archive.safe_name("a/\x00b") is None


def test_a_decompression_bomb_is_refused(monkeypatch):
    monkeypatch.setattr(archive, "MAX_UNPACKED", 5_000_000)
    bomb = tar_gz([("zeros.bin", b"\0" * 8_000_000, "file"), ("late.qasm", BELL.encode(), "file")])
    assert len(bomb) < 100_000
    got = archive.read_archive(bomb)
    assert got.refused and "unpacks to more than" in got.refused and got.files == {}
    single = archive.read_archive(gzip.compress(b"%" * 8_000_000))  # read only up to the file limit, then stopped
    assert single.files == {} and "over 512 kB" in single.skipped[0]["reason"]


def test_huge_files_and_too_many_entries_are_skipped(monkeypatch):
    big = ("// padding\n" * 60_000).encode()
    got = archive.read_archive(tar_gz([("big.qasm", big, "file"), ("ok.qasm", BELL.encode(), "file")]))
    assert set(got.files) == {"ok.qasm"} and "over 512 kB" in got.skipped[0]["reason"]
    monkeypatch.setattr(archive, "MAX_MEMBERS", 20)
    many = tar_gz([(f"f{i}.txt", b"x", "file") for i in range(40)])
    got = archive.read_archive(many)
    assert len(got.files) == 20 and any("more than 20 entries" in s["reason"] for s in got.skipped)


def test_zip_traversal_links_and_bombs():
    data = zip_bytes([
        ("repo-abc/circuits/bell.qasm", BELL.encode(), stat.S_IFREG | 0o644),
        ("repo-abc/../../escape.qasm", BELL.encode(), stat.S_IFREG | 0o644),
        ("repo-abc/link.qasm", b"/etc/passwd", stat.S_IFLNK | 0o777),
        ("repo-abc/bomb.txt", b"\0" * 400_000, stat.S_IFREG | 0o644),
        ("repo-abc/huge.qasm", b"x" * 600_000, stat.S_IFREG | 0o644),
    ])
    got = archive.read_archive(data)
    assert got.kind == "zip" and set(got.files) == {"repo-abc/circuits/bell.qasm"}
    reasons = " ".join(s["reason"] for s in got.skipped)
    assert "outside the archive" in reasons and "links" in reasons and "decompression bomb" in reasons and "over 512 kB" in reasons


def test_single_gzip_file_pdf_and_damaged():
    got = archive.read_archive(gzip.compress(TEX.encode()), "arXiv-2401.01234v1.gz")
    assert got.kind == "single" and list(got.files) == ["main.tex"]
    assert archive.read_archive(b"%PDF-1.7 ...").kind == "pdf"
    assert archive.read_archive(b"\x1f\x8b\x08\x00garbage").refused


# ---------------------------------------------------------------------------
# Circuits: OpenQASM only
# ---------------------------------------------------------------------------

def test_circuits_are_found_in_qasm_files_latex_markdown_and_strings():
    files = {
        "main.tex": TEX.encode(),
        "README.md": ("# Circuits\n```qasm\n" + BELL + "\n```\n").encode(),
        "bare.qasm": b'include "qelib1.inc";\nqreg q[1];\ncreg c[1];\nx q[0];\nmeasure q -> c;\n',
        "make.py": (PY + 'QASM = """' + BELL.replace("h q[0]", "x q[0]") + '"""\n').encode(),
    }
    got = circuits.find(files, "arXiv source")
    ok = [c for c in got["circuits"] if c["ok"]]
    assert len(ok) == 4
    assert {c["origin"] for c in ok} == {"main.tex", "README.md", "bare.qasm", "make.py"}
    assert next(c for c in ok if c["origin"] == "bare.qasm")["qasm"].startswith("OPENQASM 2.0;")
    assert next(c for c in ok if c["origin"] == "main.tex")["facts"]["num_qubits"] == 3
    assert got["python_files"] == ["make.py"]


def test_python_is_never_run(monkeypatch, tmp_path):
    marker = tmp_path / "ran"
    evil = f"import pathlib\npathlib.Path(r'{marker}').write_text('x')\nfrom qiskit import QuantumCircuit\n"
    got = circuits.find({"exploit.py": evil.encode(), "nb.ipynb": json.dumps({"cells": [{"source": [evil]}]}).encode()}, "x")
    assert not marker.exists()
    assert got["circuits"] == [] and set(got["python_files"]) == {"exploit.py", "nb.ipynb"}


def test_includes_of_other_files_are_refused_without_reading_them(tmp_path):
    secret = tmp_path / "secret.inc"
    secret.write_text("gate leaked a { x a; }\n")
    text = f'OPENQASM 2.0;\ninclude "qelib1.inc";\ninclude "{secret.as_posix()}";\nqreg q[1];\nleaked q[0];\n'
    with pytest.raises(mp.CircuitError) as e:
        mp.parse_circuit(text)
    assert "Only the standard" in str(e.value)
    with pytest.raises(circuits.CircuitProblem):
        circuits.check(text)
    # commented-out includes are fine; the standard ones too
    mp.parse_circuit('OPENQASM 2.0;\n// include "x.inc";\ninclude "qelib1.inc";\nqreg q[1];\nx q[0];\n')
    r = client.post("/api/v1/rewind/run", json={"machine": "ibm_line", "date": "2026-11-14", "circuit": text})
    assert r.status_code in (404, 422) and "leaked" not in r.text


def test_width_depth_and_exponential_gate_definitions_are_limited():
    wide = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[30];\n' + "".join(f"h q[{i}];\n" for i in range(30))
    with pytest.raises(circuits.CircuitProblem, match="30 qubits"):
        circuits.check(wide)
    # each gate calls the previous one twice: 2^n basic gates once expanded
    def chain(n: int) -> str:
        defs = "gate g0 a { x a; }\n" + "".join(f"gate g{i} a {{ g{i - 1} a; g{i - 1} a; }}\n" for i in range(1, n + 1))
        return 'OPENQASM 2.0;\ninclude "qelib1.inc";\n' + defs + f"qreg q[1];\ng{n} q[0];\n"
    with pytest.raises(circuits.CircuitProblem, match="once its gates are expanded"):
        circuits.check(chain(13))
    with pytest.raises(circuits.CircuitProblem, match="nested more than"):
        circuits.check(chain(40))
    assert circuits.check(chain(5))[1]["expanded_operations"] == 32
    deep = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\n' + "x q[0];\n" * 2100
    with pytest.raises(circuits.CircuitProblem):
        circuits.check(deep)


def test_machine_readable_values_are_extracted_and_marked():
    files = {"results/counts.json": json.dumps({"ghz": {"000": 480, "111": 470, "010": 50}}).encode(),
             "other.json": json.dumps({"lr": 0.01, "names": ["a"]}).encode()}
    got = circuits.find(files, "GitHub someone/ghz-paper")
    assert len(got["values"]) == 1
    v = got["values"][0]
    assert v["kind"] == "counts" and v["status"] == "extracted, check it" and v["distribution"]["111"] == 470


# ---------------------------------------------------------------------------
# Finding a paper end to end (no network: fetch.get is replaced)
# ---------------------------------------------------------------------------

def routes(eprint: bytes | fetch.FetchError, repo: bytes | fetch.FetchError | None = None, meta: bytes = META):
    r: dict = {"https://export.arxiv.org/api/query": meta, f"https://arxiv.org/src/{ID}": eprint}
    if repo is not None:
        r["https://github.com/someone/ghz-paper/archive/HEAD.zip"] = repo
    return r


def test_find_reads_the_source_and_the_linked_repository(monkeypatch):
    repo = zip_bytes([("ghz-paper-1a2b/bell.qasm", BELL.encode(), stat.S_IFREG | 0o644),
                      ("ghz-paper-1a2b/data/counts.json", json.dumps({"000": 0.49, "111": 0.47, "001": 0.04}).encode(),
                       stat.S_IFREG | 0o644)])
    fake = web(monkeypatch, routes(tar_gz([("main.tex", TEX.encode(), "file")]), repo))
    r = client.post("/api/v1/papers/find", json={"paper": f"https://arxiv.org/abs/{ID}"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["title"] == "A GHZ state on a small device" and d["authors"] == ["A. Author", "B. Author"]
    assert [s["status"] for s in d["sources"]] == ["ok", "ok"] and d["sources"][1]["name"] == "GitHub someone/ghz-paper"
    assert {c["origin"] for c in d["circuits"]} == {"main.tex", "bell.qasm"} and all(c["ok"] for c in d["circuits"])
    assert d["values"][0]["status"] == "extracted, check it" and d["values"][0]["kind"] == "probabilities"
    assert "Found 2 circuits" in d["message"] and d["cached"] is False
    asked = len(fake.asked)
    again = client.post("/api/v1/papers/find", json={"paper": ID}).json()
    assert again["cached"] is True and len(fake.asked) == asked


def test_a_python_only_paper_says_so(monkeypatch):
    web(monkeypatch, routes(tar_gz([("main.tex", b"\\begin{document}no circuits\\end{document}", "file"),
                                    ("code/ghz.py", PY.encode(), "file")])))
    d = client.post("/api/v1/papers/find", json={"paper": ID}).json()
    assert d["python_only"] is True and d["circuits"] == []
    assert d["message"] == service.PYTHON_ONLY and "won't run for safety" in d["message"] and "OpenQASM" in d["message"]


def test_pdf_only_missing_and_unknown_papers(monkeypatch):
    web(monkeypatch, routes(b"%PDF-1.5 ..."))
    d = client.post("/api/v1/papers/find", json={"paper": ID}).json()
    assert d["sources"][0]["status"] == "missing" and "only the PDF" in d["sources"][0]["note"]
    assert d["circuits"] == [] and "couldn't read" in d["message"]
    service.clear_cache()
    web(monkeypatch, routes(fetch.FetchError(404, "nothing")))
    assert client.post("/api/v1/papers/find", json={"paper": ID}).json()["sources"][0]["status"] == "missing"
    service.clear_cache()
    web(monkeypatch, routes(b"", meta=NO_ENTRY))
    r = client.post("/api/v1/papers/find", json={"paper": ID})
    assert r.status_code == 404 and "no paper" in r.json()["detail"]


def test_a_malicious_source_still_answers_honestly(monkeypatch):
    monkeypatch.setattr(archive, "MAX_UNPACKED", 3_000_000)
    web(monkeypatch, routes(tar_gz([("z.bin", b"\0" * 5_000_000, "file")])))
    d = client.post("/api/v1/papers/find", json={"paper": ID}).json()
    assert d["sources"][0]["status"] == "refused" and "unpacks to more than" in d["sources"][0]["note"]


def test_find_is_rate_limited_without_an_account(monkeypatch):
    web(monkeypatch, routes(tar_gz([("main.tex", TEX.encode(), "file")])))
    codes = []
    for i in range(8):
        service.clear_cache()
        codes.append(client.post("/api/v1/papers/find", json={"paper": ID}).status_code)
    assert codes[:6] == [200] * 6 and codes[6] == 429


# ---------------------------------------------------------------------------
# Runs, verdicts and saving
# ---------------------------------------------------------------------------

def test_without_calibration_runs_use_the_labelled_ideal_simulator():
    st = client.get("/api/v1/papers/status").json()
    assert st["calibration_available"] is False and "ideal" in st["reason"].lower()
    body = {"circuit": GHZ3, "shots": 2000, "reported": {"kind": "probability", "value": 0.82, "outcomes": ["000", "111"]}}
    r = client.post("/api/v1/papers/run", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["mode"] == "ideal" and d["real_hardware"] is False and "noiseless" in d["label"].lower()
    assert set(d["counts"]) == {"000", "111"} and sum(d["counts"].values()) == 2000
    c = d["comparison"]
    assert c["verdict"] == "ideal_only" and c["ours"] == 1.0 and "noise cost" in c["line"]
    assert client.post("/api/v1/papers/run", json=body).json()["counts"] == d["counts"]  # same inputs, same counts


def test_mid_circuit_measurement_runs_on_aer():
    qasm = ('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\ncreg c[2];\nx q[0];\nmeasure q[0] -> c[0];\n'
            'x q[0];\nmeasure q[0] -> c[1];')
    d = client.post("/api/v1/papers/run", json={"circuit": qasm, "shots": 100}).json()
    assert d["counts"] == {"01": 100} and "part-way" in d["method"]


def test_runs_refuse_bad_circuits_and_too_many_shots():
    assert client.post("/api/v1/papers/run", json={"circuit": "OPENQASM 2.0; nonsense"}).status_code == 422
    assert client.post("/api/v1/papers/run", json={"circuit": BELL, "shots": 5000}).status_code == 422
    assert client.post("/api/v1/papers/run", json={"circuit": BELL, "machine": "../x"}).status_code == 422
    r = client.post("/api/v1/papers/run", json={"circuit": BELL, "reported": {"kind": "probability", "value": 0.5}})
    assert r.status_code == 422


def test_calibrated_runs_use_rewind():
    with SessionLocal() as db:
        store.save(db, capture(FakeIBMBackend("ibm_line"), props_for(DAY)), "harvest")
    st = client.get("/api/v1/papers/status").json()
    assert st["calibration_available"] is True and st["machines"][0]["machine"] == "ibm_line"
    body = {"circuit": BELL, "machine": "ibm_line", "date": DAY.date().isoformat(), "shots": 1000,
            "reported": {"kind": "fidelity", "value": 0.9}}
    d = client.post("/api/v1/papers/run", json=body).json()
    assert d["mode"] == "calibrated" and "not affiliated" in d["label"] and len(d["snapshot"]["sha256"]) == 64
    c = d["comparison"]
    assert c["verdict"] in ("match", "lower", "higher") and c["reported"] == 0.9 and "Hellinger" in " ".join(c["notes"])
    latest = client.post("/api/v1/papers/run", json={"circuit": BELL, "machine": "ibm_line", "shots": 100}).json()
    assert latest["mode"] == "calibrated" and any("latest stored calibration" in n for n in latest["notes"])


def test_verdicts():
    res = {"counts": {"00": 470, "11": 480, "01": 30, "10": 20}, "shots": 1000, "mode": "calibrated",
           "ideal": {"hellinger_fidelity": 0.95}}
    m = compare.compare(res, {"kind": "probability", "value": 0.94, "outcomes": ["00", "11"]})
    assert m["verdict"] == "match" and m["line"].startswith("Matches the paper")
    lo = compare.compare(res, {"kind": "probability", "value": 0.99, "outcomes": ["00", "11"]})
    assert lo["verdict"] == "lower" and lo["line"].startswith("Lower than the paper")
    d = compare.compare(res, {"kind": "distribution", "distribution": {"00": 0.46, "11": 0.49, "01": 0.03, "10": 0.02}})
    assert d["verdict"] == "close"
    assert compare.compare(res, {"kind": "distribution", "distribution": {"00": 0.5, "11": 0.5}})["verdict"] == "rough" and d["rows"][0][0] in ("00", "11")
    far = compare.compare(res, {"kind": "distribution", "distribution": {"01": 0.5, "10": 0.5}})
    assert far["verdict"] == "differs"
    with pytest.raises(compare.CompareError):
        compare.compare(res, {"kind": "distribution", "distribution": {"000": 1}})
    # the paper writes bitstrings the other way round
    rev = {"counts": {"001": 900, "000": 100}, "shots": 1000, "mode": "calibrated", "ideal": {}}
    note = compare.compare(rev, {"kind": "distribution", "distribution": {"100": 0.9, "000": 0.1}})["notes"]
    assert any("other way round" in n for n in note)
    no = compare.compare({**res, "ideal": {"hellinger_fidelity": None, "reason": "measures part-way"}}, {"kind": "fidelity", "value": 0.9})
    assert no["verdict"] == "cannot" and "part-way" in no["line"]


def test_compare_endpoint_recomputes_without_running():
    r = client.post("/api/v1/papers/compare", json={
        "result": {"counts": {"00": 500, "11": 500}, "shots": 1000, "mode": "calibrated"},
        "reported": {"kind": "distribution", "distribution": {"00": 480, "11": 470, "01": 50}, "extracted": True}})
    assert r.status_code == 200, r.text
    assert r.json()["verdict"] == "rough" and any("extracted" in n for n in r.json()["notes"])


def test_save_needs_an_account_and_keeps_a_marked_run():
    body = {"arxiv_id": ID, "title": "A GHZ state", "origin": "main.tex", "source": "arXiv source", "circuit": GHZ3,
            "shots": 500, "project": "papers-proj", "reported": {"kind": "probability", "value": 0.8, "outcomes": ["000", "111"]}}
    assert client.post("/api/v1/papers/save", json=body).status_code == 401
    h = make_user(prefix="pp")
    r = client.post("/api/v1/papers/save", json=body, headers=h)
    assert r.status_code == 200, r.text
    run = client.get(f"/api/v1/runs/{r.json()['run_id']}", headers=h).json()
    assert run["backend"] == "aer_simulator" and set(run["tags"]) == {"paper", "simulated", f"arxiv:{ID}", "ideal"}
    paper = run["context"]["paper"]
    assert paper["arxiv_id"] == ID and paper["mode"] == "ideal" and paper["real_hardware"] is False
    assert paper["comparison"]["verdict"] == "ideal_only" and paper["reported"]["value"] == 0.8
    assert run["execution"]["real_hardware"] is False and sum(run["results"]["counts"].values()) == 500
    bad = client.post("/api/v1/papers/save", json={**body, "arxiv_id": "not an id"}, headers=h)
    assert bad.status_code == 422


def test_the_ideal_label_never_claims_hardware():
    assert "noiseless" in pr.IDEAL_LABEL and "not what a real machine gives" in pr.IDEAL_LABEL


def test_metadata_falls_back_to_the_abs_page_when_the_api_is_busy(monkeypatch):
    page = ('<html><head><meta name="citation_title" content="Open Quantum &amp; Assembly" />'
            '<meta name="citation_author" content="Cross, Andrew W." /><meta name="citation_date" content="2017/07/11" />'
            '<meta name="citation_abstract" content="We describe it." /></head><body><table>'
            '<td class="tablecell comments mathjax">24 pages, see <a href="https://github.com/someone/ghz-paper">this https URL</a></td>'
            '</table></body></html>').encode()
    repo = zip_bytes([("ghz-paper-1/bell.qasm", BELL.encode(), stat.S_IFREG | 0o644)])
    web(monkeypatch, {"https://export.arxiv.org/api/query": fetch.FetchError(503, "slow down"),
                      f"https://arxiv.org/abs/{ID}": page, f"https://arxiv.org/src/{ID}": b"%PDF-1.4",
                      "https://github.com/someone/ghz-paper/archive/HEAD.zip": repo})
    d = client.post("/api/v1/papers/find", json={"paper": ID}).json()
    assert d["title"] == "Open Quantum & Assembly" and d["authors"] == ["Cross, Andrew W."] and d["published"] == "2017-07-11"
    assert d["sources"][1]["name"] == "GitHub someone/ghz-paper" and d["circuits"][0]["origin"] == "bell.qasm"


def test_headerless_openqasm3_files_and_invalid_example_folders():
    q3 = '/* a comment */\ninclude "stdgates.inc";\nqubit[2] q;\nbit[2] c;\nh q[0];\ncx q[0], q[1];\nc = measure q;\n'
    got = circuits.find({"examples/bell3.qasm": q3.encode(), "tests/invalid/bad.qasm": b"qubit q; nonsense"}, "x")
    assert [c["origin"] for c in got["circuits"]] == ["examples/bell3.qasm"]
    assert got["circuits"][0]["ok"] and got["circuits"][0]["qasm"].startswith("OPENQASM 3.0;")
