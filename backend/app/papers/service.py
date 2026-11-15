"""Find one arXiv paper's circuits: its metadata, its source files, and a GitHub repository its
abstract or comments link (at most MAX_REPOS). Answers are kept for CACHE_TTL_S per paper, so a
shared link or a second visitor doesn't fetch the paper again.
"""
from __future__ import annotations

import re
import threading
import time
import xml.etree.ElementTree as ET
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import quote

from . import archive, circuits, fetch

MAX_META_BYTES = 1_000_000
MAX_EPRINT_BYTES = 30_000_000
MAX_REPO_BYTES = 25_000_000
MAX_REPOS = 2
CACHE_TTL_S = 6 * 3600
CACHE_SIZE = 128
CONCURRENT = 2
API_GAP_S = 3.0

PYTHON_ONLY = ("This paper's circuits are in Python code, which Q-Lab won't run for safety — "
               "export them to OpenQASM (qiskit.qasm2.dumps or qiskit.qasm3.dumps) and paste them below.")

_ID = r"(?P<id>\d{4}\.\d{4,5}|[a-z][a-z.\-]{1,30}/\d{7})(?P<v>v\d{1,3})?"
_BARE = re.compile(rf"^(?:arxiv:\s*)?{_ID}$", re.I)
_URL = re.compile(rf"^(?:https?://)?(?:www\.|export\.)?arxiv\.org/(?:abs|pdf|html|src|e-print|format)/{_ID}(?:\.pdf)?/?(?:[?#].*)?$", re.I)
_GITHUB = re.compile(r"github\.com/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/([A-Za-z0-9._-]{1,100})")
_ATOM = {"a": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}


class PaperError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def parse_id(text: str) -> str:
    """The arXiv id (with its version, if given) in a pasted id or arxiv.org link."""
    t = (text or "").strip()
    if not t or len(t) > 300:
        raise PaperError(422, "Paste an arXiv link (arxiv.org/abs/…) or an arXiv id like 1707.03429.")
    m = _BARE.match(t) or _URL.match(t)
    if not m:
        raise PaperError(422, "That isn't an arXiv link or id. Q-Lab reads papers from arXiv: paste a link like "
                              "arxiv.org/abs/1707.03429 or just the id.")
    pid = m.group("id")
    if "/" in pid:
        archive_name, num = pid.split("/", 1)
        pid = f"{archive_name.lower()}/{num}"
    return pid + (m.group("v") or "").lower()


