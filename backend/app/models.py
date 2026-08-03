from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Organizations
# ---------------------------------------------------------------------------

class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    plan: Mapped[str] = mapped_column(String(64), default="free")  # free | pro | enterprise
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    users: Mapped[list["User"]] = relationship(back_populates="org")
    api_keys: Mapped[list["APIKey"]] = relationship(back_populates="org")
    webhooks: Mapped[list["Webhook"]] = relationship(back_populates="org")


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(64), default="researcher")  # owner|admin|researcher|viewer
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    verify_token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    verify_token_expires: Mapped[float | None] = mapped_column(Float, nullable=True)
    reset_token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reset_token_expires: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    login_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    org: Mapped["Organization | None"] = relationship(back_populates="users")
    api_keys: Mapped[list["APIKey"]] = relationship(back_populates="user")


# ---------------------------------------------------------------------------
# API Keys (per-user, SDK-facing)
# ---------------------------------------------------------------------------

class APIKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    key_hash: Mapped[str] = mapped_column(String(256), unique=True, index=True)
    key_prefix: Mapped[str] = mapped_column(String(16))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped["User"] = relationship(back_populates="api_keys")
    org: Mapped["Organization | None"] = relationship(back_populates="api_keys")


# ---------------------------------------------------------------------------
# Audit Log (append-only, tamper-evident)
# ---------------------------------------------------------------------------

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(120), index=True)
    resource_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    resource_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


# ---------------------------------------------------------------------------
# Benchmarks (fan-out: same circuit → N backends)
# ---------------------------------------------------------------------------

class Benchmark(Base):
    __tablename__ = "benchmarks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    benchmark_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    circuit_qasm: Mapped[str | None] = mapped_column(Text, nullable=True)
    backends: Mapped[list[str]] = mapped_column(JSON, default=list)
    run_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(64), default="running")
    project_slug: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


# ---------------------------------------------------------------------------
# Webhooks
# ---------------------------------------------------------------------------

class Webhook(Base):
    __tablename__ = "webhooks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    url: Mapped[str] = mapped_column(String(2000))
    events: Mapped[list[str]] = mapped_column(JSON, default=list)
    secret: Mapped[str | None] = mapped_column(String(256), nullable=True)
    project_slug: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    org: Mapped["Organization | None"] = relationship(back_populates="webhooks")


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    runs: Mapped[list["Run"]] = relationship(back_populates="project")


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------

class Run(Base):
    __tablename__ = "runs"
    __table_args__ = (UniqueConstraint("run_id", name="uq_runs_run_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[str] = mapped_column(String(64), index=True)
    circuit_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    qasm: Mapped[str | None] = mapped_column(Text, nullable=True)
    backend: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(64), index=True, default="submitted")
    share_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    project_slug: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), nullable=True)
    # Platform fields
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    benchmark_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    fingerprint: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    context: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    parameters: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    execution: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    calibration: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    transpiler: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    timing: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    results: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    shadow_results: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)

    share_token: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True, index=True)

    project: Mapped["Project | None"] = relationship(back_populates="runs")


# ---------------------------------------------------------------------------
# Experiment Campaigns
# ---------------------------------------------------------------------------

class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    project_slug: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    grid_spec: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(32), default="running", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# Org Invites (team join links)
# ---------------------------------------------------------------------------

class RunNote(Base):
    __tablename__ = "run_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[str] = mapped_column(String(64), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped["User | None"] = relationship()


