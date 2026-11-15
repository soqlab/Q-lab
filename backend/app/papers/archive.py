"""Read a paper's source archive (arXiv e-print: gzip'd tar or a single gzip'd file; GitHub: zip)
in memory, within limits. Nothing is written to disk and nothing in it is run.

Refused or skipped, and reported back: names that climb out of the archive (../, absolute paths,
drive letters), symbolic and hard links, devices and other special entries, single files over
MAX_FILE_BYTES, archives that unpack to more than MAX_UNPACKED bytes (decompression bombs), more
than MAX_MEMBERS entries, and zip entries compressed suspiciously well. Only the file types the
circuit finder reads are kept (WANTED).
"""
from __future__ import annotations

import io
import posixpath
import re
import stat
import tarfile
import time
import zipfile
import zlib
from dataclasses import dataclass, field
from typing import Optional

WANTED = (".qasm", ".qasm3", ".tex", ".md", ".txt", ".py", ".ipynb", ".json")
MAX_MEMBERS = 5_000          # archive entries looked at
MAX_FILE_BYTES = 512_000     # one kept file
MAX_TOTAL_READ = 16_000_000  # all kept files together
MAX_UNPACKED = 200_000_000   # bytes a gzip stream may unpack to
MAX_KEPT = 400               # files kept
MAX_ZIP_RATIO = 400          # uncompressed / compressed size of one zip entry
MAX_SECONDS = 20.0           # reading one archive
MAX_NOTES = 40


class ArchiveError(Exception):
    pass


class Truncated(ArchiveError):
    """The compressed stream ended before its end marker: damaged or cut short."""


@dataclass
class Files:
    kind: str                                    # tar, zip, single, pdf, empty
    files: dict[str, bytes] = field(default_factory=dict)
    skipped: list[dict[str, str]] = field(default_factory=list)
    skipped_total: int = 0
    refused: Optional[str] = None                # the whole archive was refused, and why

    def skip(self, name: str, reason: str) -> None:
        self.skipped_total += 1
        if len(self.skipped) < MAX_NOTES:
            self.skipped.append({"name": name[:200], "reason": reason})


_DRIVE = re.compile(r"^[A-Za-z]:")


