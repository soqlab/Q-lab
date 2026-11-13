"""Reproduce this run: a script that re-runs a run the way it was run, and whether a re-run agreed.

The recipe comes only from what the SDK recorded with the run:
- the circuit: QPY of the circuit given to transpile() when recorded (exact), else its OpenQASM text,
  else the circuit that ran (then nothing is recompiled);
- the package versions (qiskit, qiskit-ibm-runtime, qiskit-aer, qlab-sdk) and the Python minor version,
  pinned in the script's inline metadata (PEP 723) so `uv run` builds that environment;
- transpiler settings (optimization level, seed_transpiler, methods) and how it compiled
  (transpile() or generate_preset_pass_manager);
- the backend, how it ran (backend.run, a Sampler, an Estimator), shots and seeds.

What can't be pinned is said plainly: the hardware's noise (machines are recalibrated and drift
between calibrations), queue time, and any seed or setting that wasn't recorded.

A re-run uploaded with qlab.init(reproduces=<run id>) (the script does this) is stored with
runs.reproduction_of. compare() then tests it against the original with drift.py's distance and
shot-noise test (same alpha) and, when it moved, drift.py's attribution: your side (package versions,
settings, compiled circuit) or the machine (recorded calibration of the qubits used).

Runs are read with Run queries, which app/run_scope.py limits to runs the caller can see.
"""
from __future__ import annotations

import json
import re
import textwrap
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import drift
from .models import Run
from .run_diff import counts_of

SDK_REPO = "https://github.com/soqlab/Q-lab"
_VERSION = re.compile(r"^[0-9][0-9A-Za-z.+!-]{0,40}$")
_PY = re.compile(r"^(3)\.(\d{1,2})")
_SAFE_NAME = re.compile(r"[^A-Za-z0-9_-]")
MAX_REPRODUCTIONS = 20
PENDING = {"submitted", "queued", "running", "captured", "initializing", "validating"}