class RunMetric(Base):
    __tablename__ = "run_metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    value: Mapped[float] = mapped_column(Float)
    step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class RunAssertion(Base):
    __tablename__ = "run_assertions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[str] = mapped_column(String(64), index=True)
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    assertion_type: Mapped[str] = mapped_column(String(64), default="min_prob")
    state: Mapped[str | None] = mapped_column(String(200), nullable=True)
    expected_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    expected_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    actual_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    passed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class AdviceFeedback(Base):
    __tablename__ = "advice_feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[str] = mapped_column(String(64), index=True)
    feature: Mapped[str] = mapped_column(String(64), index=True)
    item_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    rating: Mapped[str] = mapped_column(String(32), index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class OrgInvite(Base):
    __tablename__ = "org_invites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    role: Mapped[str] = mapped_column(String(64), default="researcher")
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    invited_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    org: Mapped["Organization"] = relationship()


# ---------------------------------------------------------------------------
# Job Submission Engine
# ---------------------------------------------------------------------------

class JobSubmission(Base):
    __tablename__ = "job_submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    provider: Mapped[str] = mapped_column(String(32), index=True)   # ibm | ionq | braket | simulator
    provider_job_id: Mapped[str | None] = mapped_column(String(256), nullable=True, index=True)
    run_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    qasm: Mapped[str | None] = mapped_column(Text, nullable=True)
    backend: Mapped[str] = mapped_column(String(255), index=True)
    shots: Mapped[int] = mapped_column(Integer, default=1024)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    provider_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    cost_credits: Mapped[float | None] = mapped_column(Float, nullable=True)
    circuit_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    project_slug: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# Circuit Versioning
# ---------------------------------------------------------------------------

class CircuitVersion(Base):
    __tablename__ = "circuit_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    circuit_family: Mapped[str] = mapped_column(String(255), index=True)
    version_num: Mapped[int] = mapped_column(Integer, default=1)
    qasm: Mapped[str] = mapped_column(Text)
    parent_version_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    diff_stats: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    commit_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    project_slug: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    run_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


# ---------------------------------------------------------------------------
# Budget Alerts (QPU Cost Tracking)
# ---------------------------------------------------------------------------

class BudgetAlert(Base):
    __tablename__ = "budget_alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    alert_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    budget_type: Mapped[str] = mapped_column(String(32), default="monthly")  # monthly | project | total
    project_slug: Mapped[str | None] = mapped_column(String(120), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(32), nullable=True)  # ibm | ionq | braket | all
    threshold_credits: Mapped[float] = mapped_column(Float, default=100.0)
    alert_at_pct: Mapped[float] = mapped_column(Float, default=0.8)
    triggered: Mapped[bool] = mapped_column(Boolean, default=False)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------------------
# Variational Algorithm Runs (VQE / QAOA)
# ---------------------------------------------------------------------------

class VariationalRun(Base):
    __tablename__ = "variational_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vrun_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    algorithm: Mapped[str] = mapped_column(String(32), index=True)  # vqe | qaoa | adapt_vqe | other
    run_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    project_slug: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    ansatz_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    n_parameters: Mapped[int] = mapped_column(Integer, default=0)
    n_qubits: Mapped[int] = mapped_column(Integer, default=0)
    hamiltonian_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    iterations: Mapped[list[Any]] = mapped_column(JSON, default=list)
    optimal_energy: Mapped[float | None] = mapped_column(Float, nullable=True)
    optimal_params: Mapped[list[float]] = mapped_column(JSON, default=list)
    convergence_status: Mapped[str] = mapped_column(String(32), default="running")
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# CI/CD Integrations
# ---------------------------------------------------------------------------

class CICDIntegration(Base):
    __tablename__ = "cicd_integrations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    integration_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    provider: Mapped[str] = mapped_column(String(32), default="github")  # github | gitlab | bitbucket
    repo_url: Mapped[str] = mapped_column(String(500))
    webhook_secret: Mapped[str] = mapped_column(String(256))
    project_slug: Mapped[str | None] = mapped_column(String(120), nullable=True)
    baseline_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    auto_fail_threshold: Mapped[float] = mapped_column(Float, default=10.0)  # health score drop %
    checks: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------------------
# CI/CD Check Runs
# ---------------------------------------------------------------------------

class CICDCheck(Base):
    __tablename__ = "cicd_checks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    check_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    integration_id: Mapped[str] = mapped_column(String(64), index=True)
    commit_sha: Mapped[str] = mapped_column(String(64))
    branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")  # pending | running | passed | failed
    results: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# State Tomography Jobs
# ---------------------------------------------------------------------------

class TomographyJob(Base):
    __tablename__ = "tomography_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tomo_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    run_id: Mapped[str] = mapped_column(String(64), index=True)
    n_qubits: Mapped[int] = mapped_column(Integer)
    basis_measurements: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # {"ZZ": counts, "XX": counts, ...}
    density_matrix_re: Mapped[list[Any]] = mapped_column(JSON, default=list)   # real part
    density_matrix_im: Mapped[list[Any]] = mapped_column(JSON, default=list)   # imag part
    purity: Mapped[float | None] = mapped_column(Float, nullable=True)
    fidelity_to_ideal: Mapped[float | None] = mapped_column(Float, nullable=True)
    ideal_state: Mapped[str | None] = mapped_column(String(64), nullable=True)
    pauli_expectations: Mapped[dict[str, float]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="complete")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


# ---------------------------------------------------------------------------
# API Credentials (provider key vault)
# ---------------------------------------------------------------------------

class ApiCredential(Base):
    __tablename__ = "api_credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cred_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    provider: Mapped[str] = mapped_column(String(32), index=True)
    label: Mapped[str] = mapped_column(String(200))
    encrypted_key: Mapped[str] = mapped_column(Text)
    key_hint: Mapped[str] = mapped_column(String(12))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------------------
# Notification Channels
# ---------------------------------------------------------------------------

class NotificationChannel(Base):
    __tablename__ = "notification_channels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    channel_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    channel_type: Mapped[str] = mapped_column(String(32))
    config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    events: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class NotificationLog(Base):
    __tablename__ = "notification_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    channel_id: Mapped[str] = mapped_column(String(64), index=True)
    event: Mapped[str] = mapped_column(String(120))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="sent")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


