"""scripts/check_prices.py: each page extractor, mismatch detection, and unreadable pages.

Offline: the pages are small hand-written excerpts with the same structure as the live pages
(checked against them on 2026-11-06). The scheduled workflow runs the script against the live pages.
"""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

_PATH = Path(__file__).resolve().parents[2] / "scripts" / "check_prices.py"
_spec = importlib.util.spec_from_file_location("check_prices", _PATH)
cp = importlib.util.module_from_spec(_spec)
sys.modules["check_prices"] = cp  # dataclasses look their module up here
_spec.loader.exec_module(cp)

BRAKET_HTML = """
<h2>Quantum Computers</h2><table><tr><th>Hardware Provider </th><th>QPU family </th>
<th>Per-task price </th><th>Per-shot price </th></tr>
<tr><td>AQT</td><td>IBEX-Q1</td><td>$0.30000</td><td>$0.02350</td></tr>
<tr><td>IonQ</td><td>Forte</td><td>$0.30000</td><td>$0.08000</td></tr>
<tr><td>Rigetti</td><td>Cepheus</td><td>$0.30000</td><td>$0.000425</td></tr>
</table><p>Reservation Mode</p><table><tr><td>IonQ</td><td>Forte</td><td>$7,000.00</td></tr></table>
"""

AZURE_HTML = """
<h2>IonQ</h2><p>Pay As You Go</p><table>
<tr><td>IonQ Aria 1</td><td>USD0.000220 / 1-qubit-gate shot<br>USD0.000975 / 2-qubit-gate shot<br>
Minimum price per program execution: USD97.50 - default setting, error mitigation is on<br>
USD12.4166 if error mitigation is off</td></tr>
<tr><td>IonQ Forte 1</td><td>USD0.0001645 / 1-qubit-gate shot<br>USD0.001121 / 2-qubit-gate shot<br>
Minimum price per program execution: USD168.195 - default setting, error mitigation is on<br>
USD25.7899 if error mitigation is off</td></tr></table>
<h2>Pasqal</h2><p>EUR 3,000 per QPU-hour + Azure infrastructure costs</p>
<h2>Quantinuum</h2><p>System Model H2 Per HQC usage + Azure infrastructure costs</p>
<p>please contact Quantinuum sales at Sales@Quantinuum.com.</p>
<h2>Rigetti</h2><p>USD 0.02 per 10-millisecond increment of job execution time</p>
"""

IBM_HTML = """
<div>Open Plan</div><div>Access quantum computers for up to 10 minutes of runtime per month.</div><div>Free</div>
<div>Pay-As-You-Go Plan</div><div>Pay for what you use.</div><div>Starts at $96 USD / minute</div>
<div>Flex Plan</div><div>Pre-purchase time.</div><div>Starts at $72 USD / minute</div>
<div>Premium Plan</div><div>Annual subscription.</div><div>Starts at $48 USD / minute</div>
"""

IQM_HTML = "<h3>Pay-as-you-go</h3><p>(billed in QPU seconds)</p><p>starting at $0.30/sec</p>"

SV1_JSON = json.dumps({"regions": {"US East (N. Virginia)": {
    "SV1 Simulator Task per minutes": {"price": "0.0750000000", "Version": "SV1"},
    "DM1 Simulator Task per minutes": {"price": "0.0750000000", "Version": "DM1"},
}}}).encode()

PAGES = {
    cp.BRAKET_PAGE: BRAKET_HTML.encode(),
    cp.BRAKET_PRICE_FILE: SV1_JSON,
    cp.AZURE_PAGE: AZURE_HTML.encode(),
    cp.IBM_PAGE: IBM_HTML.encode(),
    cp.IQM_PAGE: IQM_HTML.encode(),
}


def _table():
    return json.loads(cp.TABLE.read_text(encoding="utf-8"))["entries"]


def test_braket_table_rows():
    rows = cp.parse_braket_qpus(cp.html_to_lines(BRAKET_HTML))
    assert rows["braket_ionq_forte"] == {"per_task_usd": 0.30, "per_shot_usd": 0.08}
    assert rows["braket_rigetti_cepheus"]["per_shot_usd"] == 0.000425
    assert "braket_iqm_garnet" not in rows  # not in this excerpt


