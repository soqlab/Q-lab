"""Plugin Registry — community-published extensions to Q-Lab.

Any user can publish a plugin. Plugins are stored in the generic key-value
store under the namespace "plugin_registry".
"""
from __future__ import annotations

from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_delete, store_get, store_list, store_put, store_seed

router = APIRouter(prefix="/api/v1/plugins", tags=["plugins"])

NAMESPACE = "plugin_registry"

VALID_CATEGORIES = {"analysis", "visualization", "hardware", "export", "ai", "integration"}


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class Plugin(BaseModel):
    plugin_id: str
    name: str
    slug: str
    version: str
    description: str
    author: str
    category: str
    tags: List[str]
    install_command: str
    homepage_url: Optional[str] = None
    source_url: Optional[str] = None
    docs_url: Optional[str] = None
    icon_emoji: str
    downloads: int
    rating: float
    rating_count: int
    compatible_versions: List[str]
    hooks: List[str]
    is_official: bool
    created_at: str
    updated_at: str


class PluginCreate(BaseModel):
    name: str = Field(..., max_length=200)
    slug: str = Field(..., max_length=80, pattern=r"^[a-z0-9-]+$")
    version: str = Field(..., max_length=32)
    description: str = Field(..., max_length=2000)
    author: str = Field(..., max_length=200)
    category: str
    tags: List[str] = Field(default_factory=list)
    install_command: str = Field(..., max_length=500)
    homepage_url: Optional[str] = None
    source_url: Optional[str] = None
    docs_url: Optional[str] = None
    icon_emoji: str = Field(default="🔌", max_length=8)
    compatible_versions: List[str] = Field(default_factory=list)
    hooks: List[str] = Field(default_factory=list)


class RateBody(BaseModel):
    rating: float = Field(..., ge=1.0, le=5.0)


# ─────────────────────────────────────────────────────────────────────────────
# Seed data — 12 realistic community plugins
# ─────────────────────────────────────────────────────────────────────────────