# ---------------------------------------------------------------------------
# Quantum Volume Results
# ---------------------------------------------------------------------------

class QuantumVolumeResult(Base):
    __tablename__ = "qv_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    qv_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    backend: Mapped[str] = mapped_column(String(255), index=True)
    qv_achieved: Mapped[int] = mapped_column(Integer)
    n_qubits_tested: Mapped[int] = mapped_column(Integer)
    n_trials: Mapped[int] = mapped_column(Integer, default=100)
    heavy_output_prob: Mapped[float] = mapped_column(Float)
    pass_threshold: Mapped[float] = mapped_column(Float, default=0.6667)
    trial_results: Mapped[list[Any]] = mapped_column(JSON, default=list)
    job_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


# ---------------------------------------------------------------------------
# Gate Characterization (per-qubit T1/T2/Fidelity)
# ---------------------------------------------------------------------------

class GateCharResult(Base):
    __tablename__ = "gate_char_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    char_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    backend: Mapped[str] = mapped_column(String(255), index=True)
    char_type: Mapped[str] = mapped_column(String(32), index=True)
    qubit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    qubit_pair: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
    gate: Mapped[str | None] = mapped_column(String(64), nullable=True)
    curve_data: Mapped[list[Any]] = mapped_column(JSON, default=list)
    fit_params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    metric_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    metric_unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


# ---------------------------------------------------------------------------
# Circuit Templates
# ---------------------------------------------------------------------------

class CircuitTemplate(Base):
    __tablename__ = "circuit_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    template_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    category: Mapped[str] = mapped_column(String(64), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    qasm: Mapped[str] = mapped_column(Text)
    n_qubits: Mapped[int] = mapped_column(Integer)
    parameters: Mapped[list[str]] = mapped_column(JSON, default=list)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    use_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------------------
# Decoherence Alerts
# ---------------------------------------------------------------------------

class DecoherenceAlert(Base):
    __tablename__ = "decoherence_alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    alert_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    org_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), nullable=True)
    backend: Mapped[str] = mapped_column(String(255), index=True)
    metric: Mapped[str] = mapped_column(String(32))
    qubit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    threshold: Mapped[float] = mapped_column(Float)
    condition: Mapped[str] = mapped_column(String(16), default="below")
    triggered: Mapped[bool] = mapped_column(Boolean, default=False)
    triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    notification_channel_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------------------
# Genetic Circuit Evolution
# ---------------------------------------------------------------------------

class EvolutionRun(Base):
    __tablename__ = "evolution_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    circuit_name: Mapped[str] = mapped_column(String(200), default="")
    original_qasm: Mapped[str] = mapped_column(Text)
    evolved_qasm: Mapped[str] = mapped_column(Text)
    best_fitness: Mapped[float] = mapped_column(Float)
    improvement: Mapped[float] = mapped_column(Float, default=0.0)
    n_generations: Mapped[int] = mapped_column(Integer)
    population_size: Mapped[int] = mapped_column(Integer)
    fitness_history: Mapped[list] = mapped_column(JSON, default=list)
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------------------
# Predictive Hardware Health Forecast
# ---------------------------------------------------------------------------

