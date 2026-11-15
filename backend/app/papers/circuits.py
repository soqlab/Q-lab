"""Find a paper's circuits in its files: OpenQASM 2/3 only, read by Qiskit's QASM parsers.

Code from papers and repositories is never executed. Python and notebooks are only looked at as
text: a triple-quoted OpenQASM string inside them is read like any other QASM block, and a file
that builds circuits in Python is counted so the answer can say so honestly.

Each circuit must fit what a replay can run: up to rewind.replay.max_qubits() qubits, MAX_DEPTH
layers, and rewind.replay.MAX_OPERATIONS operations once custom gate definitions are expanded (a
chain of gates that each call the next twice would otherwise grow exponentially). Includes other
than qelib1.inc / stdgates.inc are refused (machine_pick.refuse_file_includes).
"""
from __future__ import annotations

import hashlib
import json
import posixpath
import re
from typing import Any

from .. import machine_pick as mp
from ..rewind import replay as rp

MAX_CIRCUITS = 24
MAX_DEPTH = 2_000
MAX_NESTING = 16
MAX_VALUES = 10
MAX_DIST_KEYS = 4_096

_HEAD = re.compile(r"OPENQASM\s+[23](?:\.\d+)?\s*;")
_END = re.compile(r"\\end\{|```|\"\"\"|'''|</|\\\]|\$\$")
_PY_QUANTUM = re.compile(r"\b(qiskit|cirq|pennylane|QuantumCircuit|braket|pyquil|qutip|tket|pytket)\b")
_BITS = re.compile(r"^[01 ]{1,32}$")
_LOOKS_QASM2 = re.compile(r"^\s*(qreg|creg)\s+\w+\s*\[", re.M)
_LOOKS_QASM3 = re.compile(r"^\s*(qubit|bit)\s*(\[\s*\d+\s*\])?\s+\w+\s*;|include\s*\"stdgates\.inc\"", re.M)
_SKIP_DIRS = re.compile(r"(^|/)(invalid|node_modules|\.git)(/|$)", re.I)


class CircuitProblem(Exception):
    pass


def _text(raw: bytes) -> str:
    return raw.decode("utf-8", errors="replace")


def _trim(block: str) -> str:
    """Cut what follows the circuit's last statement (closing prose, a stray brace from LaTeX)."""
    cut = max(block.rfind(";"), block.rfind("}"))
    return block[:cut + 1] if cut > 0 else block


def qasm_blocks(text: str) -> list[str]:
    """Every OPENQASM program written inside a larger text (LaTeX listings, Markdown fences, strings)."""
    out = []
    heads = list(_HEAD.finditer(text))
    for i, m in enumerate(heads):
        stop = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        end = _END.search(text, m.end(), stop)
        block = text[m.start():end.start() if end else stop]
        if len(block) > mp.MAX_QASM_BYTES:
            block = block[:mp.MAX_QASM_BYTES]
        out.append(_trim(block).strip())
    return out


def _notebook_text(raw: bytes) -> str:
    try:
        nb = json.loads(raw)
    except (ValueError, RecursionError):
        return ""
    cells = nb.get("cells") if isinstance(nb, dict) else None
    if not isinstance(cells, list):
        return ""
    parts = []
    for c in cells[:2000]:
        src = c.get("source") if isinstance(c, dict) else None
        if isinstance(src, list):
            parts.append("".join(s for s in src if isinstance(s, str)))
        elif isinstance(src, str):
            parts.append(src)
    return "\n".join(parts)


def _expanded(op, memo: dict, depth: int) -> int:
    """How many basic operations op is once its definition is expanded (memoised per gate name)."""
    from qiskit.circuit.library import get_standard_gate_name_mapping

    name = op.name
    if name in ("measure", "reset", "barrier", "delay") or name in get_standard_gate_name_mapping():
        return 1
    key = (name, getattr(op, "num_qubits", 0))
    if key in memo:
        return memo[key]
    if depth > MAX_NESTING:
        raise CircuitProblem(f"Gate definitions are nested more than {MAX_NESTING} deep.")
    try:
        definition = op.definition
    except Exception:
        definition = None
    if definition is None:
        memo[key] = 1
        return 1
    total = 0
    for inst in definition.data:
        total += _expanded(inst.operation, memo, depth + 1)
        if total > rp.MAX_OPERATIONS:
            break
    memo[key] = total
    return total


def expanded_operations(circuit) -> int:
    memo: dict = {}
    total = 0
    for inst in circuit.data:
        if inst.operation.name == "barrier":
            continue
        total += _expanded(inst.operation, memo, 0)
        if total > rp.MAX_OPERATIONS:
            break
    return total


def normalize(text: str) -> str:
    """A .qasm file written without its OPENQASM line gets one: 3 when it declares qubit/bit or
    includes stdgates.inc, otherwise 2 when it declares qreg/creg."""
    if _HEAD.search(text[:4000]):
        return text
    if _LOOKS_QASM3.search(text):
        return "OPENQASM 3.0;\n" + text
    if _LOOKS_QASM2.search(text):
        return "OPENQASM 2.0;\n" + text
    return text