_SEED_PLUGINS: list[dict[str, Any]] = [
    {
        "plugin_id": "plugin_zne_advisor",
        "name": "ZNE Advisor",
        "slug": "zne-advisor",
        "version": "1.2.0",
        "description": "Automatically suggests optimal Zero-Noise Extrapolation parameters based on your circuit's noise model. Analyses gate error rates and T1/T2 times to recommend noise scaling factors and extrapolation order.",
        "author": "Q-Lab Community",
        "category": "analysis",
        "tags": ["zne", "error-mitigation", "noise", "mitigation"],
        "install_command": "pip install qlab-plugin-zne",
        "homepage_url": "https://github.com/qlab-community/zne-advisor",
        "source_url": "https://github.com/qlab-community/zne-advisor",
        "docs_url": "https://qlab-community.github.io/zne-advisor",
        "icon_emoji": "🔬",
        "downloads": 8432,
        "rating": 4.7,
        "rating_count": 112,
        "compatible_versions": ["0.1.x", "0.2.x", "0.3.x"],
        "hooks": ["after_run", "insight_panel"],
        "is_official": True,
        "created_at": "2024-01-15T10:00:00Z",
        "updated_at": "2024-11-20T14:30:00Z",
    },
    {
        "plugin_id": "plugin_qiskit_textbook",
        "name": "Qiskit Textbook Circuits",
        "slug": "qiskit-textbook-circuits",
        "version": "2.0.1",
        "description": "Import circuits directly from the Qiskit Textbook by chapter and example number. Supports all chapters from Introduction through Quantum Error Correction with automatic parameter binding.",
        "author": "textbook-bridge-dev",
        "category": "integration",
        "tags": ["qiskit", "textbook", "education", "circuits", "import"],
        "install_command": "pip install qlab-plugin-qiskit-textbook",
        "homepage_url": "https://github.com/textbook-bridge-dev/qlab-textbook",
        "source_url": "https://github.com/textbook-bridge-dev/qlab-textbook",
        "docs_url": None,
        "icon_emoji": "📚",
        "downloads": 5120,
        "rating": 4.3,
        "rating_count": 78,
        "compatible_versions": ["0.2.x", "0.3.x"],
        "hooks": ["before_submit"],
        "is_official": False,
        "created_at": "2024-02-10T09:00:00Z",
        "updated_at": "2024-10-05T11:00:00Z",
    },
    {
        "plugin_id": "plugin_pennylane_bridge",
        "name": "PennyLane Bridge",
        "slug": "pennylane-bridge",
        "version": "0.9.3",
        "description": "Export Q-Lab runs to PennyLane format for hybrid quantum-classical machine learning workflows. Converts QASM circuits to PennyLane QNodes and syncs measurement results back to Q-Lab.",
        "author": "hybrid-ml-tools",
        "category": "integration",
        "tags": ["pennylane", "export", "qml", "hybrid", "machine-learning"],
        "install_command": "pip install qlab-plugin-pennylane",
        "homepage_url": "https://hybrid-ml-tools.io/pennylane-bridge",
        "source_url": "https://github.com/hybrid-ml-tools/qlab-pennylane",
        "docs_url": "https://hybrid-ml-tools.io/docs/pennylane-bridge",
        "icon_emoji": "🔗",
        "downloads": 6789,
        "rating": 4.5,
        "rating_count": 94,
        "compatible_versions": ["0.2.x", "0.3.x"],
        "hooks": ["after_run"],
        "is_official": False,
        "created_at": "2024-03-01T12:00:00Z",
        "updated_at": "2024-12-01T16:00:00Z",
    },
    {
        "plugin_id": "plugin_matplotlib_figures",
        "name": "Matplotlib Figure Pack",
        "slug": "matplotlib-figure-pack",
        "version": "3.1.0",
        "description": "Publication-ready matplotlib figures for Q-Lab run data. Generates Bloch sphere plots, Hinton diagrams, and state fidelity bar charts formatted for IEEE/Nature journals with customisable colour schemes.",
        "author": "quantum-viz-lab",
        "category": "visualization",
        "tags": ["matplotlib", "figures", "publication", "visualization", "plots"],
        "install_command": "pip install qlab-plugin-matplotlib-figures",
        "homepage_url": "https://quantum-viz-lab.github.io",
        "source_url": "https://github.com/quantum-viz-lab/qlab-figures",
        "docs_url": "https://quantum-viz-lab.github.io/docs",
        "icon_emoji": "📊",
        "downloads": 11340,
        "rating": 4.8,
        "rating_count": 203,
        "compatible_versions": ["0.1.x", "0.2.x", "0.3.x"],
        "hooks": ["insight_panel", "after_run"],
        "is_official": False,
        "created_at": "2024-01-20T08:00:00Z",
        "updated_at": "2024-11-30T10:00:00Z",
    },
    {
        "plugin_id": "plugin_ionq_optimizer",
        "name": "IonQ Optimizer",
        "slug": "ionq-optimizer",
        "version": "1.0.4",
        "description": "IonQ-specific gate optimisation that rewrites circuits to maximise fidelity on trapped-ion hardware. Leverages native MS gates and all-to-all connectivity to reduce circuit depth by up to 40%.",
        "author": "ionq-community",
        "category": "hardware",
        "tags": ["ionq", "optimization", "trapped-ion", "hardware", "gate-set"],
        "install_command": "pip install qlab-plugin-ionq-optimizer",
        "homepage_url": "https://github.com/ionq-community/qlab-ionq",
        "source_url": "https://github.com/ionq-community/qlab-ionq",
        "docs_url": "https://github.com/ionq-community/qlab-ionq/wiki",
        "icon_emoji": "⚛️",
        "downloads": 3201,
        "rating": 4.6,
        "rating_count": 45,
        "compatible_versions": ["0.2.x", "0.3.x"],
        "hooks": ["before_submit"],
        "is_official": False,
        "created_at": "2024-04-05T14:00:00Z",
        "updated_at": "2024-09-18T09:00:00Z",
    },
    {
        "plugin_id": "plugin_clifford_checker",
        "name": "Clifford Checker",
        "slug": "clifford-checker",
        "version": "0.7.1",
        "description": "Verifies whether a circuit is Clifford-stabilizable using the Gottesman-Knill theorem. Reports which gates break Clifford membership and estimates classical simulation feasibility.",
        "author": "stabilizer-tools",
        "category": "analysis",
        "tags": ["clifford", "stabilizer", "analysis", "simulation", "gottesman-knill"],
        "install_command": "pip install qlab-plugin-clifford-checker",
        "homepage_url": None,
        "source_url": "https://github.com/stabilizer-tools/clifford-checker",
        "docs_url": None,
        "icon_emoji": "✅",
        "downloads": 2874,
        "rating": 4.2,
        "rating_count": 31,
        "compatible_versions": ["0.2.x", "0.3.x"],
        "hooks": ["after_run", "insight_panel"],
        "is_official": False,
        "created_at": "2024-05-12T11:00:00Z",
        "updated_at": "2024-08-22T13:00:00Z",
    },
    {
        "plugin_id": "plugin_arxiv_autocite",
        "name": "arXiv AutoCite",
        "slug": "arxiv-autocite",
        "version": "1.3.2",
        "description": "Auto-generates BibTeX citations for the quantum techniques used in your runs. Identifies algorithms (VQE, QAOA, ZNE, etc.) and searches arXiv for the canonical papers, outputting ready-to-paste BibTeX.",
        "author": "qlab-ai-team",
        "category": "ai",
        "tags": ["arxiv", "citations", "bibtex", "ai", "references", "publication"],
        "install_command": "pip install qlab-plugin-arxiv-autocite",
        "homepage_url": "https://github.com/qlab-ai-team/arxiv-autocite",
        "source_url": "https://github.com/qlab-ai-team/arxiv-autocite",
        "docs_url": "https://qlab-ai-team.github.io/arxiv-autocite",
        "icon_emoji": "📝",
        "downloads": 7654,
        "rating": 4.4,
        "rating_count": 88,
        "compatible_versions": ["0.2.x", "0.3.x"],
        "hooks": ["insight_panel", "after_run"],
        "is_official": True,
        "created_at": "2024-02-28T15:00:00Z",
        "updated_at": "2024-12-10T17:00:00Z",
    },
    {
        "plugin_id": "plugin_slack_notifier",
        "name": "Slack Notifier",
        "slug": "slack-notifier",
        "version": "2.2.0",
        "description": "Sends run completion notifications to Slack channels with rich message formatting. Includes health score, key metrics, circuit thumbnail, and a direct link to the Q-Lab dashboard.",
        "author": "ops-integrations",
        "category": "integration",
        "tags": ["slack", "notifications", "alerts", "webhook", "team"],
        "install_command": "pip install qlab-plugin-slack-notifier",
        "homepage_url": "https://github.com/ops-integrations/qlab-slack",
        "source_url": "https://github.com/ops-integrations/qlab-slack",
        "docs_url": "https://github.com/ops-integrations/qlab-slack#readme",
        "icon_emoji": "💬",
        "downloads": 9021,
        "rating": 4.6,
        "rating_count": 157,
        "compatible_versions": ["0.1.x", "0.2.x", "0.3.x"],
        "hooks": ["after_run"],
        "is_official": False,
        "created_at": "2024-01-08T10:00:00Z",
        "updated_at": "2024-11-15T12:00:00Z",
    },
    {
        "plugin_id": "plugin_jupyter_dashboard",
        "name": "Jupyter Dashboard Widget",
        "slug": "jupyter-dashboard-widget",
        "version": "1.1.0",
        "description": "An ipywidget for live run monitoring inside Jupyter notebooks. Displays real-time health score, qubit map, and convergence curves that auto-refresh as the quantum job executes.",
        "author": "jupyter-quantum-tools",
        "category": "visualization",
        "tags": ["jupyter", "ipywidget", "notebook", "live", "monitoring"],
        "install_command": "pip install qlab-plugin-jupyter-widget",
        "homepage_url": "https://jupyter-quantum-tools.io",
        "source_url": "https://github.com/jupyter-quantum-tools/qlab-widget",
        "docs_url": "https://jupyter-quantum-tools.io/docs",
        "icon_emoji": "📓",
        "downloads": 4389,
        "rating": 4.1,
        "rating_count": 62,
        "compatible_versions": ["0.2.x", "0.3.x"],
        "hooks": ["insight_panel"],
        "is_official": False,
        "created_at": "2024-06-01T09:00:00Z",
        "updated_at": "2024-10-30T14:00:00Z",
    },
    {
        "plugin_id": "plugin_spam_calibration",
        "name": "SPAM Calibration",
        "slug": "spam-calibration",
        "version": "1.5.2",
        "description": "State Preparation and Measurement (SPAM) error calibration for Q-Lab runs. Generates calibration matrices, applies readout error mitigation, and reports corrected expectation values.",
        "author": "error-cal-suite",
        "category": "hardware",
        "tags": ["spam", "calibration", "readout-error", "mitigation", "measurement"],
        "install_command": "pip install qlab-plugin-spam-cal",
        "homepage_url": "https://github.com/error-cal-suite/spam-calibration",
        "source_url": "https://github.com/error-cal-suite/spam-calibration",
        "docs_url": "https://error-cal-suite.readthedocs.io",
        "icon_emoji": "🎯",
        "downloads": 5678,
        "rating": 4.5,
        "rating_count": 73,
        "compatible_versions": ["0.2.x", "0.3.x"],
        "hooks": ["before_submit", "after_run"],
        "is_official": True,
        "created_at": "2024-03-20T13:00:00Z",
        "updated_at": "2024-12-05T10:00:00Z",
    },
    {
        "plugin_id": "plugin_pauli_twirl",
        "name": "Pauli Twirl Helper",
        "slug": "pauli-twirl-helper",
        "version": "0.4.0",
        "description": "Automatically applies Pauli twirling to two-qubit gates in your circuits before submission. Converts coherent noise into depolarising noise to enable more accurate error models and ZNE extrapolation.",
        "author": "twirling-lab",
        "category": "analysis",
        "tags": ["pauli-twirling", "noise", "error-model", "two-qubit", "depolarizing"],
        "install_command": "pip install qlab-plugin-pauli-twirl",
        "homepage_url": None,
        "source_url": "https://github.com/twirling-lab/qlab-pauli-twirl",
        "docs_url": None,
        "icon_emoji": "🌀",
        "downloads": 3102,
        "rating": 4.0,
        "rating_count": 28,
        "compatible_versions": ["0.2.x", "0.3.x"],
        "hooks": ["before_submit"],
        "is_official": False,
        "created_at": "2024-07-10T11:00:00Z",
        "updated_at": "2024-11-01T09:00:00Z",
    },
    {
        "plugin_id": "plugin_csv_exporter_pro",
        "name": "CSV Exporter Pro",
        "slug": "csv-exporter-pro",
        "version": "2.0.0",
        "description": "Rich CSV export with all run metadata, calibration values, transpiler statistics, and custom user-defined columns. Supports multi-run batch export, pandas-compatible output, and streaming for large datasets.",
        "author": "data-export-tools",
        "category": "export",
        "tags": ["csv", "export", "data", "pandas", "batch", "analysis"],
        "install_command": "pip install qlab-plugin-csv-pro",
        "homepage_url": "https://data-export-tools.io/qlab-csv",
        "source_url": "https://github.com/data-export-tools/qlab-csv-pro",
        "docs_url": "https://data-export-tools.io/qlab-csv/docs",
        "icon_emoji": "📋",
        "downloads": 12890,
        "rating": 4.9,
        "rating_count": 241,
        "compatible_versions": ["0.1.x", "0.2.x", "0.3.x"],
        "hooks": ["after_run"],
        "is_official": False,
        "created_at": "2024-01-05T07:00:00Z",
        "updated_at": "2024-12-15T08:00:00Z",
    },
]


