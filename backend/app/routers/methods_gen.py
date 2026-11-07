"""Methods section drafted from what Q-Lab recorded about the user's runs.

Every statement comes from a stored run: backend, date, shots, the circuit (qubits, depth), the
calibration recorded with it, compiler settings and library versions. A fact a run did not record
is left out of the text and shown as "not recorded" in the table; nothing is assumed. The template
only names the target venue; the style of the text is the same.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..calibration_history import calibration_metric
from ..database import get_db
from ..local_sim import _parse
from ..models import Run

SOURCE = "Recorded with your runs: backend, date, shots, stored circuit, calibration, compiler settings, versions."

router = APIRouter(prefix="/api/v1/methods-gen", tags=["methods-gen"])

TEMPLATES = {
    "nature": {
        "name": "Nature / Nature Physics",
        "style": "Third person, passive voice, highly concise. 'Experiments were performed on...'",
        "word_limit": 800,
    },
    "prl": {
        "name": "Physical Review Letters",
        "style": "APS style, compact. Numerical values with uncertainties. SI units.",
        "word_limit": 600,
    },
    "arxiv": {
        "name": "arXiv Preprint",
        "style": "Detailed, self-contained. Include all implementation details for reproducibility.",
        "word_limit": 2000,
    },
    "thesis": {
        "name": "PhD Thesis Chapter",
        "style": "Explanatory, pedagogical. Include background and motivation for each choice.",
        "word_limit": 5000,
    },
    "science": {
        "name": "Science / Science Advances",
        "style": "Supplementary Methods style. Numbered subsections. Complete parameter tables.",
        "word_limit": 1200,
    },
}

class RunFacts(BaseModel):
    """What Q-Lab recorded about one run. None means it was not recorded."""
    run_id: str
    circuit_name: Optional[str] = None
    backend: Optional[str] = None
    date: Optional[str] = None
    n_shots: Optional[int] = None
    n_qubits: Optional[int] = None
    depth: Optional[int] = None
    t1_us: Optional[float] = None
    t2_us: Optional[float] = None
    gate_error: Optional[float] = None
    readout_error: Optional[float] = None
    optimization_level: Optional[int] = None
    qiskit_version: Optional[str] = None
    python_version: Optional[str] = None
    has_qasm: bool = False


class MethodsGenRequest(BaseModel):
    run_ids: list[str] = Field(min_length=1, max_length=100)
    template: str = "arxiv"
    experiment_type: str = "variational"  # kept for older clients; the text states only recorded facts
    include_calibration_table: bool = True
    include_circuit_diagram: bool = False
    cite_qiskit: bool = True


class MethodsGenResult(BaseModel):
    doc_id: str
    template: str
    experiment_type: str
    generated_at: str
    methods_text: str
    calibration_table_md: str
    references: list[str]
    word_count: int
    bibtex: str
    reproducibility_checklist: list[dict]
    runs: list[RunFacts]
    source: str = SOURCE


def _facts(run: Run) -> RunFacts:
    cal = run.calibration or {}
    ctx = run.context if isinstance(run.context, dict) else {}
    libs = ctx.get("library_versions") if isinstance(ctx.get("library_versions"), dict) else {}
    settings = (run.transpiler or {}).get("settings") if isinstance(run.transpiler, dict) else None
    n_qubits = depth = None
    if run.qasm:
        try:
            c = _parse(run.qasm)
            n_qubits = c.num_qubits
            depth = c.depth(filter_function=lambda i: i.operation.name not in ("measure", "barrier"))
        except ValueError:
            pass
    fp = run.fingerprint or {}
    level = settings.get("optimization_level") if isinstance(settings, dict) else None
    py = ctx.get("python_version")
    return RunFacts(
        run_id=run.run_id, circuit_name=run.circuit_name, backend=run.backend,
        date=run.created_at.date().isoformat() if run.created_at else None,
        n_shots=run.shots, n_qubits=n_qubits or fp.get("num_qubits"), depth=depth or fp.get("depth"),
        t1_us=calibration_metric(cal, "avg_t1_us"), t2_us=calibration_metric(cal, "avg_t2_us"),
        gate_error=calibration_metric(cal, "avg_gate_error"), readout_error=calibration_metric(cal, "avg_readout_error"),
        optimization_level=level if isinstance(level, int) else None,
        qiskit_version=libs.get("qiskit"), python_version=str(py).split()[0] if py else None,
        has_qasm=bool(run.qasm),
    )


def _join(values) -> str:
    vals = sorted({str(v) for v in values if v is not None})
    return ", ".join(vals)


def _gen_methods(runs: list[RunFacts]) -> str:
    n = len(runs)
    parts = ["## Methods", "", "### Quantum hardware", ""]
    backends = _join(r.backend for r in runs)
    dates = sorted(r.date for r in runs if r.date)
    sentence = f"The {n} experiment{'s' if n > 1 else ''} reported here " + ("were" if n > 1 else "was")
    sentence += f" executed on {backends}" if backends else " executed on a backend that was not recorded"
    if dates:
        sentence += f" between {dates[0]} and {dates[-1]}" if dates[0] != dates[-1] else f" on {dates[0]}"
    parts.append(sentence + ".")
    cal = []
    for label, attr, fmt in (("mean T1", "t1_us", "{:.0f} us"), ("mean T2", "t2_us", "{:.0f} us"),
                             ("mean gate error", "gate_error", "{:.2e}"), ("mean readout error", "readout_error", "{:.2%}")):
        vals = [getattr(r, attr) for r in runs if getattr(r, attr) is not None]
        if vals:
            cal.append(f"{label} {fmt.format(sum(vals) / len(vals))}")
    if cal:
        covered = sum(1 for r in runs if r.t1_us is not None or r.gate_error is not None)
        parts.append(f"Device calibration recorded at execution time ({covered} of {n} runs): " + "; ".join(cal) + ".")
    parts += ["", "### Circuits and compilation", ""]
    qubits = _join(r.n_qubits for r in runs)
    depths = [r.depth for r in runs if r.depth is not None]
    if qubits:
        line = f"Circuits used {qubits} qubits"
        if depths:
            line += f" with depth {min(depths)}" + (f" to {max(depths)}" if max(depths) != min(depths) else "")
        parts.append(line + ".")
    levels = _join(r.optimization_level for r in runs)
    qiskit = _join(r.qiskit_version for r in runs)
    if qiskit or levels:
        parts.append("Circuits were compiled with " + (f"Qiskit {qiskit}" if qiskit else "Qiskit")
                     + (f" at optimization level {levels}" if levels else "") + ".")
    parts += ["", "### Measurement", ""]
    shots = _join(r.n_shots for r in runs)
    parts.append(f"Each circuit was executed with {shots} shots." if shots else "Shot counts were not recorded.")
    parts += ["", "### Data availability", ""]
    parts.append("Raw counts, circuits and calibration snapshots are archived in Q-Lab under run IDs "
                 + ", ".join(r.run_id for r in runs) + ".")
    return "\n".join(parts)


def _calibration_table(runs: list[RunFacts]) -> str:
    def cell(v, fmt):
        return fmt.format(v) if v is not None else "not recorded"
    rows = ["| Run | Backend | Date | T1 (us) | T2 (us) | Gate error | Readout error |", "|---|---|---|---|---|---|---|"]
    rows += [f"| {r.run_id} | {r.backend or 'not recorded'} | {r.date or ''} | {cell(r.t1_us, '{:.0f}')} | "
             f"{cell(r.t2_us, '{:.0f}')} | {cell(r.gate_error, '{:.2e}')} | {cell(r.readout_error, '{:.2%}')} |" for r in runs]
    return "\n".join(rows)


_REFS = {
    "qiskit": ("Javadi-Abhari, A. et al. Quantum computing with Qiskit. arXiv:2405.08810 (2024).",
               "@article{Qiskit2024,\n  author = {Javadi-Abhari, Ali and others},\n  title = {Quantum computing with Qiskit},\n"
               "  journal = {arXiv:2405.08810},\n  year = {2024}\n}"),
    "openqasm": ("Cross, A. W. et al. Open quantum assembly language. arXiv:1707.03429 (2017).",
                 "@article{Cross2017,\n  author = {Cross, Andrew W. and others},\n  title = {Open quantum assembly language},\n"
                 "  journal = {arXiv:1707.03429},\n  year = {2017}\n}"),
}


def _checklist(runs: list[RunFacts]) -> list[dict]:
    def all_(pred):
        return all(pred(r) for r in runs)
    return [
        {"item": "Hardware backend recorded", "done": all_(lambda r: r.backend)},
        {"item": "Calibration (T1/T2 or gate errors) at execution time", "done": all_(lambda r: r.t1_us is not None or r.gate_error is not None)},
        {"item": "Shot count recorded", "done": all_(lambda r: r.n_shots)},
        {"item": "Compiler settings recorded", "done": all_(lambda r: r.optimization_level is not None)},
        {"item": "Circuit QASM archived", "done": all_(lambda r: r.has_qasm)},
        {"item": "Software versions recorded", "done": all_(lambda r: r.qiskit_version)},
    ]


@router.post("/generate", response_model=MethodsGenResult)
def generate_methods(req: MethodsGenRequest, db: Session = Depends(get_db)):
    ids = list(dict.fromkeys(req.run_ids))
    found = {r.run_id: r for r in db.scalars(select(Run).where(Run.run_id.in_(ids)))}
    missing = [rid for rid in ids if rid not in found]
    if missing:
        raise HTTPException(404, f"Run(s) not found: {', '.join(missing)}")
    runs = [_facts(found[rid]) for rid in ids]
    text = _gen_methods(runs)
    keys = (["qiskit"] if req.cite_qiskit and any(r.qiskit_version for r in runs) else []) + \
        (["openqasm"] if any(r.has_qasm for r in runs) else [])
    return MethodsGenResult(
        doc_id=str(uuid.uuid4()), template=req.template, experiment_type=req.experiment_type,
        generated_at=datetime.now(timezone.utc).isoformat(), methods_text=text,
        calibration_table_md=_calibration_table(runs) if req.include_calibration_table else "",
        references=[_REFS[k][0] for k in keys], word_count=len(text.split()),
        bibtex="\n\n".join(_REFS[k][1] for k in keys), reproducibility_checklist=_checklist(runs), runs=runs,
    )


@router.get("/templates")
def list_templates():
    return {"templates": [{"id": k, **v} for k, v in TEMPLATES.items()]}
