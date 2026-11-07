"""Check Q-Lab's price table against the prices the providers publish.

    python scripts/check_prices.py            # report only
    python scripts/check_prices.py --write    # also record today's retrieval for entries that match

Each entry of backend/app/provider_prices.json is compared with the page named in its
``source`` (and, for the Braket simulators, the AWS price file that page loads). Every page
has its own extractor: a generic "find a dollar sign" scraper would quietly read the wrong
number the day a page is reorganised.

Outcomes, one per entry:
  match     the published figures equal the table
  mismatch  a published figure differs: printed as a GitHub ``::error`` and the exit code is 1
  unparsed  the page could not be fetched, or its layout no longer matches the extractor:
            printed as a ``::warning`` (exit code 2 with --strict), never counted as a match
  skipped   nothing to compare (local simulator; providers that publish no price list)

Standard library only, so the scheduled workflow needs no install step.
"""

from __future__ import annotations

import argparse
import gzip
import html
import json
import os
import re
import sys
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

TABLE = Path(__file__).resolve().parent.parent / "backend" / "app" / "provider_prices.json"
TABLE_REL = "backend/app/provider_prices.json"
USER_AGENT = "Mozilla/5.0 (compatible; qlab-price-check/1.0; +https://github.com/soqlab/Q-lab)"

BRAKET_PAGE = "https://aws.amazon.com/braket/pricing/"
# The simulator rates on the Braket page are filled in by script from this file.
BRAKET_PRICE_FILE = "https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/braket/USD/current/braket.json"
AZURE_PAGE = "https://learn.microsoft.com/en-us/azure/quantum/pricing"
IBM_PAGE = "https://www.ibm.com/quantum/pricing"
IQM_PAGE = "https://iqm.tech/products/iqm-resonance/"


class ParseError(Exception):
    """The page no longer has the structure the extractor expects."""


# ── Fetching ────────────────────────────────────────────────────────────────────────────

def fetch(url: str, timeout: float = 30.0) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (fixed https URLs)
        raw = resp.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return raw


def html_to_lines(raw: str) -> list[str]:
    """Visible text of an HTML page, one block element per line, whitespace collapsed."""
    raw = re.sub(r"(?is)<(script|style|noscript|template)\b[^>]*>.*?</\1>", " ", raw)
    raw = re.sub(r"(?i)<(br|/p|/tr|/li|/h\d|/div|/td|/th)\b[^>]*>", "\n", raw)
    text = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    lines = []
    for line in text.splitlines():
        line = re.sub(r"\s+", " ", line.replace("\xa0", " ")).strip()
        if line:
            lines.append(line)
    return lines


def _money(s: str) -> float:
    return float(s.replace(",", ""))


# ── Extractors: page -> {entry key: {field: published value}} ───────────────────────────

# Braket "Quantum Computers" table: QPU family -> entry key.
BRAKET_FAMILIES = {
    "IBEX-Q1": "braket_aqt_ibex_q1",
    "Forte": "braket_ionq_forte",
    "Emerald": "braket_iqm_emerald",
    "Garnet": "braket_iqm_garnet",
    "Aquila": "braket_quera_aquila",
    "Cepheus": "braket_rigetti_cepheus",
}
_DOLLAR = re.compile(r"^\$\s*([\d,]*\.?\d+)$")


def parse_braket_qpus(lines: list[str]) -> dict[str, dict[str, float]]:
    """Rows of the on-demand table: provider, QPU family, per-task price, per-shot price."""
    try:
        start = next(i for i, ln in enumerate(lines)
                     if ln.lower() == "per-shot price" and lines[i - 1].lower() == "per-task price")
    except StopIteration:
        raise ParseError("Braket on-demand table header (Per-task price / Per-shot price) not found") from None
    found: dict[str, dict[str, float]] = {}
    i = start + 1
    while i + 3 < len(lines) and i < start + 200:
        if lines[i].lower().startswith("reservation"):
            break
        family = lines[i + 1]
        task = _DOLLAR.match(lines[i + 2])
        shot = _DOLLAR.match(lines[i + 3])
        if task and shot:
            key = BRAKET_FAMILIES.get(family)
            if key:
                found[key] = {"per_task_usd": _money(task.group(1)), "per_shot_usd": _money(shot.group(1))}
            i += 4
        else:
            i += 1
    if not found:
        raise ParseError("Braket on-demand table has no rows in the expected layout")
    return found