class HealthForecast(Base):
    __tablename__ = "health_forecasts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    forecast_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    backend: Mapped[str] = mapped_column(String(255), index=True)
    metric: Mapped[str] = mapped_column(String(32))
    current_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    forecast_24h: Mapped[float | None] = mapped_column(Float, nullable=True)
    forecast_48h: Mapped[float | None] = mapped_column(Float, nullable=True)
    forecast_72h: Mapped[float | None] = mapped_column(Float, nullable=True)
    trend_slope: Mapped[float | None] = mapped_column(Float, nullable=True)
    risk_level: Mapped[str] = mapped_column(String(16), default="unknown")
    data_points: Mapped[int] = mapped_column(Integer, default=0)
    series: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------------------
# Quantum Advantage Detector
# ---------------------------------------------------------------------------

class AdvantageResult(Base):
    __tablename__ = "advantage_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    result_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    problem_type: Mapped[str] = mapped_column(String(64))
    n_qubits: Mapped[int] = mapped_column(Integer)
    quantum_score: Mapped[float] = mapped_column(Float)
    classical_score: Mapped[float] = mapped_column(Float)
    advantage_ratio: Mapped[float] = mapped_column(Float)
    quantum_time_ms: Mapped[float] = mapped_column(Float)
    classical_time_ms: Mapped[float] = mapped_column(Float)
    verdict: Mapped[str] = mapped_column(String(32))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------------------
# Fault Injection / Chaos Testing
# ---------------------------------------------------------------------------

class FaultInjectionResult(Base):
    __tablename__ = "fault_injection_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    result_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    circuit_name: Mapped[str] = mapped_column(String(200), default="")
    fault_type: Mapped[str] = mapped_column(String(32))
    fault_rate: Mapped[float] = mapped_column(Float)
    n_trials: Mapped[int] = mapped_column(Integer)
    mean_fidelity: Mapped[float] = mapped_column(Float)
    min_fidelity: Mapped[float] = mapped_column(Float)
    resilience_score: Mapped[float] = mapped_column(Float)
    grade: Mapped[str] = mapped_column(String(2))
    trial_results: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------------------
# Reproducibility Engine
# ---------------------------------------------------------------------------

class ReproducibilityResult(Base):
    __tablename__ = "reproducibility_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    result_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    original_run_id: Mapped[str] = mapped_column(String(64), index=True)
    n_reruns: Mapped[int] = mapped_column(Integer)
    mean_tvd: Mapped[float] = mapped_column(Float)
    std_tvd: Mapped[float] = mapped_column(Float)
    reproducibility_score: Mapped[float] = mapped_column(Float)
    grade: Mapped[str] = mapped_column(String(2))
    trial_tvds: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------------------
# Circuit DNA Fingerprinting
# ---------------------------------------------------------------------------

class CircuitDNA(Base):
    __tablename__ = "circuit_dna"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dna_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    dna_hash: Mapped[str] = mapped_column(String(64), index=True)
    circuit_name: Mapped[str] = mapped_column(String(200), default="")
    qasm: Mapped[str] = mapped_column(Text)
    distribution_signature: Mapped[list] = mapped_column(JSON, default=list)
    n_qubits: Mapped[int] = mapped_column(Integer)
    n_gates: Mapped[int] = mapped_column(Integer)
    run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------------------
# Quantum-Certified RNG
# ---------------------------------------------------------------------------

class QRNGResult(Base):
    __tablename__ = "qrng_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    result_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    n_bits: Mapped[int] = mapped_column(Integer)
    hex_output: Mapped[str] = mapped_column(Text)
    chsh_value: Mapped[float] = mapped_column(Float)
    is_quantum_certified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------------------
# Generic Feature Store (JSON-backed key-value table for feature routers)
# ---------------------------------------------------------------------------

class GenericRecord(Base):
    """Universal persistence for feature routers — one table, many namespaces."""
    __tablename__ = "generic_records"
    __table_args__ = (
        UniqueConstraint("namespace", "record_id", name="uq_generic_ns_rid"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    namespace: Mapped[str] = mapped_column(String(120), index=True)
    record_id: Mapped[str] = mapped_column(String(64), index=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