def test_reservation_prices_are_not_read_as_on_demand():
    rows = cp.parse_braket_qpus(cp.html_to_lines(BRAKET_HTML))
    assert all(r["per_task_usd"] < 1 for r in rows.values())


def test_azure_ionq_minimums_keep_mitigation_on_and_off_apart():
    found = cp.parse_azure(cp.html_to_lines(AZURE_HTML))
    forte = found["azure_ionq_forte"]
    assert forte["min_usd_per_task"] == 25.7899
    assert forte["min_usd_per_task_error_mitigation"] == 168.195
    assert found["azure_rigetti_cepheus"]["per_second"] == pytest.approx(2.0)
    assert found["azure_pasqal_fresnel"]["per_second"] == pytest.approx(3000 / 3600)
    assert found["azure_quantinuum_h2"] == {"model": "not_public"}


def test_ibm_and_iqm():
    ibm = cp.parse_ibm(cp.html_to_lines(IBM_HTML))
    assert ibm["ibm_payg"]["per_second"] == pytest.approx(1.6)
    assert ibm["ibm_premium"]["per_second"] == pytest.approx(0.8)
    assert ibm["ibm_open"] == {"model": "free"}
    assert cp.parse_iqm(cp.html_to_lines(IQM_HTML)) == {"iqm_resonance": {"per_second": 0.30}}


def test_current_table_matches_the_excerpts():
    published, failures = cp.collect(lambda url: PAGES[url])
    assert not failures
    outcomes = {o.key: o for o in cp.compare(_table(), published, failures)}
    for key in ("braket_ionq_forte", "braket_sv1", "azure_ionq_forte", "ibm_payg", "iqm_resonance"):
        assert outcomes[key].status == "match", outcomes[key]
    # Entries missing from the excerpts are reported as not checked, never as matching.
    assert outcomes["braket_iqm_garnet"].status == "unparsed"
    assert outcomes["local_simulator"].status == "skipped"


def test_changed_price_is_an_error_naming_the_entry(capsys):
    pages = dict(PAGES)
    pages[cp.BRAKET_PAGE] = BRAKET_HTML.replace("$0.08000", "$0.09000").encode()
    published, failures = cp.collect(lambda url: pages[url])
    outcomes = cp.compare(_table(), published, failures)
    forte = next(o for o in outcomes if o.key == "braket_ionq_forte")
    assert forte.status == "mismatch"
    assert forte.details == ["per_shot_usd: table 0.08, published 0.09"]
    cp.report(outcomes)
    out = capsys.readouterr().out
    assert "::error file=backend/app/provider_prices.json,title=Price mismatch: braket_ionq_forte::" in out


def test_unreadable_page_is_a_warning_not_a_pass(capsys):
    def fetcher(url):
        if url == cp.IQM_PAGE:
            raise OSError("connection refused")
        if url == cp.IBM_PAGE:
            return b"<html><body>We redesigned this page.</body></html>"
        return PAGES[url]

    published, failures = cp.collect(fetcher)
    outcomes = {o.key: o for o in cp.compare(_table(), published, failures)}
    assert outcomes["iqm_resonance"].status == "unparsed"
    assert "connection refused" in outcomes["iqm_resonance"].details[0]
    assert outcomes["ibm_payg"].status == "unparsed"
    cp.report(list(outcomes.values()))
    out = capsys.readouterr().out
    assert "::warning file=backend/app/provider_prices.json,title=Price not checked: iqm_resonance::" in out


def test_write_records_url_and_date_for_matches_only():
    table = {"entries": {"a": {"verified_on": "2026-01-01"}, "b": {"verified_on": "2026-01-01"}}}
    outcomes = [cp.Outcome("a", "match", "https://x/"), cp.Outcome("b", "mismatch", "https://y/", ["d"])]
    assert cp.record_retrieval(table, outcomes, "2026-11-06") == 1
    assert table["entries"]["a"] == {"verified_on": "2026-11-06",
                                     "price_check": {"url": "https://x/", "retrieved_on": "2026-11-06"}}
    assert table["entries"]["b"] == {"verified_on": "2026-01-01"}