def safe_name(name: str) -> Optional[str]:
    """The entry's name as a clean relative path, or None when it would land outside the archive."""
    if not name or "\x00" in name:
        return None
    n = name.replace("\\", "/")
    if n.startswith("/") or _DRIVE.match(n):
        return None
    parts = [p for p in n.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        return None
    return posixpath.join(*parts)


def wanted(name: str) -> bool:
    return name.lower().endswith(WANTED)


class _Gunzip(io.RawIOBase):
    """A gzip stream unpacked as it is read, refusing to go past MAX_UNPACKED bytes or MAX_SECONDS."""

    def __init__(self, data: bytes, deadline: float) -> None:
        self._src = memoryview(data)
        self._pos = 0
        self._d = zlib.decompressobj(16 + zlib.MAX_WBITS)
        self._pending = b""
        self._out = 0
        self._deadline = deadline

    def readable(self) -> bool:
        return True

    def readinto(self, b) -> int:
        want = len(b)
        while len(self._pending) < want:
            if time.monotonic() > self._deadline:
                raise ArchiveError("Reading the archive took too long.")
            if self._d.unconsumed_tail:
                chunk = self._d.decompress(self._d.unconsumed_tail, 1 << 20)
            elif self._pos < len(self._src):
                piece = self._src[self._pos:self._pos + (1 << 16)]
                self._pos += len(piece)
                chunk = self._d.decompress(piece, 1 << 20)
            else:
                if not self._d.eof and not self._pending:
                    raise Truncated("The compressed file is damaged or cut short.")
                break
            self._out += len(chunk)
            if self._out > MAX_UNPACKED:
                raise ArchiveError(f"The archive unpacks to more than {MAX_UNPACKED // 1_000_000} MB, "
                                   "so Q-Lab stopped reading it.")
            self._pending += chunk
        n = min(want, len(self._pending))
        b[:n] = self._pending[:n]
        self._pending = self._pending[n:]
        return n


def _keep(out: Files, name: str, data: bytes, total: list[int]) -> None:
    if len(out.files) >= MAX_KEPT:
        out.skip(name, f"more than {MAX_KEPT} readable files; the rest were not read")
        return
    if total[0] + len(data) > MAX_TOTAL_READ:
        out.skip(name, "the files read so far already reach the size limit")
        return
    total[0] += len(data)
    out.files[name] = data


def _read_tar(fileobj, out: Files, deadline: float) -> None:
    total = [0]
    seen = 0
    try:
        with tarfile.open(fileobj=fileobj, mode="r|") as tf:
            for m in tf:
                seen += 1
                if seen > MAX_MEMBERS:
                    out.skip("…", f"the archive has more than {MAX_MEMBERS} entries; the rest were not read")
                    break
                if time.monotonic() > deadline:
                    raise ArchiveError("Reading the archive took too long.")
                if m.isdir():
                    continue
                name = safe_name(m.name)
                if name is None:
                    out.skip(m.name, "refused: the name points outside the archive")
                    continue
                if m.issym() or m.islnk():
                    out.skip(name, "refused: links are never followed")
                    continue
                if not m.isreg():
                    out.skip(name, "refused: not a regular file")
                    continue
                if not wanted(name):
                    continue
                if m.size > MAX_FILE_BYTES:
                    out.skip(name, f"over {MAX_FILE_BYTES // 1000} kB")
                    continue
                f = tf.extractfile(m)
                if f is None:
                    continue
                _keep(out, name, f.read(MAX_FILE_BYTES + 1)[:MAX_FILE_BYTES], total)
    except Truncated:
        if not out.files:
            raise
        out.skip("…", "the archive ended early; files after that point were not read")
    except ArchiveError:
        raise
    except (tarfile.TarError, EOFError, zlib.error, OSError) as exc:
        if not out.files:
            raise ArchiveError(f"The archive couldn't be read ({type(exc).__name__}).") from None
        out.skip("…", "the archive ended early; files after that point were not read")


def _read_zip(data: bytes, out: Files, deadline: float) -> None:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, ValueError, OSError):
        raise ArchiveError("The zip file couldn't be read.") from None
    infos = zf.infolist()
    if len(infos) > MAX_MEMBERS * 4:
        raise ArchiveError(f"The repository archive has {len(infos)} entries; Q-Lab reads up to {MAX_MEMBERS * 4}.")
    total = [0]
    for info in infos:
        if time.monotonic() > deadline:
            raise ArchiveError("Reading the archive took too long.")
        if info.is_dir():
            continue
        name = safe_name(info.filename)
        if name is None:
            out.skip(info.filename, "refused: the name points outside the archive")
            continue
        mode = (info.external_attr >> 16) & 0xFFFF
        if mode and stat.S_IFMT(mode) not in (0, stat.S_IFREG):
            out.skip(name, "refused: links and special files are never followed")
            continue
        if not wanted(name):
            continue
        if info.file_size > MAX_FILE_BYTES:
            out.skip(name, f"over {MAX_FILE_BYTES // 1000} kB")
            continue
        if info.compress_size and info.file_size / info.compress_size > MAX_ZIP_RATIO:
            out.skip(name, "refused: compressed suspiciously well (a possible decompression bomb)")
            continue
        try:
            with zf.open(info) as f:
                raw = f.read(MAX_FILE_BYTES + 1)
        except (zipfile.BadZipFile, NotImplementedError, RuntimeError, zlib.error, OSError, EOFError):
            out.skip(name, "couldn't be unpacked")
            continue
        if len(raw) > MAX_FILE_BYTES:
            out.skip(name, f"over {MAX_FILE_BYTES // 1000} kB once unpacked")
            continue
        _keep(out, name, raw, total)


def read_archive(data: bytes, name_hint: Optional[str] = None) -> Files:
    """The wanted files in data (a tar, gzip'd tar, gzip'd single file, zip, or plain file)."""
    deadline = time.monotonic() + MAX_SECONDS
    if not data:
        return Files(kind="empty")
    if data[:5] == b"%PDF-":
        return Files(kind="pdf")
    try:
        if data[:2] == b"\x1f\x8b":
            head = _Gunzip(data, deadline).read(512)
            if len(head) >= 262 and head[257:262] == b"ustar":
                out = Files(kind="tar")
                _read_tar(io.BufferedReader(_Gunzip(data, deadline), 1 << 16), out, deadline)
                return out
            if head[:5] == b"%PDF-":
                return Files(kind="pdf")
            out = Files(kind="single")
            body = io.BufferedReader(_Gunzip(data, deadline)).read(MAX_FILE_BYTES + 1)
            name = safe_name(re.sub(r"\.gz$", "", posixpath.basename(name_hint or "")) or "") or "main.tex"
            if not wanted(name):
                name = "main.tex"
            if len(body) > MAX_FILE_BYTES:
                out.skip(name, f"over {MAX_FILE_BYTES // 1000} kB")
            else:
                out.files[name] = body
            return out
        if data[:4] == b"PK\x03\x04" or data[:4] == b"PK\x05\x06":
            out = Files(kind="zip")
            _read_zip(data, out, deadline)
            return out
        if len(data) >= 262 and data[257:262] == b"ustar":
            out = Files(kind="tar")
            _read_tar(io.BytesIO(data), out, deadline)
            return out
    except ArchiveError as exc:
        return Files(kind="refused", refused=str(exc))
    except zlib.error:
        return Files(kind="refused", refused="The compressed file is damaged.")
    out = Files(kind="single")
    if len(data) > MAX_FILE_BYTES:
        out.skip(name_hint or "source", f"over {MAX_FILE_BYTES // 1000} kB")
    else:
        out.files["main.tex"] = data
    return out