def check(text: str) -> tuple[Any, dict[str, Any]]:
    """(circuit, facts) if text is OpenQASM 2/3 within the limits, else CircuitProblem."""
    try:
        qc = mp.parse_circuit(text)
    except mp.CircuitError as exc:
        raise CircuitProblem(str(exc).replace("the estimate takes", "Q-Lab reads").replace("the estimate", "Q-Lab"))
    if qc.num_qubits == 0:
        raise CircuitProblem("The circuit has no qubits.")
    if qc.num_qubits > rp.max_qubits():
        raise CircuitProblem(f"The circuit uses {qc.num_qubits} qubits; Q-Lab runs up to {rp.max_qubits()} here.")
    ops = expanded_operations(qc)
    if ops > rp.MAX_OPERATIONS:
        raise CircuitProblem(f"The circuit has over {rp.MAX_OPERATIONS} operations once its gates are expanded.")
    depth = qc.depth()
    if depth > MAX_DEPTH:
        raise CircuitProblem(f"The circuit is {depth} layers deep; Q-Lab runs up to {MAX_DEPTH}.")
    try:
        facts = rp.check_circuit(qc, rp.max_qubits())
    except rp.ReplayError as exc:
        raise CircuitProblem(exc.message)
    facts["expanded_operations"] = ops
    facts["clbits"] = qc.num_clbits
    return qc, facts


def _norm(text: str) -> str:
    return hashlib.sha256(" ".join(text.split()).encode("utf-8")).hexdigest()


def _value_sets(obj: Any, origin: str, out: list[dict[str, Any]], depth: int = 0) -> None:
    """Bitstring -> number tables in a JSON file: clearly machine-readable measured results."""
    if len(out) >= MAX_VALUES or depth > 2 or not isinstance(obj, dict) or not obj:
        return
    if 2 <= len(obj) <= MAX_DIST_KEYS and all(isinstance(k, str) and _BITS.match(k) for k in obj):
        vals = list(obj.values())
        widths = {len(k.replace(" ", "")) for k in obj}
        if len(widths) == 1 and all(isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0 for v in vals) and sum(vals) > 0:
            kind = "counts" if all(float(v).is_integer() for v in vals) and sum(vals) > 1.5 else "probabilities"
            out.append({"origin": origin, "kind": kind, "distribution": {k.replace(" ", ""): v for k, v in obj.items()},
                        "status": "extracted, check it"})
        return
    for k, v in list(obj.items())[:50]:
        if isinstance(v, dict):
            _value_sets(v, f"{origin} → {str(k)[:40]}", out, depth + 1)


def find(files: dict[str, bytes], source: str) -> dict[str, Any]:
    """Circuits, Python-only hints and machine-readable reported values in one source's files."""
    candidates: list[tuple[str, str]] = []      # (origin, text)
    python_files: list[str] = []
    values: list[dict[str, Any]] = []
    for name in sorted(files, key=lambda n: (not n.lower().endswith((".qasm", ".qasm3")), n)):
        if _SKIP_DIRS.search(name):
            continue
        raw = files[name]
        low = name.lower()
        if low.endswith((".qasm", ".qasm3")):
            candidates.append((name, _text(raw)))
            continue
        if low.endswith(".json"):
            try:
                _value_sets(json.loads(raw), name, values)
            except (ValueError, RecursionError):
                pass
            continue
        text = _notebook_text(raw) if low.endswith(".ipynb") else _text(raw)
        if low.endswith((".py", ".ipynb")) and _PY_QUANTUM.search(text):
            python_files.append(name)
        elif low.endswith(".tex") and re.search(r"from qiskit|QuantumCircuit\(|import cirq", text):
            python_files.append(name)
        for i, block in enumerate(qasm_blocks(text)):
            candidates.append((f"{name}, block {i + 1}" if i else name, block))
    circuits: list[dict[str, Any]] = []
    seen: set[str] = set()
    more = 0
    for origin, text in candidates:
        text = normalize(text)
        h = _norm(text)
        if h in seen:
            continue
        seen.add(h)
        if len(circuits) >= MAX_CIRCUITS:
            more += 1
            continue
        base = posixpath.basename(origin.split(",")[0])
        entry: dict[str, Any] = {"id": h[:12], "name": re.sub(r"\.(qasm3?|tex|md|txt|py|ipynb)$", "", base) or "circuit",
                                 "origin": origin, "source": source, "qasm": text[:mp.MAX_QASM_BYTES]}
        try:
            _, facts = check(text)
            entry.update(ok=True, problem=None, facts=facts)
        except CircuitProblem as exc:
            entry.update(ok=False, problem=str(exc), facts=None)
        except Exception as exc:  # a parser bug must not take the whole search down
            entry.update(ok=False, problem=f"The circuit couldn't be read ({type(exc).__name__}).", facts=None)
        circuits.append(entry)
    return {"circuits": circuits, "more": more, "python_files": python_files[:20], "values": values}