def _seed(db: Session) -> None:
    store_seed(
        db,
        NAMESPACE,
        [(p["plugin_id"], p) for p in _SEED_PLUGINS],
    )


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("")
def list_plugins(
    category: Optional[str] = Query(default=None),
    tag: Optional[str] = Query(default=None),
    sort: str = Query(default="downloads", enum=["downloads", "rating", "newest"]),
    db: Session = Depends(get_db),
) -> list[dict]:
    _seed(db)
    plugins = store_list(db, NAMESPACE)

    if category:
        plugins = [p for p in plugins if p.get("category") == category]
    if tag:
        plugins = [p for p in plugins if tag in (p.get("tags") or [])]

    if sort == "downloads":
        plugins.sort(key=lambda p: p.get("downloads", 0), reverse=True)
    elif sort == "rating":
        plugins.sort(key=lambda p: p.get("rating", 0.0), reverse=True)
    elif sort == "newest":
        plugins.sort(key=lambda p: p.get("created_at", ""), reverse=True)

    return plugins


@router.get("/categories")
def list_categories(db: Session = Depends(get_db)) -> list[dict]:
    _seed(db)
    plugins = store_list(db, NAMESPACE)
    counts: dict[str, int] = {}
    for p in plugins:
        cat = p.get("category", "other")
        counts[cat] = counts.get(cat, 0) + 1
    return [{"category": cat, "count": cnt} for cat, cnt in sorted(counts.items())]