def parse_braket_simulators(raw: bytes, region: str = "US East (N. Virginia)") -> dict[str, dict[str, float]]:
    try:
        data = json.loads(raw)
        rates = data["regions"][region]
    except Exception as error:
        raise ParseError(f"Braket price file unreadable: {error}") from None
    for name, rate in rates.items():
        if rate.get("Version") == "SV1" and "minute" in name.lower():
            return {"braket_sv1": {"per_minute": float(rate["price"])}}
    raise ParseError(f"SV1 per-minute rate not found for {region}")


AZURE_IONQ = {"IonQ Aria 1": "azure_ionq_aria", "IonQ Forte 1": "azure_ionq_forte"}


def parse_azure(lines: list[str]) -> dict[str, dict[str, float]]:
    found: dict[str, dict[str, float]] = {}
    for device, key in AZURE_IONQ.items():
        try:
            at = lines.index(device)  # first occurrence: the Pay As You Go table
        except ValueError:
            continue
        block = " | ".join(lines[at + 1: at + 7])
        one = re.search(r"USD\s*([\d.,]+)\s*/\s*1-qubit-gate shot", block)
        two = re.search(r"USD\s*([\d.,]+)\s*/\s*2-qubit-gate shot", block)
        em_on = re.search(r"USD\s*([\d.,]+)[^|]*error mitigation is on", block)
        em_off = re.search(r"USD\s*([\d.,]+)\s*if error mitigation is off", block)
        if one and two and em_on and em_off:
            found[key] = {
                "usd_per_1q_gate_shot": _money(one.group(1)),
                "usd_per_2q_gate_shot": _money(two.group(1)),
                "min_usd_per_task": _money(em_off.group(1)),
                "min_usd_per_task_error_mitigation": _money(em_on.group(1)),
            }
    text = "\n".join(lines)
    rigetti = re.search(r"USD\s*([\d.]+)\s*per\s*10-millisecond increment", text)
    if rigetti:
        found["azure_rigetti_cepheus"] = {"per_second": round(_money(rigetti.group(1)) / 0.010, 9)}
    pasqal = re.search(r"EUR\s*([\d,.]+)\s*per QPU-hour", text)
    if pasqal:
        found["azure_pasqal_fresnel"] = {"per_second": _money(pasqal.group(1)) / 3600.0}
    # Quantinuum: still "per HQC" with the price only from sales -> stays not public.
    if re.search(r"Per HQC usage", text, re.I) and re.search(r"contact Quantinuum sales", text, re.I):
        found["azure_quantinuum_h2"] = {"model": "not_public"}
    if not found:
        raise ParseError("no Azure Quantum price block in the expected layout")
    return found


IBM_PLANS = {"Pay-As-You-Go Plan": "ibm_payg", "Flex Plan": "ibm_flex", "Premium Plan": "ibm_premium"}


def parse_ibm(lines: list[str]) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for plan, key in IBM_PLANS.items():
        try:
            at = lines.index(plan)
        except ValueError:
            continue
        for ln in lines[at + 1: at + 5]:
            m = re.search(r"\$\s*([\d.,]+)\s*USD\s*/\s*minute", ln)
            if m:
                found[key] = {"per_second": round(_money(m.group(1)) / 60.0, 9)}
                break
    if "Open Plan" in lines:
        at = lines.index("Open Plan")
        if "Free" in lines[at + 1: at + 4]:
            found["ibm_open"] = {"model": "free"}
    if not found:
        raise ParseError("no IBM plan price in the expected layout")
    return found


def parse_iqm(lines: list[str]) -> dict[str, dict[str, float]]:
    text = "\n".join(lines)
    if "Pay-as-you-go" not in text:
        raise ParseError("IQM Resonance pricing section (Pay-as-you-go) not found")
    m = re.search(r"starting at \$\s*([\d.]+)\s*/\s*sec", text, re.I)
    if not m:
        raise ParseError("IQM 'starting at $x/sec' price not found")
    return {"iqm_resonance": {"per_second": _money(m.group(1))}}


@dataclass
class Source:
    url: str
    parse: Callable[[bytes], dict]
    page: str  # the human-readable page this figure comes from


SOURCES = [
    Source(BRAKET_PAGE, lambda raw: parse_braket_qpus(html_to_lines(raw.decode("utf-8", "replace"))), BRAKET_PAGE),
    Source(BRAKET_PRICE_FILE, parse_braket_simulators, BRAKET_PAGE),
    Source(AZURE_PAGE, lambda raw: parse_azure(html_to_lines(raw.decode("utf-8", "replace"))), AZURE_PAGE),
    Source(IBM_PAGE, lambda raw: parse_ibm(html_to_lines(raw.decode("utf-8", "replace"))), IBM_PAGE),
    Source(IQM_PAGE, lambda raw: parse_iqm(html_to_lines(raw.decode("utf-8", "replace"))), IQM_PAGE),
]

