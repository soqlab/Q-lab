import io
import re
import threading

# Set non-interactive backend before any pyplot import
import matplotlib
matplotlib.use("Agg")

_lock = threading.Lock()
_cache: dict[str, bytes] = {}


def _normalize_qasm(qasm: str) -> str:
    """Add missing standard header/registers so incomplete QASM can be parsed."""
    lines = qasm.strip().splitlines()

    has_header = any(l.strip().startswith("OPENQASM") for l in lines)
    has_include = any("qelib1.inc" in l for l in lines)
    has_qreg = any(l.strip().startswith("qreg") for l in lines)
    has_creg = any(l.strip().startswith("creg") for l in lines)

    # Infer qubit / clbit counts from gate lines
    qubit_refs = [int(m) for m in re.findall(r'\bq\[(\d+)\]', qasm)]
    clbit_refs  = [int(m) for m in re.findall(r'\bc\[(\d+)\]', qasm)]
    max_q = max(qubit_refs, default=0) + 1
    max_c = max(clbit_refs, default=0) + 1 if clbit_refs else 0

    # Always reconstruct from scratch so OPENQASM 2.0 is guaranteed first
    header: list[str] = ["OPENQASM 2.0;"]
    if not has_include:
        header.append('include "qelib1.inc";')
    if not has_qreg:
        header.append(f"qreg q[{max_q}];")
    if not has_creg and max_c > 0:
        header.append(f"creg c[{max_c}];")

    # Body = everything except the OPENQASM declaration (already in header)
    body = [l for l in lines if not l.strip().startswith("OPENQASM")]
    return "\n".join(header + body)


def _parse_qasm(qasm: str):
    """Try QASM2 (with normalisation), then fall back to QASM3."""
    from qiskit.qasm2 import loads as q2_loads, LEGACY_CUSTOM_INSTRUCTIONS
    try:
        normalized = _normalize_qasm(qasm)
        try:
            return q2_loads(normalized, custom_instructions=LEGACY_CUSTOM_INSTRUCTIONS)
        except Exception:
            return q2_loads(normalized)
    except Exception:
        pass
    # QASM3 fallback — use raw string, no normalisation needed
    from qiskit.qasm3 import loads as q3_loads
    return q3_loads(qasm)


def render_qasm_svg(run_id: str, qasm: str) -> bytes:
    if run_id in _cache:
        return _cache[run_id]

    import matplotlib.pyplot as plt

    qc = _parse_qasm(qasm)

    with _lock:
        fig = qc.draw(
            output="mpl",
            fold=40,
            style={
                "backgroundcolor": "#ffffff",
                "linecolor": "#17202a",
                "textcolor": "#17202a",
                "gatetextcolor": "#17202a",
                "subtextcolor": "#5f6f80",
                "figwidth": -1,
            },
        )
        buf = io.BytesIO()
        fig.savefig(buf, format="svg", bbox_inches="tight", dpi=150)
        plt.close(fig)

    svg_bytes = buf.getvalue()
    _cache[run_id] = svg_bytes
    return svg_bytes


def render_qasm_text(qasm: str) -> str:
    return str(_parse_qasm(qasm).draw(output="text", fold=80))


def invalidate(run_id: str) -> None:
    _cache.pop(run_id, None)