@router.get("/{plugin_id}")
def get_plugin(plugin_id: str, db: Session = Depends(get_db)) -> dict:
    _seed(db)
    plugin = store_get(db, NAMESPACE, plugin_id)
    if plugin is None:
        raise HTTPException(status_code=404, detail="Plugin not found")
    return plugin


@router.post("", status_code=201)
def publish_plugin(body: PluginCreate, db: Session = Depends(get_db)) -> dict:
    if body.category not in VALID_CATEGORIES:
        raise HTTPException(
            status_code=422,
            detail=f"category must be one of: {', '.join(sorted(VALID_CATEGORIES))}",
        )

    from datetime import datetime, timezone
    import uuid

    plugin_id = f"plugin_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()

    plugin: dict[str, Any] = {
        "plugin_id": plugin_id,
        "name": body.name,
        "slug": body.slug,
        "version": body.version,
        "description": body.description,
        "author": body.author,
        "category": body.category,
        "tags": body.tags,
        "install_command": body.install_command,
        "homepage_url": body.homepage_url,
        "source_url": body.source_url,
        "docs_url": body.docs_url,
        "icon_emoji": body.icon_emoji,
        "downloads": 0,
        "rating": 0.0,
        "rating_count": 0,
        "compatible_versions": body.compatible_versions,
        "hooks": body.hooks,
        "is_official": False,
        "created_at": now,
        "updated_at": now,
    }

    _seed(db)  # ensure seed ran first
    store_put(db, NAMESPACE, plugin_id, plugin)
    return plugin


@router.post("/{plugin_id}/rate")
def rate_plugin(plugin_id: str, body: RateBody, db: Session = Depends(get_db)) -> dict:
    _seed(db)
    plugin = store_get(db, NAMESPACE, plugin_id)
    if plugin is None:
        raise HTTPException(status_code=404, detail="Plugin not found")

    from datetime import datetime, timezone

    old_count = plugin.get("rating_count", 0)
    old_rating = plugin.get("rating", 0.0)
    new_count = old_count + 1
    new_rating = round(((old_rating * old_count) + body.rating) / new_count, 2)

    plugin["rating"] = new_rating
    plugin["rating_count"] = new_count
    plugin["updated_at"] = datetime.now(timezone.utc).isoformat()

    store_put(db, NAMESPACE, plugin_id, plugin)
    return {"plugin_id": plugin_id, "rating": new_rating, "rating_count": new_count}
