"""qlab ci check: TVD against a baseline with a shot-noise threshold, JUnit output, exit codes."""
import json
import random
from xml.etree import ElementTree as ET

import pytest

from qlab import ci, cli


def _sample(probs: dict, shots: int, seed: int) -> dict:
    rng = random.Random(seed)
    keys, weights = zip(*probs.items())
    out: dict = {}
    for k in rng.choices(keys, weights=weights, k=shots):
        out[k] = out.get(k, 0) + 1
    return out


def test_tvd():
    assert ci.tvd({"00": 50, "11": 50}, {"00": 50, "11": 50}) == 0
    assert ci.tvd({"00": 100}, {"11": 10}) == 1
    assert ci.tvd({"00": 75, "11": 25}, {"00": 50, "11": 50}) == pytest.approx(0.25)


def test_noise_bound_shrinks_with_shots():
    assert ci.noise_bound(100, 4, 0.01) > ci.noise_bound(10_000, 4, 0.01)
    assert ci.noise_bound(1000, 4, 0.01) == pytest.approx(((4 * 0.6931471805599453 + 5.298317366548036) / 2000) ** 0.5)


def test_same_distribution_passes_across_many_seeds():
    bell = {"00": 0.48, "11": 0.48, "01": 0.02, "10": 0.02}
    failures = sum(
        not ci.check_counts(_sample(bell, 2000, s), _sample(bell, 2000, s + 1000))["passed"]
        for s in range(200)
    )
    assert failures == 0  # the bound is conservative: alpha=0.01 is an upper limit


def test_real_regression_fails():
    bell = {"00": 0.5, "11": 0.5}
    broken = {"00": 0.35, "11": 0.35, "01": 0.15, "10": 0.15}
    r = ci.check_counts(_sample(broken, 4000, 1), _sample(bell, 4000, 2))
    assert not r["passed"] and r["tvd"] > r["threshold"]


def test_margin_loosens():
    a, b = {"00": 650, "11": 350}, {"00": 500, "11": 500}
    assert not ci.check_counts(a, b)["passed"]
    assert ci.check_counts(a, b, margin=0.05)["passed"]


def test_counts_of_run_and_lists():
    assert ci.counts_of_run({"results": {"counts": [{"0 0": 3}, {"11": 1}]}}) == {"00": 3}
    assert ci.counts_of_run({"results": {}}) == {}


def _run_cli(monkeypatch, runs: dict, argv: list) -> int:
    monkeypatch.setattr(cli, "_get", lambda cfg, path, params=None: runs[path.rsplit("/", 1)[-1]])
    with pytest.raises(SystemExit) as exc:
        cli.main(argv)
    return exc.value.code


def test_cli_pass_and_junit(monkeypatch, tmp_path, capsys):
    runs = {"new": {"results": {"counts": {"00": 502, "11": 498}}},
            "base": {"results": {"counts": {"00": 497, "11": 503}}}}
    report = tmp_path / "out" / "junit.xml"
    code = _run_cli(monkeypatch, runs, ["ci", "check", "--run", "new", "--baseline", "base",
                                        "--junit", str(report)])
    assert code == 0
    assert "PASS" in capsys.readouterr().out
    suite = ET.parse(report).getroot().find("testsuite")
    assert suite.get("tests") == "1" and suite.get("failures") == "0"


def test_cli_regression_exits_1(monkeypatch, tmp_path):
    runs = {"new": {"results": {"counts": {"00": 300, "01": 400, "11": 300}}},
            "base": {"results": {"counts": {"00": 500, "11": 500}}}}
    report = tmp_path / "junit.xml"
    code = _run_cli(monkeypatch, runs, ["ci", "check", "--run", "new", "--baseline", "base",
                                        "--junit", str(report), "--margin", "0.01"])
    assert code == 1
    case = ET.parse(report).getroot().find("testsuite/testcase")
    assert case.find("failure") is not None
    assert "TVD" in case.find("failure").text


def test_cli_missing_counts_exits_2(monkeypatch, tmp_path):
    runs = {"new": {"results": {}}, "base": {"results": {"counts": {"0": 1}}}}
    report = tmp_path / "junit.xml"
    code = _run_cli(monkeypatch, runs, ["ci", "check", "--run", "new", "--baseline", "base",
                                        "--junit", str(report)])
    assert code == 2
    assert ET.parse(report).getroot().find("testsuite/testcase/error") is not None


def test_cli_local_json_files(tmp_path, capsys):
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    a.write_text(json.dumps({"0": 1000}))
    b.write_text(json.dumps({"results": {"counts": {"1": 1000}}}))
    with pytest.raises(SystemExit) as exc:
        cli.main(["ci", "check", "--run", str(a), "--baseline", str(b), "--json"])
    assert exc.value.code == 1
    out = json.loads(capsys.readouterr().out)
    assert out["tvd"] == 1 and out["passed"] is False