# Entries with nothing to compare against.
SKIP = {
    "local_simulator": "runs locally, no price",
    "ionq_direct": "IonQ publishes no direct price list",
    "quantinuum_direct": "Quantinuum publishes no price list",
}


# ── Comparison ──────────────────────────────────────────────────────────────────────────

@dataclass
class Outcome:
    key: str
    status: str  # match | mismatch | unparsed | skipped
    url: str = ""
    details: list[str] = field(default_factory=list)


def _equal(a, b) -> bool:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= 1e-6 * max(1.0, abs(a), abs(b))
    return a == b


def compare(entries: dict[str, dict], published: dict[str, tuple[str, dict]],
            failures: dict[str, str]) -> list[Outcome]:
    """published: key -> (url, fields); failures: page url -> why it could not be read."""
    out: list[Outcome] = []
    for key, entry in entries.items():
        if key in SKIP:
            out.append(Outcome(key, "skipped", entry.get("source", ""), [SKIP[key]]))
            continue
        if key not in published:
            source = entry.get("source", "")
            why = failures.get(source) or "the page was read but this entry's price was not found on it"
            out.append(Outcome(key, "unparsed", source, [why]))
            continue
        url, fields = published[key]
        diffs = [f"{name}: table {entry.get(name)!r}, published {value!r}"
                 for name, value in fields.items() if not _equal(entry.get(name), value)]
        out.append(Outcome(key, "mismatch" if diffs else "match", url, diffs))
    return out


def collect(fetcher: Callable[[str], bytes] = fetch) -> tuple[dict[str, tuple[str, dict]], dict[str, str]]:
    published: dict[str, tuple[str, dict]] = {}
    failures: dict[str, str] = {}
    for src in SOURCES:
        try:
            raw = fetcher(src.url)
        except Exception as error:
            failures[src.page] = f"could not fetch {src.url}: {error.__class__.__name__}: {error}"
            continue
        try:
            for key, fields in src.parse(raw).items():
                published[key] = (src.url, fields)
        except ParseError as error:
            failures.setdefault(src.page, f"{src.url}: {error}")
    return published, failures


def _annotation(kind: str, title: str, message: str) -> str:
    message = message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    return f"::{kind} file={TABLE_REL},title={title}::{message}"


def report(outcomes: list[Outcome], stream=None) -> None:
    stream = stream or sys.stdout
    for o in outcomes:
        if o.status == "mismatch":
            for d in o.details:
                print(_annotation("error", f"Price mismatch: {o.key}", f"{o.key} {d} ({o.url})"), file=stream)
        elif o.status == "unparsed":
            print(_annotation("warning", f"Price not checked: {o.key}",
                              f"{o.key}: NOT verified. {'; '.join(o.details)}"), file=stream)
        elif o.status == "skipped":
            print(f"skipped   {o.key}: {'; '.join(o.details)}", file=stream)
        else:
            print(f"match     {o.key} ({o.url})", file=stream)
    counts = {s: sum(o.status == s for o in outcomes) for s in ("match", "mismatch", "unparsed", "skipped")}
    print("summary: " + ", ".join(f"{n} {s}" for s, n in counts.items()), file=stream)

    summary_path = os.getenv("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as fh:
            fh.write("## Provider price check\n\n| Entry | Result | Details |\n|---|---|---|\n")
            for o in outcomes:
                fh.write(f"| `{o.key}` | {o.status} | {'; '.join(o.details).replace('|', '/')} |\n")


def record_retrieval(table: dict, outcomes: list[Outcome], today: str) -> int:
    """For matching entries: verified_on = today and price_check = {url, retrieved_on}."""
    n = 0
    for o in outcomes:
        if o.status != "match":
            continue
        entry = table["entries"][o.key]
        entry["verified_on"] = today
        entry["price_check"] = {"url": o.url, "retrieved_on": today}
        n += 1
    return n


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--write", action="store_true",
                    help="record today's retrieval date and URL for entries that match")
    ap.add_argument("--strict", action="store_true", help="exit 2 when any entry could not be checked")
    args = ap.parse_args(argv)

    table = json.loads(TABLE.read_text(encoding="utf-8"))
    published, failures = collect()
    outcomes = compare(table["entries"], published, failures)
    report(outcomes)

    if args.write:
        today = datetime.now(timezone.utc).date().isoformat()
        if record_retrieval(table, outcomes, today):
            TABLE.write_text(json.dumps(table, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    if any(o.status == "mismatch" for o in outcomes):
        return 1
    if args.strict and any(o.status == "unparsed" for o in outcomes):
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