def _d(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _one_line(text: Any, limit: int = 120) -> str:
    """Text safe to put in a comment or docstring of the generated script."""
    s = re.sub(r"[^\x20-\x7e]", " ", str(text))
    s = s.replace('"""', "'''").replace("\\", "/")
    return s[:limit]


# ---------------------------------------------------------------------------
# What was recorded
# ---------------------------------------------------------------------------

def versions(run: Any) -> dict[str, str]:
    return {k: v for k, v in drift._versions(run).items() if _VERSION.match(v)}


def python_minor(run: Any) -> Optional[str]:
    raw = _d(run.context).get("python_version")
    m = _PY.match(str(raw or "").strip())
    return f"{m.group(1)}.{m.group(2)}" if m else None


def _qpy(entry: Any) -> Optional[dict]:
    e = _d(entry)
    return e if isinstance(e.get("data"), str) and e.get("data") and not e.get("truncated") else None


def circuit_source(run: Any) -> Optional[dict[str, Any]]:
    """The circuit the script starts from: {"stage": logical | as_run, "format": qpy | openqasm2 | openqasm3, ...}."""
    tr = _d(run.transpiler)
    qpy_before = _qpy(_d(tr.get("qpy")).get("before"))
    qasm_before = _d(_d(tr.get("qasm")).get("before"))
    have_qiskit = bool(versions(run).get("qiskit"))
    # QPY is exact (parameters, custom gates) but needs the Qiskit that wrote it: only with a pinned qiskit.
    if qpy_before and have_qiskit:
        return {"stage": "logical", "format": "qpy", "data": qpy_before["data"], "sha256": qpy_before.get("sha256"),
                "label": "the circuit given to transpile(), as QPY"}
    if isinstance(qasm_before.get("text"), str) and qasm_before["text"].strip():
        fmt = qasm_before.get("format") or _qasm_format(qasm_before["text"])
        return {"stage": "logical", "format": fmt, "text": qasm_before["text"],
                "label": "the circuit given to transpile(), as OpenQASM"}
    if qpy_before:
        return {"stage": "logical", "format": "qpy", "data": qpy_before["data"], "sha256": qpy_before.get("sha256"),
                "label": "the circuit given to transpile(), as QPY"}
    compiled = _qpy(_d(tr.get("qpy")).get("after"))
    if isinstance(run.qasm, str) and run.qasm.strip():
        return {"stage": "as_run", "format": _qasm_format(run.qasm), "text": run.qasm,
                "label": "the circuit that ran, as OpenQASM (it is run as it is, not recompiled)"}
    if compiled:
        return {"stage": "as_run", "format": "qpy", "data": compiled["data"], "sha256": compiled.get("sha256"),
                "label": "the compiled circuit that ran, as QPY (it is run as it is, not recompiled)"}
    return None


def _qasm_format(text: str) -> str:
    return "openqasm3" if re.match(r"\s*(//[^\n]*\n\s*)*OPENQASM\s+3", text) else "openqasm2"


def compiled_circuit(run: Any) -> Optional[dict[str, Any]]:
    """The compiled circuit that ran (QPY), for --as-compiled, when the script recompiles by default."""
    entry = _qpy(_d(_d(run.transpiler).get("qpy")).get("after"))
    return {"data": entry["data"], "sha256": entry.get("sha256")} if entry else None


def transpile_settings(run: Any) -> tuple[dict[str, Any], str]:
    s = _d(_d(run.transpiler).get("settings"))
    via = "generate_preset_pass_manager" if s.get("via") == "generate_preset_pass_manager" else "transpile"
    allowed = ("optimization_level", "seed_transpiler", "layout_method", "routing_method", "translation_method",
               "approximation_degree", "scheduling_method", "basis_gates")
    out: dict[str, Any] = {}
    for k in allowed:
        v = s.get(k)
        if v is None:
            continue
        if k in ("optimization_level", "seed_transpiler") and isinstance(v, int) and not isinstance(v, bool):
            out[k] = v
        elif k == "approximation_degree" and isinstance(v, (int, float)) and not isinstance(v, bool):
            out[k] = v
        elif k == "basis_gates" and isinstance(v, list) and all(isinstance(g, str) for g in v):
            out[k] = [g for g in v if re.match(r"^[A-Za-z0-9_]{1,40}$", g)]
        elif isinstance(v, str) and re.match(r"^[A-Za-z0-9_]{1,40}$", v):
            out[k] = v
    return out, via


def seed(run: Any) -> Optional[int]:
    p = _d(run.parameters)
    for key in ("seed_simulator", "seed"):
        v = p.get(key)
        if isinstance(v, int) and not isinstance(v, bool):
            return v
    return None


def primitive(run: Any) -> dict[str, str]:
    p = _d(_d(run.execution).get("primitive"))
    kind = p.get("kind") if p.get("kind") in ("backend", "sampler", "estimator") else None
    cls = p.get("class") if isinstance(p.get("class"), str) else ""
    return {"kind": kind or "", "class": cls}


def parameter_values(run: Any) -> Optional[Any]:
    p = _d(run.parameters)
    for key in ("parameter_values", "parameter_binds"):
        v = p.get(key)
        if _numeric(v):
            return v
    return None


def _numeric(v: Any, depth: int = 0) -> bool:
    if depth > 4:
        return False
    if isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return True
    if isinstance(v, list) and v:
        return all(_numeric(x, depth + 1) for x in v)
    return False


def backend_kind(name: Optional[str], prim: dict[str, str]) -> str:
    """How the script builds the backend: ibm, fake, aer, aer_from_fake, statevector or unknown."""
    cls = prim.get("class", "")
    if cls.startswith("qiskit.primitives.") and "Statevector" in cls:
        return "statevector"
    n = (name or "").strip()
    if re.match(r"^ibm_[a-z0-9_]+$", n):
        return "ibm"
    if re.match(r"^fake_[a-z0-9_]+$", n):
        return "fake"
    if re.match(r"^aer_simulator_from\(fake_[a-z0-9_]+\)$", n):
        return "aer_from_fake"
    if re.match(r"^aer_simulator(_[a-z_]+)?$", n):
        return "aer"
    if not n and cls.startswith("qiskit.primitives."):
        return "statevector"
    return "unknown"


def is_hardware(kind: str) -> bool:
    return kind in ("ibm", "unknown")


def packages(kind: str, prim: dict[str, str]) -> list[str]:
    """The Qiskit packages the script needs (and pins) for this backend and primitive."""
    cls = prim.get("class", "")
    out = ["qiskit"]
    if kind in ("ibm", "fake", "aer_from_fake") or cls.startswith("qiskit_ibm_runtime"):
        out.append("qiskit-ibm-runtime")
    if kind in ("aer", "aer_from_fake", "fake") or cls.startswith("qiskit_aer"):
        out.append("qiskit-aer")
    return out


# ---------------------------------------------------------------------------
# The recipe: what is pinned, what isn't
# ---------------------------------------------------------------------------

def recipe(run: Run, *, sdk_ref: Optional[str]) -> dict[str, Any]:
    vers = versions(run)
    py = python_minor(run)
    src = circuit_source(run)
    settings, via = transpile_settings(run)
    prim = primitive(run)
    kind = backend_kind(run.backend, prim)
    s = seed(run)
    shots = run.shots
    compiled = compiled_circuit(run) if src and src["stage"] == "logical" else None
    needs = packages(kind, prim)

    pinned: list[dict[str, str]] = []
    missing: list[dict[str, str]] = []
    for pkg in needs:
        if vers.get(pkg):
            pinned.append({"what": pkg, "value": vers[pkg]})
        elif pkg == "qiskit":
            missing.append({"what": "qiskit version", "effect": "not recorded, so the script installs the latest Qiskit, which may compile differently"})
        else:
            missing.append({"what": f"{pkg} version", "effect": "not recorded, so the latest is installed"})
    if py:
        pinned.append({"what": "Python", "value": py})
    if vers.get("qlab-sdk"):
        pinned.append({"what": "qlab-sdk (records only)", "value": vers["qlab-sdk"]})
    if src is None:
        missing.append({"what": "the circuit", "effect": "no circuit source was recorded (hash-only privacy mode, or too large), so there is nothing to re-run"})
    else:
        pinned.append({"what": "circuit", "value": src["label"]})
    if run.backend:
        pinned.append({"what": "backend", "value": run.backend})
    else:
        missing.append({"what": "backend", "effect": "not recorded: choose one in the script"})
    if shots:
        pinned.append({"what": "shots", "value": str(shots)})
    else:
        missing.append({"what": "shots", "effect": "not recorded, so the primitive's default is used"})
    if src and src["stage"] == "logical":
        if "optimization_level" in settings:
            pinned.append({"what": "optimization level", "value": str(settings["optimization_level"])})
        else:
            pinned.append({"what": "optimization level", "value": f"Qiskit {vers.get('qiskit', '')}'s default (none was set)".replace("Qiskit 's", "Qiskit's")})
        if "seed_transpiler" in settings:
            pinned.append({"what": "transpiler seed", "value": str(settings["seed_transpiler"])})
        for k in ("layout_method", "routing_method", "translation_method", "scheduling_method", "approximation_degree"):
            if k in settings:
                pinned.append({"what": k.replace("_", " "), "value": str(settings[k])})
        pinned.append({"what": "compiled with", "value": "generate_preset_pass_manager(...).run()" if via != "transpile" else "transpile()"})
    if s is not None:
        pinned.append({"what": "simulator seed", "value": str(s)})
    if prim["kind"]:
        pinned.append({"what": "ran with", "value": {"backend": "backend.run()", "sampler": "a Sampler", "estimator": "an Estimator"}[prim["kind"]]})

    cant: list[str] = []
    if is_hardware(kind):
        cant.append("The machine's noise: it is recalibrated (usually daily) and drifts between calibrations, so a re-run on hardware agrees only within shot noise at best.")
        cant.append("Queue time and when the job runs.")
        if src and src["stage"] == "logical":
            cant.append("Which physical qubits the compiler picks: the layout follows the machine's current error rates. "
                        + ("--as-compiled runs the exact compiled circuit (same qubits) instead." if compiled else "The compiled circuit wasn't recorded, so it can't be forced."))
    elif s is None:
        cant.append("The simulator's sampling: no seed was set, so counts differ by shot noise.")
    if src and src["stage"] == "logical" and "seed_transpiler" not in settings:
        cant.append("The compiler's random choices (layout and routing): no seed_transpiler was set."
                    + (" --as-compiled avoids recompiling." if compiled else ""))
    if prim["kind"] == "estimator":
        missing.append({"what": "observables", "effect": "Estimator observables aren't recorded: fill them in the script. Q-Lab compares counts, so an Estimator re-run is listed but not judged"})
    if kind == "unknown" and run.backend:
        missing.append({"what": "how to build the backend", "effect": f"Q-Lab doesn't know how to connect to {_one_line(run.backend, 60)}: the script marks where to build it"})

    return {
        "versions": vers, "packages": needs, "python": py, "source": src, "compiled": compiled, "settings": settings, "via": via,
        "primitive": prim, "backend_kind": kind, "seed": s, "shots": shots, "parameter_values": parameter_values(run),
        "pinned": pinned, "missing": missing, "cant_pin": cant, "sdk_ref": sdk_ref,
    }


def file_name(run: Run) -> str:
    return f"reproduce_{_SAFE_NAME.sub('', run.run_id)[:12] or 'run'}.py"


def requirements(rec: dict[str, Any]) -> list[str]:
    vers = rec["versions"]
    reqs = [f"{pkg}=={vers[pkg]}" if vers.get(pkg) else pkg for pkg in rec["packages"]]
    if (rec.get("source") or {}).get("format") == "openqasm3":
        reqs.append("qiskit-qasm3-import")  # qiskit.qasm3.loads needs it
    # qlab-sdk only records the re-run (it doesn't change the result); from the repository at the commit
    # this server runs, which has qlab.reproducing().
    ref = rec.get("sdk_ref") or "main"
    reqs.append(f"qlab-sdk @ git+{SDK_REPO}@{ref}#subdirectory=qlab_sdk")
    return reqs


def commands(run: Run, rec: dict[str, Any]) -> dict[str, str]:
    name = file_name(run)
    reqs = requirements(rec)
    quoted = " ".join(f'"{r}"' for r in reqs)
    with_flags = " ".join(f'--with "{r}"' for r in reqs)
    py = f" --python {rec['python']}" if rec.get("python") else ""
    return {
        "file": name,
        "uv": f"uv run {name}",
        "uv_explicit": f"uv run{py} --no-project {with_flags} python {name}",
        "pip": f"pip install {quoted} && python {name}",
        "pip_install": f"pip install {quoted}",
    }


# ---------------------------------------------------------------------------
# The script
# ---------------------------------------------------------------------------

def _b64_literal(data: str, indent: str = "    ") -> str:
    lines = textwrap.wrap(data, 96) or [""]
    return "(\n" + "\n".join(f"{indent}{json.dumps(line)}" for line in lines) + "\n)"


def _backend_code(rec: dict[str, Any], backend: Optional[str]) -> list[str]:
    kind = rec["backend_kind"]
    name = json.dumps(backend or "")
    if kind == "ibm":
        return ["from qiskit_ibm_runtime import QiskitRuntimeService",
                "# Uses your saved IBM Quantum account (QiskitRuntimeService.save_account, or QISKIT_IBM_TOKEN).",
                f"backend = QiskitRuntimeService().backend({name})"]
    if kind == "fake":
        return ["from qiskit_ibm_runtime.fake_provider import FakeProviderForBackendV2",
                f"backend = FakeProviderForBackendV2().backend({name})"]
    if kind == "aer_from_fake":
        fake = json.dumps(re.sub(r"^aer_simulator_from\((.*)\)$", r"\1", backend or ""))
        return ["from qiskit_aer import AerSimulator",
                "from qiskit_ibm_runtime.fake_provider import FakeProviderForBackendV2",
                f"backend = AerSimulator.from_backend(FakeProviderForBackendV2().backend({fake}))"]
    if kind == "aer":
        method = re.sub(r"^aer_simulator_?", "", backend or "")
        arg = f"method={json.dumps(method)}" if method else ""
        return ["from qiskit_aer import AerSimulator", f"backend = AerSimulator({arg})"]
    if kind == "statevector":
        return ["backend = None  # a reference primitive: no backend"]
    return [f"# Q-Lab doesn't know how to connect to {_one_line(backend or 'this backend', 60)}: build it here, the way you did.",
            "backend = None",
            "if backend is None:",
            f"    sys.exit({json.dumps('Build the backend ' + (backend or '') + ' near the top of this script first.')})"]


def _run_code(rec: dict[str, Any]) -> list[str]:
    kind = rec["backend_kind"]
    prim = rec["primitive"]
    cls = prim["class"]
    role = prim["kind"] or ("backend" if kind in ("aer", "aer_from_fake") else "sampler")
    if role == "estimator":
        if cls.startswith("qiskit.primitives.") and "Statevector" in cls:
            make = ["from qiskit.primitives import StatevectorEstimator", "estimator = StatevectorEstimator(seed=SEED)"]
        elif cls.startswith("qiskit_aer"):
            make = ["from qiskit_aer.primitives import EstimatorV2", "estimator = EstimatorV2()"]
        else:
            make = ["from qiskit_ibm_runtime import EstimatorV2", "estimator = EstimatorV2(mode=backend)"]
        return make + [
            "# Q-Lab doesn't record an Estimator's observables: put the ones you measured here, e.g.",
            "# from qiskit.quantum_info import SparsePauliOp; OBSERVABLES = SparsePauliOp(\"ZZ\")",
            "OBSERVABLES = None",
            "if OBSERVABLES is None:",
            "    sys.exit(\"This run used an Estimator and its observables weren't recorded: set OBSERVABLES in this script.\")",
            "if getattr(isa, \"layout\", None) is not None:",
            "    OBSERVABLES = OBSERVABLES.apply_layout(isa.layout)",
            "pub = (isa, OBSERVABLES) if PARAMETER_VALUES is None else (isa, OBSERVABLES, PARAMETER_VALUES)",
            "with qlab.reproducing(RUN_ID):",
            "    result = estimator.run([pub]).result()",
            "print(\"Expectation values:\", result[0].data.evs)",
        ]
    if role == "backend" and kind not in ("ibm", "statevector"):
        lines = ["circuit_to_run = isa if PARAMETER_VALUES is None else isa.assign_parameters(PARAMETER_VALUES)",
                 "options = {} if SHOTS is None else {\"shots\": SHOTS}",
                 "if SEED is not None:",
                 "    options[\"seed_simulator\"] = SEED",
                 "with qlab.reproducing(RUN_ID):",
                 "    result = backend.run(circuit_to_run, **options).result()",
                 "counts = result.get_counts()"]
        return lines
    if kind == "statevector" or (cls.startswith("qiskit.primitives.") and "Statevector" in cls):
        make = ["from qiskit.primitives import StatevectorSampler", "sampler = StatevectorSampler(seed=SEED)"]
    elif cls.startswith("qiskit.primitives.") and "BackendSampler" in cls:
        make = ["from qiskit.primitives import BackendSamplerV2",
                "sampler = BackendSamplerV2(backend=backend, options={} if SEED is None else {\"seed_simulator\": SEED})"]
    elif cls.startswith("qiskit_aer"):
        make = ["from qiskit_aer.primitives import SamplerV2", "sampler = SamplerV2(seed=SEED)"]
    else:
        make = ["from qiskit_ibm_runtime import SamplerV2", "sampler = SamplerV2(mode=backend)"]
        if kind != "ibm":
            make += ["if SEED is not None:", "    sampler.options.simulator.seed_simulator = SEED"]
    return make + [
        "pub = (isa,) if PARAMETER_VALUES is None else (isa, PARAMETER_VALUES)",
        "with qlab.reproducing(RUN_ID):",
        "    result = sampler.run([pub], shots=SHOTS).result()",
        "counts = first_counts(result[0].data)",
    ]


def script(run: Run, rec: dict[str, Any], *, api_url: str, app_url: str, notebook: bool = False) -> str:
    """The Python that re-runs this run. notebook=True: a cell for a notebook (no PEP 723 header, no argv)."""
    src = rec["source"]
    reqs = requirements(rec)
    cmd = commands(run, rec)
    name = cmd["file"]
    out: list[str] = []
    if not notebook:
        out.append("# /// script")
        if rec.get("python"):
            out.append(f'# requires-python = "=={rec["python"]}.*"')
        out.append("# dependencies = [")
        out += [f"#   {json.dumps(r)}," for r in reqs]
        out.append("# ]")
        out.append("# ///")
    pinned = "; ".join(f"{p['what']} {p['value']}" for p in rec["pinned"] if p["what"] not in ("circuit",))
    doc = [f"Re-run Q-Lab run {_one_line(run.run_id, 64)}" + (f" ({_one_line(run.circuit_name, 60)})" if run.circuit_name else "")
           + " the way it was run, and upload the result as its reproduction.", ""]
    if not notebook:
        if rec.get("compiled"):
            doc += [f"    {cmd['uv']}                 # recompile with the recorded settings",
                    f"    {cmd['uv']} --as-compiled   # run the exact compiled circuit that ran"]
        else:
            doc.append(f"    {cmd['uv']}")
        doc += ["", f"Without uv: {cmd['pip_install']}", ""]
    doc += textwrap.wrap("Pinned: " + _one_line(pinned, 900) + ".", 96)
    if rec["cant_pin"]:
        doc += [""] + textwrap.wrap("Not pinned: " + _one_line(" ".join(rec["cant_pin"]), 900), 96)
    for m in rec["missing"]:
        doc += textwrap.wrap(f"Not recorded: {m['what']}: {_one_line(m['effect'], 300)}.", 96)
    doc += ["", "Set QLAB_API_KEY (and QLAB_API_URL for another Q-Lab) to upload the result; Q-Lab then",
            "compares it with the original and says on both runs' pages whether it reproduced."]
    out.append('"""' + "\n".join(doc).rstrip() + '\n"""')
    out += ["import base64", "import io", "import os", "import sys", "", "import qlab", ""]

    out.append(f"RUN_ID = {json.dumps(run.run_id)}")
    out.append(f"SHOTS = {rec['shots'] if rec['shots'] else 'None'}")
    out.append(f"SEED = {rec['seed'] if rec['seed'] is not None else 'None'}")
    settings = rec["settings"]
    out.append(f"TRANSPILER = {json.dumps(settings) if settings else '{}'}")
    pv = rec.get("parameter_values")
    out.append(f"PARAMETER_VALUES = {json.dumps(pv) if pv is not None else 'None'}")
    if notebook:
        out.append("AS_COMPILED = False  # True: run the exact compiled circuit that ran instead of recompiling")
    else:
        out.append('AS_COMPILED = "--as-compiled" in sys.argv[1:]')
    out.append("")

    if src is None:
        out += ["sys.exit(\"Q-Lab has no circuit source for this run (hash-only privacy mode, or it was too large), so it can't be re-run.\")"]
        return "\n".join(out) + "\n"

    if src["format"] == "qpy":
        out.append(f"CIRCUIT_QPY = {_b64_literal(src['data'])}")
    else:
        out.append(f"CIRCUIT_QASM = {json.dumps(src['text'])}")
    compiled = rec.get("compiled")
    out.append(f"COMPILED_QPY = {_b64_literal(compiled['data']) if compiled else 'None'}")
    after = _d(_d(run.transpiler).get("after"))
    recorded = {k: after[k] for k in ("depth", "size") if isinstance(after.get(k), int)}
    out.append(f"RECORDED_COMPILED = {json.dumps(recorded)}  # depth and size of the compiled circuit that ran")
    out += [
        "",
        "",
        "def load_qpy(data):",
        "    from qiskit import qpy",
        "    return qpy.load(io.BytesIO(base64.b64decode(data)))[0]",
        "",
        "",
        "def first_counts(data):",
        "    for name in (data.keys() if hasattr(data, \"keys\") else vars(data)):",
        "        value = getattr(data, name)",
        "        if hasattr(value, \"get_counts\"):",
        "            return value.get_counts()",
        "    return {}",
        "",
        "",
        f"qlab.init(api_url=os.environ.get(\"QLAB_API_URL\") or {json.dumps(api_url)}, project={json.dumps(run.project_slug) if run.project_slug else 'None'})",
        "if not os.environ.get(\"QLAB_API_KEY\"):",
        "    print(\"QLAB_API_KEY isn't set: the result won't be uploaded or compared.\")",
        "",
    ]
    if src["format"] == "qpy":
        out.append("circuit = load_qpy(CIRCUIT_QPY)")
    elif src["format"] == "openqasm3":
        out += ["from qiskit import qasm3", "circuit = qasm3.loads(CIRCUIT_QASM)  # needs qiskit-qasm3-import"]
    else:
        out += ["from qiskit import qasm2", "circuit = qasm2.loads(CIRCUIT_QASM, custom_instructions=qasm2.LEGACY_CUSTOM_INSTRUCTIONS)"]
    out.append("")
    out += _backend_code(rec, run.backend)
    out.append("")
    if src["stage"] == "logical":
        target = "backend=backend, " if rec["backend_kind"] != "statevector" else ""
        if rec["via"] == "generate_preset_pass_manager":
            compile_line = f"    isa = generate_preset_pass_manager({target}**TRANSPILER).run(circuit)"
            imp = "    from qiskit.transpiler import generate_preset_pass_manager"
        else:
            compile_line = f"    isa = transpile(circuit, {target}**TRANSPILER)"
            imp = "    from qiskit import transpile"
        out += [
            "if AS_COMPILED and COMPILED_QPY:",
            "    isa = load_qpy(COMPILED_QPY)",
            "    print(\"Running the exact compiled circuit that ran.\")",
            "else:",
            imp,
            compile_line,
            "    same = all(getattr(isa, k)() == v for k, v in RECORDED_COMPILED.items())",
            "    if RECORDED_COMPILED and not same:",
            "        print(f\"Compiled to a different circuit than the original (depth {isa.depth()} vs \"",
            "              f\"{RECORDED_COMPILED.get('depth')}).\" + (\" --as-compiled runs the original's.\" if COMPILED_QPY else \"\"))",
            "    elif RECORDED_COMPILED:",
            "        print(\"Compiled to a circuit of the same depth and size as the original.\")",
        ]
    else:
        out.append("isa = circuit  # the circuit that ran, run as it is")
    out.append("")
    out += _run_code(rec)
    out.append("")
    if rec["primitive"]["kind"] != "estimator":
        out.append("print(\"Counts:\", dict(sorted(counts.items(), key=lambda kv: -kv[1])[:8]))")
    out.append("qlab.flush(timeout=30)")
    link = f"{app_url.rstrip('/')}/runs/{run.run_id}" if app_url else None
    if link:
        out.append(f"print({json.dumps('Uploaded as a reproduction of run ' + run.run_id + '. Whether it reproduced: ' + link)})")
    else:
        out.append(f"print({json.dumps('Uploaded as a reproduction of run ' + run.run_id + '; its page in Q-Lab says whether it reproduced.')})")
    return "\n".join(out) + "\n"


def notebook_json(run: Run, rec: dict[str, Any], *, api_url: str, app_url: str) -> str:
    install = "%pip install " + " ".join(f'"{r}"' for r in requirements(rec))
    cell = script(run, rec, api_url=api_url, app_url=app_url, notebook=True)

    def code(src: str) -> dict:
        lines = src.splitlines(keepends=True)
        return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": lines}

    nb = {
        "cells": [
            {"cell_type": "markdown", "metadata": {},
             "source": [f"# Reproduce Q-Lab run {_one_line(run.run_id, 64)}\n", "\n",
                        "Install the recorded versions, restart the kernel, then run the second cell.\n"]},
            code(install), code(cell),
        ],
        "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                     "language_info": {"name": "python"}},
        "nbformat": 4, "nbformat_minor": 5,
    }
    return json.dumps(nb, indent=1)


# ---------------------------------------------------------------------------
# The answer sentence for the recipe
# ---------------------------------------------------------------------------

def recipe_sentence(run: Run, rec: dict[str, Any], level: str) -> str:
    if rec["source"] is None:
        return "This run can't be re-run: no circuit source was recorded with it (hash-only privacy mode, or it was too large)."
    vers = rec["versions"]
    pkgs = [f"{k} {vers[k]}" for k in rec["packages"] if vers.get(k)]
    on = f" on {run.backend}" if run.backend else ""
    hw = is_hardware(rec["backend_kind"])
    if level == "plain":
        head = f"Run the command below to repeat this experiment{on} with the same circuit, the same software versions and the same settings."
        tail = (" The machine itself can't be repeated: its noise changes every day, so expect agreement within chance at best."
                if hw else (" The same seed gives the same counts." if rec["seed"] is not None else
                            " No random seed was recorded, so expect the counts to differ by chance."))
        return head + tail
    bits = []
    if rec["shots"]:
        bits.append(f"{rec['shots']:,} shots")
    st = rec["settings"]
    if rec["source"]["stage"] == "logical":
        bits.append(f"optimization level {st['optimization_level']}" if "optimization_level" in st else "the default optimization level")
        if "seed_transpiler" in st:
            bits.append(f"transpiler seed {st['seed_transpiler']}")
    if rec["seed"] is not None:
        bits.append(f"simulator seed {rec['seed']}")
    head = "Re-run this" + (f" with {', '.join(pkgs)}" if pkgs else " (package versions weren't recorded)") + on
    head += (": " + ", ".join(bits) + ".") if bits else "."
    gaps = [m["what"] for m in rec["missing"]]
    if hw:
        tail = " Hardware noise and queue time can't be pinned: the machine has been recalibrated since."
    elif rec["seed"] is None:
        tail = " No simulator seed was recorded, so the counts will differ by shot noise."
    else:
        tail = " Everything that decides the result is pinned."
    if gaps:
        tail += " Not recorded: " + ", ".join(gaps) + "."
    if level == "expert" and rec["source"]:
        tail += f" Circuit: {rec['source']['label']}" + (f" (sha256 {rec['source']['sha256'][:12]}…)" if rec["source"].get("sha256") else "") + "."
    return head + tail


# ---------------------------------------------------------------------------
# Did the reproduction agree?
# ---------------------------------------------------------------------------

def _short(run_id: str) -> str:
    return run_id[:8]


def compare(original: Run, repro: Run, level: str = "standard") -> dict[str, Any]:
    base: dict[str, Any] = {
        "run_id": repro.run_id, "reproduction_of": original.run_id,
        "backend": repro.backend, "original_backend": original.backend,
        "created_at": repro.created_at.isoformat() if repro.created_at else None,
        "status": repro.status, "alpha": drift.ALPHA,
    }
    if not counts_of(repro):
        if (repro.status or "").lower() in PENDING:
            return {**base, "state": "pending", "sentence": "Reproduction uploaded; waiting for its results to compare."}
        estimator = primitive(repro)["kind"] == "estimator" or primitive(original)["kind"] == "estimator"
        return {**base, "state": "cant_test", "sentence": (
            "This reproduction has expectation values, not counts; Q-Lab compares counts, so it isn't judged."
            if estimator else "This reproduction has no counts to compare.")}
    if not counts_of(original):
        return {**base, "state": "cant_test", "sentence": f"The original run {_short(original.run_id)} has no counts to compare with."}
    if drift.match_kind(original, repro) is None:
        return {**base, "state": "different_circuit",
                "sentence": f"Not comparable: this upload is tagged as a reproduction of run {_short(original.run_id)}, but it ran a different circuit."}

    f = drift.facts(original, repro)
    s = f["shift"]
    other_machine = bool(original.backend and repro.backend and original.backend != repro.backend)
    exact = counts_of(original) == counts_of(repro)
    out = {**base, "match": f["match"], "shift": s, "verdict": f.get("verdict"), "code": f.get("code"),
           "hardware": f.get("hardware"), "other_machine": other_machine, "exact": exact}
    where = f" It ran on {repro.backend}, not {original.backend}." if other_machine else ""

    if not s["drifted"]:
        if exact:
            sentence = "Reproduced exactly: the same counts, shot for shot."
        elif level == "plain":
            sentence = "Reproduced: the results agree; the difference is what chance alone gives."
        elif level == "standard":
            sentence = f"Reproduced: results agree within shot noise (TVD {s['tvd']:.2f})."
        else:
            sentence = (f"Reproduced: results agree within shot noise (TVD {s['tvd']:.3f}; shot noise alone gives about "
                        f"{s['expected_tvd']:.3f}, p = {s['p_value']:.3g} with {s['shots']['a']} and {s['shots']['b']} shots).")
        return {**out, "state": "reproduced", "sentence": sentence + where}

    if level == "plain":
        head = "Didn't reproduce: the results differ more than chance explains"
    elif level == "standard":
        head = f"Didn't reproduce: the result moved (TVD {s['tvd']:.2f}, shot noise alone ≈{s['expected_tvd']:.2f})"
    else:
        head = (f"Didn't reproduce: TVD {s['tvd']:.3f}, shot noise alone gives about {s['expected_tvd']:.3f} "
                f"(95% below {s['noise_95']:.3f}), p = {s['p_value']:.3g}")
    hw = f.get("hardware") or {}
    code = (f.get("code") or {}).get("changes") or []
    code_text = ", ".join(c["text"] for c in code[:3])
    top = (hw.get("changes") or [None])[0]
    hw_text = None
    if top:
        hw_text = top["text"] + " since then"
        if level == "expert":
            hw_text += f" ({top['values']})"
        day = drift._day((hw.get("calibrated") or {}).get("b"))
        if day and level != "plain":
            hw_text += f" (calibration {day})"
    v = f.get("verdict")
    if other_machine:
        why = f"it ran on {repro.backend} instead of {original.backend}" + (f"; and {code_text}" if code_text else "")
    elif v == "hardware":
        why = f"the machine's calibration changed: {hw_text}"
    elif v == "code":
        why = f"your side changed: {code_text}"
    elif v == "both":
        why = f"both changed: {code_text}; and {hw_text}"
    elif v == "unexplained":
        why = ("the code and the recorded calibration of the qubits it used match, so something not recorded changed "
               "(drift between calibrations, crosstalk, leakage)")
    else:
        missing = [n for n, ok in (("the original", (hw.get("recorded") or {}).get("a")),
                                   ("the reproduction", (hw.get("recorded") or {}).get("b"))) if not ok]
        why = ("whether the machine changed can't be said: no calibration snapshot was recorded with " + " or ".join(missing)
               if missing else "whether the machine changed can't be said from the records")
    return {**out, "state": "not_reproduced", "sentence": f"{head} — {why}."}


def reproductions_of(db: Session, run: Run, level: str = "standard") -> list[dict[str, Any]]:
    """The caller's reproductions of this run (newest first), each compared with it."""
    q = (select(Run).where(Run.reproduction_of == run.run_id, Run.id != run.id)
         .order_by(Run.created_at.desc()).limit(MAX_REPRODUCTIONS))
    return [compare(run, r, level) for r in db.scalars(q)]


def original_of(db: Session, run: Run, level: str = "standard") -> Optional[dict[str, Any]]:
    """For a reproduction: its comparison with the original, or why there is none."""
    if not run.reproduction_of:
        return None
    original = db.scalar(select(Run).where(Run.run_id == run.reproduction_of))
    if original is None:
        return {"run_id": run.run_id, "reproduction_of": run.reproduction_of, "state": "original_not_found",
                "sentence": f"Tagged as a reproduction of run {_short(run.reproduction_of)}, which isn't in your runs."}
    return compare(original, run, level)


def timeline_marks(runs: list[Run], budget_s: float = 3.0) -> dict[str, dict[str, Any]]:
    """For the project timeline: each reproduction in the list whose original is also in it."""
    import time
    by_id = {r.run_id: r for r in runs}
    out: dict[str, dict[str, Any]] = {}
    deadline = time.monotonic() + budget_s
    for r in reversed(runs):
        orig = by_id.get(r.reproduction_of or "")
        if orig is None:
            if r.reproduction_of:
                out[r.run_id] = {"reproduction_of": r.reproduction_of, "state": "unknown"}
            continue
        if time.monotonic() > deadline:
            out[r.run_id] = {"reproduction_of": orig.run_id, "state": "unknown"}
            continue
        c = compare(orig, r)
        out[r.run_id] = {"reproduction_of": orig.run_id, "state": c["state"],
                         "tvd": (c.get("shift") or {}).get("tvd")}
    return out
