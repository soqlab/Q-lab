"""Policy-as-Code Gates — define run submission rules, enforce in SDK and at API level."""

from datetime import datetime
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1/policy", tags=["policy"])

# ------------------------------------------------------------------
# DDL — policies table (created in main.py startup)
# ------------------------------------------------------------------

# ------------------------------------------------------------------
# Pydantic
# ------------------------------------------------------------------

class PolicyPayload(BaseModel):
    name: str = "default"
    description: str = ""
    rules: dict[str, Any]   # See _RULE_DOCS below


class PolicyCheckPayload(BaseModel):
    run_payload: dict[str, Any]


# ------------------------------------------------------------------
# Rule documentation (what fields each rule checks)
# ------------------------------------------------------------------

_RULE_DOCS = {
    "max_depth":          "Maximum circuit depth (fingerprint.depth)",
    "min_depth":          "Minimum circuit depth",
    "max_qubits":         "Maximum number of qubits",
    "min_qubits":         "Minimum number of qubits",
    "max_gates":          "Maximum total gate count (fingerprint.size)",
    "max_2q_gates":       "Maximum two-qubit gate count",
    "max_non_clifford":   "Maximum non-Clifford ratio (0.0–1.0)",
    "min_shots":          "Minimum shots (parameters.shots)",
    "max_shots":          "Maximum shots",
    "required_tags":      "List of tags that MUST be present",
    "blocked_tags":       "List of tags that MUST NOT be present",
    "allowed_backends":   "Whitelist of allowed backend names",
    "blocked_backends":   "Blacklist of blocked backend names",
    "required_project":   "Run MUST belong to a project",
    "require_calibration":"Run MUST include calibration data",
    "max_non_clifford_pct": "Alias for max_non_clifford * 100",
    "min_optimization_level": "Minimum transpilation optimization level",
}

_TWO_Q_GATES = {"cx", "cz", "cy", "ecr", "rzx", "swap", "dcx", "iswap", "cs", "ccx", "cswap"}


def _check_rules(rules: dict, payload: dict) -> list[dict]:
    """Evaluate policy rules against a run payload. Returns list of violations."""
    violations = []
    fp = payload.get("fingerprint") or {}
    params = payload.get("parameters") or {}
    transpiler = payload.get("transpiler") or {}
    ts = (transpiler.get("settings") or {})
    tags = payload.get("tags") or []
    backend = payload.get("backend") or ""
    project = payload.get("project") or ""
    calibration = payload.get("calibration") or {}
    gate_counts: dict = fp.get("gate_counts") or {}

    depth = int(fp.get("depth") or 0)
    size = int(fp.get("size") or 0)
    qubits = int(fp.get("num_qubits") or 0)
    nc_ratio = float(fp.get("non_clifford_ratio") or 0)
    shots = int(params.get("shots") or 0)
    n2q = sum(int(v) for k, v in gate_counts.items() if k.lower() in _TWO_Q_GATES)
    opt_level = int(ts.get("optimization_level") or -1)

    def v(field, actual, limit, op="<=", hint=""):
        violations.append({
            "rule": field, "actual": actual, "limit": limit, "op": op,
            "message": f"{field}: {actual} {op} {limit} violated. {hint}".strip(),
        })

    if "max_depth" in rules and depth > 0 and depth > int(rules["max_depth"]):
        v("max_depth", depth, rules["max_depth"], ">")
    if "min_depth" in rules and depth > 0 and depth < int(rules["min_depth"]):
        v("min_depth", depth, rules["min_depth"], "<")
    if "max_qubits" in rules and qubits > int(rules["max_qubits"]):
        v("max_qubits", qubits, rules["max_qubits"], ">")
    if "min_qubits" in rules and qubits < int(rules["min_qubits"]):
        v("min_qubits", qubits, rules["min_qubits"], "<")
    if "max_gates" in rules and size > int(rules["max_gates"]):
        v("max_gates", size, rules["max_gates"], ">")
    if "max_2q_gates" in rules and n2q > int(rules["max_2q_gates"]):
        v("max_2q_gates", n2q, rules["max_2q_gates"], ">")
    if "max_non_clifford" in rules and nc_ratio > float(rules["max_non_clifford"]):
        v("max_non_clifford", round(nc_ratio, 3), rules["max_non_clifford"], ">")
    if "max_non_clifford_pct" in rules and nc_ratio * 100 > float(rules["max_non_clifford_pct"]):
        v("max_non_clifford_pct", round(nc_ratio * 100, 1), rules["max_non_clifford_pct"], ">")
    if "min_shots" in rules and shots > 0 and shots < int(rules["min_shots"]):
        v("min_shots", shots, rules["min_shots"], "<", "Increase shot count for statistical reliability.")
    if "max_shots" in rules and shots > int(rules["max_shots"]):
        v("max_shots", shots, rules["max_shots"], ">")
    if "required_tags" in rules:
        for req_tag in rules["required_tags"]:
            if req_tag not in tags:
                v("required_tags", tags, req_tag, "missing", f"Tag '{req_tag}' is required.")
    if "blocked_tags" in rules:
        for bl_tag in rules["blocked_tags"]:
            if bl_tag in tags:
                v("blocked_tags", bl_tag, "blocked", "present", f"Tag '{bl_tag}' is not allowed.")
    if "allowed_backends" in rules and backend and backend not in rules["allowed_backends"]:
        v("allowed_backends", backend, rules["allowed_backends"], "not in", f"Backend '{backend}' is not in the allowed list.")
    if "blocked_backends" in rules and backend and backend in rules["blocked_backends"]:
        v("blocked_backends", backend, "blocked", "in blocklist", f"Backend '{backend}' is blocked.")
    if rules.get("required_project") and not project:
        v("required_project", project, "required", "missing", "Run must be assigned to a project.")
    if rules.get("require_calibration") and not calibration:
        v("require_calibration", "missing", "required", "missing", "Run must include calibration data.")
    if "min_optimization_level" in rules and opt_level >= 0 and opt_level < int(rules["min_optimization_level"]):
        v("min_optimization_level", opt_level, rules["min_optimization_level"], "<",
          "Use a higher Qiskit transpilation optimization_level.")

    return violations