def github_repos(*texts: Optional[str]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for t in texts:
        for owner, repo in _GITHUB.findall(t or ""):
            repo = re.sub(r"\.git$", "", repo.rstrip("._-"))
            if not repo or repo in (".", "..") or owner.lower() in ("orgs", "features", "about", "topics", "sponsors"):
                continue
            if (owner.lower(), repo.lower()) not in {(o.lower(), r.lower()) for o, r in out}:
                out.append((owner, repo))
    return out[:MAX_REPOS]


def _txt(el: Optional[ET.Element]) -> Optional[str]:
    return " ".join(el.text.split()) if el is not None and el.text else None


_polite_lock = threading.Lock()
_last_api_call = [0.0]


def _polite() -> None:
    """arXiv asks API clients to leave 3 seconds between requests; this process does."""
    with _polite_lock:
        wait = _last_api_call[0] + API_GAP_S - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_api_call[0] = time.monotonic()


_META = re.compile(r'<meta\s+name="citation_([a-z_]+)"\s+content="([^"]*)"', re.I)
_COMMENTS = re.compile(r'<td class="tablecell comments[^"]*">(.*?)</td>', re.S)
_TAG = re.compile(r"<[^>]+>")
_HREF = re.compile(r'href="(https://github\.com/[^"]+)"')


def metadata_from_abs(arxiv_id: str) -> dict[str, Any]:
    """The same facts from the paper's arxiv.org/abs page (its citation meta tags and Comments row),
    for when the export API is slow or rate-limited. Read as text with patterns; nothing is run."""
    import html

    got = fetch.get(f"https://arxiv.org/abs/{quote(arxiv_id, safe='/.')}", MAX_META_BYTES, timeout_s=30)
    page = got.body.decode("utf-8", errors="replace")
    tags: dict[str, list[str]] = {}
    for name, content in _META.findall(page):
        tags.setdefault(name.lower(), []).append(" ".join(html.unescape(content).split()))
    title = (tags.get("title") or [None])[0]
    if not title:
        raise PaperError(404, f"arXiv has no paper {arxiv_id}.")
    authors = tags.get("author") or []
    m = _COMMENTS.search(page)
    comment = None
    if m:
        links = " ".join(_HREF.findall(m.group(1)))
        comment = " ".join(html.unescape(_TAG.sub(" ", m.group(1))).split()) + (f" {links}" if links else "")
    date = (tags.get("date") or [None])[0]
    return {"arxiv_id": arxiv_id, "version_id": arxiv_id, "title": title, "authors": authors[:20],
            "authors_total": len(authors), "abstract": (tags.get("abstract") or [None])[0], "comment": comment,
            "published": date.replace("/", "-") if date else None, "url": f"https://arxiv.org/abs/{arxiv_id}"}


def metadata(arxiv_id: str) -> dict[str, Any]:
    """From arXiv's export API; from the abs page if the API is slow, busy or failing."""
    _polite()
    try:
        got = fetch.get(f"https://export.arxiv.org/api/query?id_list={quote(arxiv_id, safe='/.')}&max_results=1",
                        MAX_META_BYTES, timeout_s=20)
    except fetch.FetchError as exc:
        if exc.status in (502, 503, 504):
            return metadata_from_abs(arxiv_id)
        raise
    try:
        root = ET.fromstring(got.body)
    except ET.ParseError:
        raise PaperError(502, "arXiv's answer couldn't be read; try again in a minute.") from None
    entry = root.find("a:entry", _ATOM)
    entry_id = _txt(entry.find("a:id", _ATOM)) if entry is not None else None
    title = _txt(entry.find("a:title", _ATOM)) if entry is not None else None
    if entry is None or not entry_id or "api/errors" in entry_id or not title:
        raise PaperError(404, f"arXiv has no paper {arxiv_id}.")
    return {
        "arxiv_id": arxiv_id,
        "version_id": entry_id.rsplit("/abs/", 1)[-1],
        "title": title,
        "authors": [a for a in (_txt(x.find("a:name", _ATOM)) for x in entry.findall("a:author", _ATOM)[:20]) if a],
        "authors_total": len(entry.findall("a:author", _ATOM)),
        "abstract": _txt(entry.find("a:summary", _ATOM)),
        "comment": _txt(entry.find("arxiv:comment", _ATOM)),
        "published": _txt(entry.find("a:published", _ATOM)),
        "url": f"https://arxiv.org/abs/{arxiv_id}",
    }


def _source(name: str, url: str) -> dict[str, Any]:
    return {"name": name, "url": url, "status": "error", "note": None, "files_read": 0, "skipped": [], "skipped_total": 0}


def _read(src: dict[str, Any], data: bytes, hint: Optional[str], strip_top: bool) -> dict[str, bytes]:
    got = archive.read_archive(data, hint)
    src["skipped"], src["skipped_total"] = got.skipped, got.skipped_total
    if got.refused:
        src.update(status="refused", note=got.refused)
        return {}
    if got.kind == "pdf":
        src.update(status="missing", note="arXiv has only the PDF of this paper, no source files to read circuits from.")
        return {}
    files = got.files
    if strip_top:
        files = {n.split("/", 1)[1]: b for n, b in files.items() if "/" in n}
    src.update(status="ok", files_read=len(files))
    return files


_cache: "OrderedDict[str, tuple[float, dict[str, Any]]]" = OrderedDict()
_cache_lock = threading.Lock()
_gate = threading.BoundedSemaphore(CONCURRENT)


def cached(arxiv_id: str) -> Optional[dict[str, Any]]:
    with _cache_lock:
        hit = _cache.get(arxiv_id)
        if hit and time.time() - hit[0] < CACHE_TTL_S:
            _cache.move_to_end(arxiv_id)
            return hit[1]
        _cache.pop(arxiv_id, None)
    return None


def _remember(arxiv_id: str, doc: dict[str, Any]) -> None:
    with _cache_lock:
        _cache[arxiv_id] = (time.time(), doc)
        _cache.move_to_end(arxiv_id)
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def find(text: str) -> dict[str, Any]:
    arxiv_id = parse_id(text)
    hit = cached(arxiv_id)
    if hit is not None:
        return {**hit, "cached": True}
    if not _gate.acquire(blocking=False):
        raise PaperError(503, "Q-Lab is already reading two papers; try again in a few seconds.")
    try:
        doc = _find(arxiv_id)
    finally:
        _gate.release()
    _remember(arxiv_id, doc)
    return {**doc, "cached": False}


def _find(arxiv_id: str) -> dict[str, Any]:
    try:
        meta = metadata(arxiv_id)
    except fetch.FetchError as exc:
        raise PaperError(404 if exc.status == 404 else 502, f"arXiv couldn't be asked about {arxiv_id}: {exc.message}") from None
    sources: list[dict[str, Any]] = []
    found: list[dict[str, Any]] = []

    src = _source("arXiv source", f"https://arxiv.org/src/{arxiv_id}")
    sources.append(src)
    try:
        got = fetch.get(src["url"], MAX_EPRINT_BYTES, timeout_s=40)
        files = _read(src, got.body, got.filename, strip_top=False)
        found.append(circuits.find(files, "arXiv source"))
    except fetch.FetchError as exc:
        src.update(status="missing" if exc.status == 404 else "error", note=exc.message)

    for owner, repo in github_repos(meta.get("abstract"), meta.get("comment")):
        src = _source(f"GitHub {owner}/{repo}", f"https://github.com/{owner}/{repo}")
        sources.append(src)
        try:
            got = fetch.get(f"https://github.com/{owner}/{repo}/archive/HEAD.zip", MAX_REPO_BYTES, timeout_s=40)
            files = _read(src, got.body, None, strip_top=True)
            found.append(circuits.find(files, f"GitHub {owner}/{repo}"))
        except fetch.FetchError as exc:
            src.update(status="missing" if exc.status == 404 else "error", note=exc.message)

    all_circuits: list[dict[str, Any]] = []
    seen: set[str] = set()
    more = 0
    values: list[dict[str, Any]] = []
    python_files: list[str] = []
    for part in found:
        more += part["more"]
        values += part["values"]
        python_files += [f"{c}" for c in part["python_files"]]
        for c in part["circuits"]:
            if c["id"] not in seen:
                seen.add(c["id"])
                all_circuits.append(c)
    all_circuits.sort(key=lambda c: not c["ok"])  # runnable first, otherwise in the order found
    usable = sum(1 for c in all_circuits if c["ok"])
    read_any = any(s["status"] == "ok" for s in sources)
    if usable:
        message = f"Found {usable} circuit{'s' if usable != 1 else ''} in OpenQASM that Q-Lab can run."
    elif all_circuits:
        message = ("Found OpenQASM, but none of it fits what Q-Lab can run here (each circuit says why). "
                   "You can paste a smaller version below.")
    elif python_files:
        message = PYTHON_ONLY
    elif read_any:
        message = ("No OpenQASM in the paper's files. Q-Lab only reads circuits written as OpenQASM 2 or 3; "
                   "if you have the circuit, paste it below.")
    else:
        message = "Q-Lab couldn't read any of this paper's files (see below). If you have the circuit, paste it as OpenQASM below."
    return {**meta, "sources": sources, "circuits": all_circuits, "more": more, "python_files": python_files[:20],
            "python_only": not all_circuits and bool(python_files), "values": values[:circuits.MAX_VALUES],
            "message": message, "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