# ------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------

@router.get("")
def get_policy(db: Session = Depends(get_db)):
    try:
        row = db.execute(text(
            "SELECT * FROM qlab_policies WHERE name = 'default' ORDER BY id DESC LIMIT 1"
        )).mappings().first()
        if row is None:
            return {"name": "default", "description": "", "rules": {}, "rule_docs": _RULE_DOCS, "active": False}
        import json as _json
        return {
            "id": row["id"],
            "name": row["name"],
            "description": row["description"],
            "rules": _json.loads(row["rules"]) if isinstance(row["rules"], str) else row["rules"],
            "created_at": row["created_at"],
            "rule_docs": _RULE_DOCS,
            "active": True,
        }
    except Exception:
        return {"name": "default", "description": "", "rules": {}, "rule_docs": _RULE_DOCS, "active": False}


@router.post("")
def save_policy(payload: PolicyPayload, db: Session = Depends(get_db)):
    import json as _json
    try:
        db.execute(text(
            "INSERT INTO qlab_policies (name, description, rules, created_at) VALUES (:n, :d, :r, :t)"
        ), {"n": payload.name, "d": payload.description,
            "r": _json.dumps(payload.rules), "t": datetime.utcnow().isoformat()})
        db.commit()
        return {"saved": True, "name": payload.name, "rule_count": len(payload.rules)}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/check")
def check_policy(payload: PolicyCheckPayload, db: Session = Depends(get_db)):
    try:
        row = db.execute(text(
            "SELECT rules FROM qlab_policies WHERE name = 'default' ORDER BY id DESC LIMIT 1"
        )).mappings().first()
    except Exception:
        return {"policy_active": False, "passed": True, "violations": []}

    if row is None:
        return {"policy_active": False, "passed": True, "violations": []}

    import json as _json
    rules = _json.loads(row["rules"]) if isinstance(row["rules"], str) else (row["rules"] or {})
    violations = _check_rules(rules, payload.run_payload)
    return {
        "policy_active": True,
        "passed": len(violations) == 0,
        "violation_count": len(violations),
        "violations": violations,
    }


# Also expose rule docs via GET for SDK help
@router.get("/rules")
def list_rule_docs():
    return _RULE_DOCS
