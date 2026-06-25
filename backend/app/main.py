import hashlib
import html
import io
import csv
import json
import os
import zipfile
from datetime import datetime, timezone
from difflib import unified_diff
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .analytics import get_timeseries, get_backend_stats, get_kpis
from .database import DATA_DIR, SessionLocal, get_db, init_db
from .deps import Identity, get_identity, log_audit, require_auth
from .events import event_stream, publish_sync, set_event_loop
from .health_score import compute_health_score, health_breakdown
from .models import Project, Run, RunAssertion, RunMetric
from .rate_limit import auth_limiter, read_limiter, write_limiter
from .routers import auth_routes, users, benchmarks, webhooks, admin, team
from .routers.notes import run_notes_router, notes_router
from .routers import run_metrics as run_metrics_router
from .routers import sweeps as sweeps_router
from .routers import estimator as estimator_router
from .routers import assertions as assertions_router
from .routers import shadow as shadow_router
from .routers import rca as rca_router
from .routers import error_budget as error_budget_router
from .routers import robustness as robustness_router
from .routers import quantum_volume as quantum_volume_router
from .routers import citations as citations_router
from .routers import convergence as convergence_router
from .routers import mitigation as mitigation_router
from .routers import policy as policy_router
from .routers import anomaly as anomaly_router
from .routers import circuit_diff as circuit_diff_router
from .routers import qubit_map as qubit_map_router
from .routers import landscape as landscape_router
from .routers import health_trend as health_trend_router
from .routers import insights as insights_router
from .routers import hardware_rec as hardware_rec_router
from .routers import stats_compare as stats_compare_router
from .routers import pub_report as pub_report_router
from .routers import paper_package as paper_package_router
from .routers import campaigns as campaigns_router
from .routers import ask as ask_router
from .routers import noise_sim as noise_sim_router
from .routers import alerts as alerts_router
from .routers import circuit_search as circuit_search_router
from .routers import fulltext_search as fulltext_search_router
from .routers import dispatch as dispatch_router
from .routers import cal_forecast as cal_forecast_router
from .routers import zx_simplify as zx_simplify_router
from .routers import shadow_tomo as shadow_tomo_router
from .routers import magic as magic_router
from .routers import circuit_topology as circuit_topology_router
from .routers import cal_network as cal_network_router
from .routers import pauli_noise as pauli_noise_router
from .routers import ansatz_discovery as ansatz_discovery_router
from .routers import advantage_oracle as advantage_oracle_router
from .routers import drift_changepoint as drift_changepoint_router
from .routers import transfer_prediction as transfer_prediction_router
from .routers import nlq_retrieval as nlq_retrieval_router
from .routers import evo_optimizer as evo_optimizer_router
from .routers import bug_database as bug_database_router
from .routers import repro_score as repro_score_router
from .routers import passive_rb as passive_rb_router
from .routers import experiment_design as experiment_design_router
from .routers import device_fingerprint as device_fingerprint_router
from .routers import hamiltonian_learning as hamiltonian_learning_router
from .routers import entanglement_cert as entanglement_cert_router
from .routers import milestone_predict as milestone_predict_router
from .routers import causal_discovery as causal_discovery_router
from .routers import qoe_telemetry as qoe_telemetry_router
from .routers import uaf_cpt as uaf_cpt_router
from .routers import aemd as aemd_router
from .routers import costs as costs_router
from .routers import ci_regression as ci_regression_router
from .routers import feedback as feedback_router
from .routers import job_executor as job_executor_router
from .routers import job_router as job_router_router
from .routers import circuit_compiler as circuit_compiler_router
from .routers import provider_ingest as provider_ingest_router
from .routers import state_tomo as state_tomo_router
from .routers import vqe_tracker as vqe_tracker_router
from .routers import cost_tracker as cost_tracker_router
from .routers import rbac as rbac_router
from .routers import cicd as cicd_router
from .routers import circuit_versioning as circuit_versioning_router
from .routers import zne_pec as zne_pec_router
from .routers import credentials as credentials_router
from .routers import notifications as notifications_router
from .routers import qv_runner as qv_runner_router
from .routers import gate_char as gate_char_router
from .routers import circuit_templates as circuit_templates_router
from .routers import export_data as export_data_router
from .routers import queue_intel as queue_intel_router
from .routers import decoherence_alerts as decoherence_alerts_router
from .routers import cross_backend as cross_backend_router
from .routers import circuit_evolver as circuit_evolver_router
from .routers import health_forecast as health_forecast_router
from .routers import advantage as advantage_router
from .routers import circuit_analyzer as circuit_analyzer_router
from .routers import fault_injector as fault_injector_router
from .routers import quantum_rng as quantum_rng_router
from .routers import reproducibility as reproducibility_router
from .routers import transpiler as transpiler_router
from .routers import recommender as recommender_router
from .routers import circuit_dna as circuit_dna_router
from .routers import density_matrix as density_matrix_router
from .routers import qec_synthesizer as qec_synthesizer_router
from .routers import vqe_landscape as vqe_landscape_router
from .routers import entanglement_map as entanglement_map_router
from .routers import clifford_t as clifford_t_router
from .routers import ensemble_runner as ensemble_runner_router
from .routers import circuit_embed as circuit_embed_router
from .routers import noise_router as noise_router_router
from .routers import nl2qasm as nl2qasm_router
from .routers import qvbench as qvbench_router
from .routers import error_mitigate as error_mitigate_router
from .routers import unitary_synth as unitary_synth_router
from .routers import rb_suite as rb_suite_router
from .routers import optimizer_hub as optimizer_hub_router
from .routers import quantum_chem as quantum_chem_router
from .routers import clifford_sim as clifford_sim_router
from .routers import syndrome_decoder as syndrome_decoder_router
from .routers import tensor_network as tensor_network_router
from .routers import speedup_certifier as speedup_certifier_router
from .routers import complexity_analyzer as complexity_analyzer_router
from .routers import qml_workbench as qml_workbench_router
from .routers import hamiltonian_studio as hamiltonian_studio_router
from .routers import figure_gen as figure_gen_router
from .routers import hypothesis_engine as hypothesis_engine_router
from .routers import protocol_sim as protocol_sim_router
from .routers import quantum_network as quantum_network_router
from .routers import arxiv_search as arxiv_search_router
from .routers import literature as literature_router
from .routers import advantage_timeline as advantage_timeline_router
from .routers import gate_tomo as gate_tomo_router
from .routers import collab_notebook as collab_notebook_router
from .routers import circuit_debugger as circuit_debugger_router
from .routers import hardware_jobs as hardware_jobs_router
from .routers import resource_estimator as resource_estimator_router
from .routers import trotter_evolution as trotter_evolution_router
from .routers import code_exporter as code_exporter_router
from .routers import xeb as xeb_router
from .routers import quantum_finance as quantum_finance_router
from .routers import mirror_circuit as mirror_circuit_router
from .routers import channel_capacity as channel_capacity_router
from .routers import arxiv_feed as arxiv_feed_router
from .routers import circuit_knitting as circuit_knitting_router
from .routers import noise_model_builder as noise_model_builder_router
from .routers import qaoa_solver as qaoa_solver_router
from .routers import quantum_sensing as quantum_sensing_router
from .routers import bloch_animator as bloch_animator_router
from .routers import providers as providers_router
from .routers import environment_snapshot as environment_snapshot_router
from .routers import hypotheses as hypotheses_router
from .routers import circuit_ancestry as circuit_ancestry_router
from .routers import methods_gen as methods_gen_router
from .routers import cost_oracle as cost_oracle_router
from .routers import calibration_oracle as calibration_oracle_router
from .routers import experiment_registry as experiment_registry_router
from .routers import cross_bench as cross_bench_router
from .routers import noise_marketplace as noise_marketplace_router
from .routers import bayes_opt as bayes_opt_router
from .routers import research_graph as research_graph_router
from .routers import challenges as challenges_router
from .routers import copilot as copilot_router
from .routers import stats_engine as stats_engine_router
from .routers import autopilot as autopilot_router
from .routers import tomography as tomography_router
from .routers import zne_pec as zne_pec_router
from .routers import error_budget as error_budget_router
from .routers import dd_optimizer as dd_optimizer_router
from .routers import peer_review as peer_review_router
from .routers import replication as replication_router
from .routers import collab as collab_router
from .routers import cal_forecast as cal_forecast_router
from .routers import backend_emulator as backend_emulator_router
from .routers import job_scheduler as job_scheduler_router
from .routers import paper_draft as paper_draft_router
from .routers import arxiv_radar as arxiv_radar_router
from .routers import qfm as qfm_router
from .routers import auto_mitigation as auto_mitigation_router
from .routers import anomaly_physics as anomaly_physics_router
from .routers import circuit_ai as circuit_ai_router
from .routers import global_cal as global_cal_router
from .routers import benchmark_leaderboard as benchmark_leaderboard_router
from .routers import social as social_router
from .routers import paper_replication as paper_replication_router
from .routers import bayes_uncertainty as bayes_uncertainty_router
from .routers import multi_comparisons as multi_comparisons_router
from .routers import fair_data as fair_data_router
from .routers import causal as causal_router
from .routers import research_pipeline as research_pipeline_router
from .routers import grant_proposal as grant_proposal_router
from .routers import rb_gst as rb_gst_router
from .routers import transpiler_hub as transpiler_hub_router
from .routers import hpc_bridge as hpc_bridge_router
from .routers import circuit_marketplace as circuit_marketplace_router
from .routers import institute as institute_router
from .routers import offline_export as offline_export_router
from .routers import pulse_control as pulse_control_router
from .routers import blind_analysis as blind_analysis_router
from .routers import oed as oed_router
from .routers import meta_analysis as meta_analysis_router
from .routers import dataset_publish as dataset_publish_router
from .routers import rl_optimizer as rl_optimizer_router
from .routers import synthetic_data as synthetic_data_router
from .routers import live_monitor as live_monitor_router
from .routers import cost_arbitrage as cost_arbitrage_router
from .routers import process_tomo as process_tomo_router
from .routers import conference as conference_router
from .routers import learn as learn_router
from .routers import talent as talent_router
from .routers import github_ci as github_ci_router
from .routers import certify as certify_router
from .routers import spectral_noise as spectral_noise_router
from .routers import lab_inventory as lab_inventory_router
from .routers import qml_datasets as qml_datasets_router
from .routers import quantum_internet as quantum_internet_router
from .routers import collab_notebook as collab_notebook_router
from .routers import federated as federated_router
from .routers import plugins as plugins_router
from .routers import doi as doi_router
from .routers import orcid as orcid_router
from .routers import grants as grants_router
from .routers import preregistration as preregistration_router
from .routers import hardware_drift as hardware_drift_router
from .routers import templates as templates_router
from .routers import circuit_designer as circuit_designer_router
from .routers import lab_assistant as lab_assistant_router
from .routers import outcome_predictor as outcome_predictor_router
from .routers import timing_advisor as timing_advisor_router
from .routers import shot_calculator as shot_calculator_router
from .routers import github_integration as github_integration_router
from .routers import slack_bot as slack_bot_router
from .routers import fair as fair_router
from .routers import carbon as carbon_router
from .routers import researcher_profiles as researcher_profiles_router
from .routers import gdpr as gdpr_router
from .routers import departments as departments_router
from .routers import institute_admin as institute_admin_router
from .routers import billing as billing_router
from .routers import sdk_compat as sdk_compat_router
from .tasks import deliver_webhooks

app = FastAPI(
    title="Q-Lab API",
    version="1.0.0",
    description="Quantum Systems of Record — professional experiment tracking for quantum researchers.",
)

# ------------------------------------------------------------------
# Routers
# ------------------------------------------------------------------
app.include_router(auth_routes.router)
app.include_router(users.router)
app.include_router(benchmarks.router)
app.include_router(webhooks.router)
app.include_router(admin.router)
app.include_router(team.router)
app.include_router(run_notes_router)
app.include_router(notes_router)
app.include_router(run_metrics_router.router)
app.include_router(sweeps_router.router)
app.include_router(estimator_router.router)
app.include_router(assertions_router.router)
app.include_router(shadow_router.router)
app.include_router(rca_router.router)
app.include_router(error_budget_router.router)
app.include_router(robustness_router.router)
app.include_router(quantum_volume_router.router)
app.include_router(citations_router.router)
app.include_router(convergence_router.router)
app.include_router(mitigation_router.router)
app.include_router(policy_router.router)
app.include_router(anomaly_router.router)
app.include_router(circuit_diff_router.router)
app.include_router(qubit_map_router.router)
app.include_router(landscape_router.router)
app.include_router(health_trend_router.router)
app.include_router(insights_router.router)
app.include_router(hardware_rec_router.router)
app.include_router(stats_compare_router.router)
app.include_router(pub_report_router.router)
app.include_router(paper_package_router.router)
app.include_router(campaigns_router.router)
app.include_router(ask_router.router)
app.include_router(noise_sim_router.router)
app.include_router(alerts_router.router)
app.include_router(circuit_search_router.router)
app.include_router(fulltext_search_router.router)
app.include_router(dispatch_router.router)
app.include_router(cal_forecast_router.router)
app.include_router(zx_simplify_router.router)
app.include_router(shadow_tomo_router.router)
app.include_router(magic_router.router)
app.include_router(circuit_topology_router.router)
app.include_router(cal_network_router.router)
app.include_router(pauli_noise_router.router)
app.include_router(ansatz_discovery_router.router)
app.include_router(advantage_oracle_router.router)
app.include_router(drift_changepoint_router.router)
app.include_router(transfer_prediction_router.router)
app.include_router(nlq_retrieval_router.router)
app.include_router(evo_optimizer_router.router)
app.include_router(bug_database_router.router)
app.include_router(repro_score_router.router)
app.include_router(passive_rb_router.router)
app.include_router(experiment_design_router.router)
app.include_router(device_fingerprint_router.router)
app.include_router(hamiltonian_learning_router.router)
app.include_router(entanglement_cert_router.router)
app.include_router(milestone_predict_router.router)
app.include_router(causal_discovery_router.router)
app.include_router(qoe_telemetry_router.router)
app.include_router(uaf_cpt_router.router)
app.include_router(aemd_router.router)
app.include_router(costs_router.router)
app.include_router(ci_regression_router.router)
app.include_router(feedback_router.router)
app.include_router(job_executor_router.router)
app.include_router(job_router_router.router)
app.include_router(circuit_compiler_router.router)
app.include_router(provider_ingest_router.router)
app.include_router(state_tomo_router.router)
app.include_router(vqe_tracker_router.router)
app.include_router(cost_tracker_router.router)
app.include_router(rbac_router.router)
app.include_router(cicd_router.router)
app.include_router(circuit_versioning_router.router)
app.include_router(zne_pec_router.router)
app.include_router(credentials_router.router)
app.include_router(notifications_router.router)
app.include_router(qv_runner_router.router)
app.include_router(gate_char_router.router)
app.include_router(circuit_templates_router.router)
app.include_router(export_data_router.router)
app.include_router(queue_intel_router.router)
app.include_router(decoherence_alerts_router.router)
app.include_router(cross_backend_router.router)
app.include_router(circuit_evolver_router.router)
app.include_router(health_forecast_router.router)
app.include_router(advantage_router.router)
app.include_router(circuit_analyzer_router.router)
app.include_router(fault_injector_router.router)
app.include_router(quantum_rng_router.router)
app.include_router(reproducibility_router.router)
app.include_router(transpiler_router.router)
app.include_router(recommender_router.router)
app.include_router(circuit_dna_router.router)
app.include_router(density_matrix_router.router)
app.include_router(qec_synthesizer_router.router)
app.include_router(vqe_landscape_router.router)
app.include_router(entanglement_map_router.router)
app.include_router(clifford_t_router.router)
app.include_router(ensemble_runner_router.router)
app.include_router(circuit_embed_router.router)
app.include_router(noise_router_router.router)
app.include_router(nl2qasm_router.router)
app.include_router(qvbench_router.router)
app.include_router(error_mitigate_router.router)
app.include_router(unitary_synth_router.router)
app.include_router(rb_suite_router.router)
app.include_router(optimizer_hub_router.router)
app.include_router(quantum_chem_router.router)
app.include_router(clifford_sim_router.router)
app.include_router(syndrome_decoder_router.router)
app.include_router(tensor_network_router.router)
app.include_router(speedup_certifier_router.router)
app.include_router(complexity_analyzer_router.router)
app.include_router(qml_workbench_router.router)
app.include_router(hamiltonian_studio_router.router)
app.include_router(figure_gen_router.router)
app.include_router(hypothesis_engine_router.router)
app.include_router(protocol_sim_router.router)
app.include_router(quantum_network_router.router)
app.include_router(arxiv_search_router.router)
app.include_router(literature_router.router)
app.include_router(advantage_timeline_router.router)
app.include_router(gate_tomo_router.router)
app.include_router(collab_notebook_router.router)
app.include_router(circuit_debugger_router.router)
app.include_router(hardware_jobs_router.router)
app.include_router(resource_estimator_router.router)
app.include_router(trotter_evolution_router.router)
app.include_router(code_exporter_router.router)
app.include_router(xeb_router.router)
app.include_router(quantum_finance_router.router)
app.include_router(mirror_circuit_router.router)
app.include_router(channel_capacity_router.router)
app.include_router(arxiv_feed_router.router)
app.include_router(circuit_knitting_router.router)
app.include_router(noise_model_builder_router.router)
app.include_router(qaoa_solver_router.router)
app.include_router(quantum_sensing_router.router)
app.include_router(bloch_animator_router.router)
app.include_router(providers_router.router)
app.include_router(environment_snapshot_router.router)
app.include_router(hypotheses_router.router)
app.include_router(circuit_ancestry_router.router)
app.include_router(methods_gen_router.router)
app.include_router(cost_oracle_router.router)
app.include_router(calibration_oracle_router.router)
app.include_router(experiment_registry_router.router)
app.include_router(cross_bench_router.router)
app.include_router(noise_marketplace_router.router)
app.include_router(bayes_opt_router.router)
app.include_router(research_graph_router.router)
app.include_router(challenges_router.router)
app.include_router(copilot_router.router)
app.include_router(stats_engine_router.router)
app.include_router(autopilot_router.router)
app.include_router(tomography_router.router)
app.include_router(zne_pec_router.router)
app.include_router(error_budget_router.router)
app.include_router(dd_optimizer_router.router)
app.include_router(peer_review_router.router)
app.include_router(replication_router.router)
app.include_router(collab_router.router)
app.include_router(cal_forecast_router.router)
app.include_router(backend_emulator_router.router)
app.include_router(job_scheduler_router.router)
app.include_router(paper_draft_router.router)
app.include_router(arxiv_radar_router.router)
app.include_router(qfm_router.router)
app.include_router(auto_mitigation_router.router)
app.include_router(anomaly_physics_router.router)
app.include_router(circuit_ai_router.router)
app.include_router(global_cal_router.router)
app.include_router(benchmark_leaderboard_router.router)
app.include_router(social_router.router)
app.include_router(paper_replication_router.router)
app.include_router(bayes_uncertainty_router.router)
app.include_router(multi_comparisons_router.router)
app.include_router(fair_data_router.router)
app.include_router(causal_router.router)
app.include_router(research_pipeline_router.router)
app.include_router(grant_proposal_router.router)
app.include_router(rb_gst_router.router)
app.include_router(transpiler_hub_router.router)
app.include_router(hpc_bridge_router.router)
app.include_router(circuit_marketplace_router.router)
app.include_router(institute_router.router)
app.include_router(offline_export_router.router)
app.include_router(pulse_control_router.router)
app.include_router(blind_analysis_router.router)
app.include_router(oed_router.router)
app.include_router(meta_analysis_router.router)
app.include_router(dataset_publish_router.router)
app.include_router(rl_optimizer_router.router)
app.include_router(synthetic_data_router.router)
app.include_router(live_monitor_router.router)
app.include_router(cost_arbitrage_router.router)
app.include_router(process_tomo_router.router)
app.include_router(conference_router.router)
app.include_router(learn_router.router)
app.include_router(talent_router.router)
app.include_router(github_ci_router.router)
app.include_router(certify_router.router)
app.include_router(spectral_noise_router.router)
app.include_router(lab_inventory_router.router)
app.include_router(qml_datasets_router.router)
app.include_router(quantum_internet_router.router)
app.include_router(collab_notebook_router.router)
app.include_router(federated_router.router)
app.include_router(plugins_router.router)
app.include_router(doi_router.router)
app.include_router(orcid_router.router)
app.include_router(grants_router.router)
app.include_router(preregistration_router.router)
app.include_router(hardware_drift_router.router)
app.include_router(templates_router.router)
app.include_router(circuit_designer_router.router)
app.include_router(lab_assistant_router.router)
app.include_router(outcome_predictor_router.router)
app.include_router(timing_advisor_router.router)
app.include_router(shot_calculator_router.router)
app.include_router(github_integration_router.router)
app.include_router(slack_bot_router.router)
app.include_router(fair_router.router)
app.include_router(carbon_router.router)
app.include_router(researcher_profiles_router.router)
app.include_router(gdpr_router.router)
app.include_router(departments_router.router)
app.include_router(institute_admin_router.router)
app.include_router(billing_router.router)
app.include_router(sdk_compat_router.router)

LEGACY_RUNS_FILE = DATA_DIR / "runs.json"
BACKEND_STATIC_DIR = Path(__file__).resolve().parents[1] / "static"
FRONTEND_STATIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "static"

if BACKEND_STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=BACKEND_STATIC_DIR, html=True), name="static")

if FRONTEND_STATIC_DIR.exists():
    app.mount("/ui", StaticFiles(directory=FRONTEND_STATIC_DIR, html=True), name="ui")


# ------------------------------------------------------------------
# Startup
# ------------------------------------------------------------------

@app.on_event("startup")
async def startup() -> None:
    import asyncio
    from sqlalchemy import text
    set_event_loop(asyncio.get_event_loop())
    # Run: alembic upgrade head (for production). init_db() used for development/testing.
    init_db()
    # Add new columns that may not exist in existing databases
    from .database import engine
    with engine.connect() as conn:
        for stmt in [
            "ALTER TABLE runs ADD COLUMN share_token VARCHAR(64)",
            """CREATE TABLE IF NOT EXISTS run_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id VARCHAR(64) NOT NULL,
                user_id INTEGER REFERENCES users(id),
                content TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_run_notes_run_id ON run_notes(run_id)",
            """CREATE TABLE IF NOT EXISTS run_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id VARCHAR(64) NOT NULL,
                name VARCHAR(200) NOT NULL,
                value REAL NOT NULL,
                step INTEGER,
                logged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_run_metrics_run_id ON run_metrics(run_id)",
            "CREATE INDEX IF NOT EXISTS ix_run_metrics_name ON run_metrics(name)",
            """CREATE TABLE IF NOT EXISTS run_assertions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id VARCHAR(64) NOT NULL,
                label VARCHAR(200),
                assertion_type VARCHAR(64) NOT NULL DEFAULT 'min_prob',
                state VARCHAR(200),
                expected_min REAL,
                expected_max REAL,
                actual_value REAL,
                passed BOOLEAN,
                message VARCHAR(500),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_run_assertions_run_id ON run_assertions(run_id)",
            "ALTER TABLE runs ADD COLUMN shadow_results JSON",
            """CREATE TABLE IF NOT EXISTS run_citations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id VARCHAR(64) NOT NULL,
                arxiv_id VARCHAR(32),
                doi VARCHAR(256),
                title TEXT,
                authors TEXT,
                journal VARCHAR(256),
                year INTEGER,
                note TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_run_citations_run_id ON run_citations(run_id)",
            "CREATE INDEX IF NOT EXISTS ix_run_citations_arxiv ON run_citations(arxiv_id)",
            """CREATE TABLE IF NOT EXISTS qlab_policies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(64) NOT NULL DEFAULT 'default',
                description TEXT,
                rules JSON NOT NULL DEFAULT '{}',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS campaigns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_id VARCHAR(64) NOT NULL UNIQUE,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                project_slug VARCHAR(120),
                org_id INTEGER REFERENCES organizations(id),
                created_by_user_id INTEGER REFERENCES users(id),
                grid_spec JSON NOT NULL DEFAULT '{}',
                tags JSON NOT NULL DEFAULT '[]',
                status VARCHAR(32) NOT NULL DEFAULT 'running',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME
            )""",
            "CREATE INDEX IF NOT EXISTS ix_campaigns_campaign_id ON campaigns(campaign_id)",
            "CREATE INDEX IF NOT EXISTS ix_campaigns_project ON campaigns(project_slug)",
            "CREATE INDEX IF NOT EXISTS ix_campaigns_status ON campaigns(status)",
            """CREATE TABLE IF NOT EXISTS job_submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id VARCHAR(64) NOT NULL UNIQUE,
                provider VARCHAR(32) NOT NULL,
                provider_job_id VARCHAR(256),
                run_id VARCHAR(64),
                qasm TEXT,
                backend VARCHAR(255) NOT NULL,
                shots INTEGER NOT NULL DEFAULT 1024,
                status VARCHAR(32) NOT NULL DEFAULT 'queued',
                created_by_user_id INTEGER REFERENCES users(id),
                org_id INTEGER REFERENCES organizations(id),
                provider_metadata JSON NOT NULL DEFAULT '{}',
                result JSON,
                error_message TEXT,
                cost_credits REAL,
                circuit_name VARCHAR(255),
                project_slug VARCHAR(120),
                submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME
            )""",
            "CREATE INDEX IF NOT EXISTS ix_job_submissions_job_id ON job_submissions(job_id)",
            "CREATE INDEX IF NOT EXISTS ix_job_submissions_status ON job_submissions(status)",
            "CREATE INDEX IF NOT EXISTS ix_job_submissions_provider ON job_submissions(provider)",
            """CREATE TABLE IF NOT EXISTS circuit_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                version_id VARCHAR(64) NOT NULL UNIQUE,
                circuit_family VARCHAR(255) NOT NULL,
                version_num INTEGER NOT NULL DEFAULT 1,
                qasm TEXT NOT NULL,
                parent_version_id VARCHAR(64),
                diff_stats JSON NOT NULL DEFAULT '{}',
                commit_message VARCHAR(500),
                tags JSON NOT NULL DEFAULT '[]',
                project_slug VARCHAR(120),
                created_by_user_id INTEGER REFERENCES users(id),
                org_id INTEGER REFERENCES organizations(id),
                run_ids JSON NOT NULL DEFAULT '[]',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_circuit_versions_family ON circuit_versions(circuit_family)",
            """CREATE TABLE IF NOT EXISTS budget_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                alert_id VARCHAR(64) NOT NULL UNIQUE,
                org_id INTEGER REFERENCES organizations(id),
                name VARCHAR(200) NOT NULL,
                budget_type VARCHAR(32) NOT NULL DEFAULT 'monthly',
                project_slug VARCHAR(120),
                provider VARCHAR(32),
                threshold_credits REAL NOT NULL DEFAULT 100.0,
                alert_at_pct REAL NOT NULL DEFAULT 0.8,
                triggered BOOLEAN NOT NULL DEFAULT 0,
                last_checked_at DATETIME,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS variational_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vrun_id VARCHAR(64) NOT NULL UNIQUE,
                algorithm VARCHAR(32) NOT NULL,
                run_id VARCHAR(64),
                project_slug VARCHAR(120),
                ansatz_type VARCHAR(120),
                n_parameters INTEGER NOT NULL DEFAULT 0,
                n_qubits INTEGER NOT NULL DEFAULT 0,
                hamiltonian_type VARCHAR(120),
                iterations JSON NOT NULL DEFAULT '[]',
                optimal_energy REAL,
                optimal_params JSON NOT NULL DEFAULT '[]',
                convergence_status VARCHAR(32) NOT NULL DEFAULT 'running',
                org_id INTEGER REFERENCES organizations(id),
                created_by_user_id INTEGER REFERENCES users(id),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME
            )""",
            "CREATE INDEX IF NOT EXISTS ix_variational_runs_vrun_id ON variational_runs(vrun_id)",
            """CREATE TABLE IF NOT EXISTS cicd_integrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                integration_id VARCHAR(64) NOT NULL UNIQUE,
                org_id INTEGER REFERENCES organizations(id),
                name VARCHAR(200) NOT NULL,
                provider VARCHAR(32) NOT NULL DEFAULT 'github',
                repo_url VARCHAR(500) NOT NULL,
                webhook_secret VARCHAR(256) NOT NULL,
                project_slug VARCHAR(120),
                baseline_run_id VARCHAR(64),
                auto_fail_threshold REAL NOT NULL DEFAULT 10.0,
                checks JSON NOT NULL DEFAULT '[]',
                is_active BOOLEAN NOT NULL DEFAULT 1,
                last_triggered_at DATETIME,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS cicd_checks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                check_id VARCHAR(64) NOT NULL UNIQUE,
                integration_id VARCHAR(64) NOT NULL,
                commit_sha VARCHAR(64) NOT NULL,
                branch VARCHAR(255),
                status VARCHAR(32) NOT NULL DEFAULT 'pending',
                results JSON NOT NULL DEFAULT '{}',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME
            )""",
            "CREATE INDEX IF NOT EXISTS ix_cicd_checks_integration ON cicd_checks(integration_id)",
            """CREATE TABLE IF NOT EXISTS tomography_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tomo_id VARCHAR(64) NOT NULL UNIQUE,
                run_id VARCHAR(64) NOT NULL,
                n_qubits INTEGER NOT NULL,
                basis_measurements JSON NOT NULL DEFAULT '{}',
                density_matrix_re JSON NOT NULL DEFAULT '[]',
                density_matrix_im JSON NOT NULL DEFAULT '[]',
                purity REAL,
                fidelity_to_ideal REAL,
                ideal_state VARCHAR(64),
                pauli_expectations JSON NOT NULL DEFAULT '{}',
                status VARCHAR(32) NOT NULL DEFAULT 'complete',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_tomography_jobs_run_id ON tomography_jobs(run_id)",
            """CREATE TABLE IF NOT EXISTS api_credentials (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cred_id VARCHAR(64) NOT NULL UNIQUE,
                org_id INTEGER REFERENCES organizations(id),
                created_by_user_id INTEGER REFERENCES users(id),
                provider VARCHAR(32) NOT NULL,
                label VARCHAR(200) NOT NULL,
                encrypted_key TEXT NOT NULL,
                key_hint VARCHAR(12) NOT NULL DEFAULT '',
                is_active BOOLEAN NOT NULL DEFAULT 1,
                last_used_at DATETIME,
                expires_at DATETIME,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_api_credentials_provider ON api_credentials(provider)",
            """CREATE TABLE IF NOT EXISTS notification_channels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id VARCHAR(64) NOT NULL UNIQUE,
                org_id INTEGER REFERENCES organizations(id),
                name VARCHAR(200) NOT NULL,
                channel_type VARCHAR(32) NOT NULL,
                config JSON NOT NULL DEFAULT '{}',
                events JSON NOT NULL DEFAULT '[]',
                is_active BOOLEAN NOT NULL DEFAULT 1,
                last_triggered_at DATETIME,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS notification_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id VARCHAR(64) NOT NULL,
                event VARCHAR(120) NOT NULL,
                payload JSON NOT NULL DEFAULT '{}',
                status VARCHAR(32) NOT NULL DEFAULT 'sent',
                error TEXT,
                sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_notification_logs_channel ON notification_logs(channel_id)",
            """CREATE TABLE IF NOT EXISTS qv_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                qv_id VARCHAR(64) NOT NULL UNIQUE,
                backend VARCHAR(255) NOT NULL,
                qv_achieved INTEGER NOT NULL,
                n_qubits_tested INTEGER NOT NULL,
                n_trials INTEGER NOT NULL DEFAULT 100,
                heavy_output_prob REAL NOT NULL,
                pass_threshold REAL NOT NULL DEFAULT 0.6667,
                trial_results JSON NOT NULL DEFAULT '[]',
                job_id VARCHAR(64),
                run_id VARCHAR(64),
                org_id INTEGER REFERENCES organizations(id),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_qv_results_backend ON qv_results(backend)",
            """CREATE TABLE IF NOT EXISTS gate_char_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                char_id VARCHAR(64) NOT NULL UNIQUE,
                backend VARCHAR(255) NOT NULL,
                char_type VARCHAR(32) NOT NULL,
                qubit INTEGER,
                qubit_pair JSON,
                gate VARCHAR(64),
                curve_data JSON NOT NULL DEFAULT '[]',
                fit_params JSON NOT NULL DEFAULT '{}',
                metric_value REAL,
                metric_unit VARCHAR(32),
                run_id VARCHAR(64),
                org_id INTEGER REFERENCES organizations(id),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_gate_char_backend ON gate_char_results(backend)",
            "CREATE INDEX IF NOT EXISTS ix_gate_char_type ON gate_char_results(char_type)",
            """CREATE TABLE IF NOT EXISTS circuit_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                template_id VARCHAR(64) NOT NULL UNIQUE,
                name VARCHAR(200) NOT NULL,
                category VARCHAR(64) NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                qasm TEXT NOT NULL,
                n_qubits INTEGER NOT NULL,
                parameters JSON NOT NULL DEFAULT '[]',
                tags JSON NOT NULL DEFAULT '[]',
                is_builtin BOOLEAN NOT NULL DEFAULT 0,
                org_id INTEGER REFERENCES organizations(id),
                created_by_user_id INTEGER REFERENCES users(id),
                use_count INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_circuit_templates_category ON circuit_templates(category)",
            """CREATE TABLE IF NOT EXISTS decoherence_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                alert_id VARCHAR(64) NOT NULL UNIQUE,
                org_id INTEGER REFERENCES organizations(id),
                backend VARCHAR(255) NOT NULL,
                metric VARCHAR(32) NOT NULL,
                qubit INTEGER,
                threshold REAL NOT NULL,
                condition VARCHAR(16) NOT NULL DEFAULT 'below',
                triggered BOOLEAN NOT NULL DEFAULT 0,
                triggered_at DATETIME,
                last_checked_at DATETIME,
                last_value REAL,
                notification_channel_id VARCHAR(64),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_decoherence_alerts_backend ON decoherence_alerts(backend)",
            """CREATE TABLE IF NOT EXISTS evolution_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id VARCHAR(64) NOT NULL UNIQUE,
                circuit_name VARCHAR(200) NOT NULL DEFAULT '',
                original_qasm TEXT NOT NULL,
                evolved_qasm TEXT NOT NULL,
                best_fitness REAL NOT NULL,
                improvement REAL NOT NULL DEFAULT 0,
                n_generations INTEGER NOT NULL,
                population_size INTEGER NOT NULL,
                fitness_history JSON NOT NULL DEFAULT '[]',
                config JSON NOT NULL DEFAULT '{}',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS health_forecasts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                forecast_id VARCHAR(64) NOT NULL UNIQUE,
                backend VARCHAR(255) NOT NULL,
                metric VARCHAR(32) NOT NULL,
                current_value REAL,
                forecast_24h REAL,
                forecast_48h REAL,
                forecast_72h REAL,
                trend_slope REAL,
                risk_level VARCHAR(16) NOT NULL DEFAULT 'unknown',
                data_points INTEGER NOT NULL DEFAULT 0,
                series JSON NOT NULL DEFAULT '[]',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_health_forecasts_backend ON health_forecasts(backend)",
            """CREATE TABLE IF NOT EXISTS advantage_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                result_id VARCHAR(64) NOT NULL UNIQUE,
                problem_type VARCHAR(64) NOT NULL,
                n_qubits INTEGER NOT NULL,
                quantum_score REAL NOT NULL,
                classical_score REAL NOT NULL,
                advantage_ratio REAL NOT NULL,
                quantum_time_ms REAL NOT NULL,
                classical_time_ms REAL NOT NULL,
                verdict VARCHAR(32) NOT NULL,
                details JSON NOT NULL DEFAULT '{}',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS fault_injection_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                result_id VARCHAR(64) NOT NULL UNIQUE,
                circuit_name VARCHAR(200) NOT NULL DEFAULT '',
                fault_type VARCHAR(32) NOT NULL,
                fault_rate REAL NOT NULL,
                n_trials INTEGER NOT NULL,
                mean_fidelity REAL NOT NULL,
                min_fidelity REAL NOT NULL,
                resilience_score REAL NOT NULL,
                grade VARCHAR(2) NOT NULL,
                trial_results JSON NOT NULL DEFAULT '[]',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS reproducibility_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                result_id VARCHAR(64) NOT NULL UNIQUE,
                original_run_id VARCHAR(64) NOT NULL,
                n_reruns INTEGER NOT NULL,
                mean_tvd REAL NOT NULL,
                std_tvd REAL NOT NULL,
                reproducibility_score REAL NOT NULL,
                grade VARCHAR(2) NOT NULL,
                trial_tvds JSON NOT NULL DEFAULT '[]',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_repro_results_run_id ON reproducibility_results(original_run_id)",
            """CREATE TABLE IF NOT EXISTS circuit_dna (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dna_id VARCHAR(64) NOT NULL UNIQUE,
                dna_hash VARCHAR(64) NOT NULL,
                circuit_name VARCHAR(200) NOT NULL DEFAULT '',
                qasm TEXT NOT NULL,
                distribution_signature JSON NOT NULL DEFAULT '[]',
                n_qubits INTEGER NOT NULL,
                n_gates INTEGER NOT NULL,
                run_id VARCHAR(64),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS ix_circuit_dna_hash ON circuit_dna(dna_hash)",
            """CREATE TABLE IF NOT EXISTS qrng_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                result_id VARCHAR(64) NOT NULL UNIQUE,
                n_bits INTEGER NOT NULL,
                hex_output TEXT NOT NULL,
                chsh_value REAL NOT NULL,
                is_quantum_certified BOOLEAN NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # column already exists
    with SessionLocal() as db:
        _migrate_legacy_runs(db)


# ------------------------------------------------------------------
# Pydantic models
# ------------------------------------------------------------------

class RunPayload(BaseModel):
    run_id: str
    circuit_name: Optional[str] = None
    qasm: Optional[str] = None
    fingerprint: Dict[str, Any] = Field(default_factory=dict)
    context: Dict[str, Any] = Field(default_factory=dict)
    backend: Optional[str] = None
    parameters: Dict[str, Any] = Field(default_factory=dict)
    execution: Dict[str, Any] = Field(default_factory=dict)
    calibration: Dict[str, Any] = Field(default_factory=dict)
    transpiler: Dict[str, Any] = Field(default_factory=dict)
    timing: Dict[str, Any] = Field(default_factory=dict)
    results: Dict[str, Any] = Field(default_factory=dict)
    project: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    status: str = "submitted"
    share_url: Optional[str] = None
    benchmark_id: Optional[str] = None
    created_at: datetime


class ProjectPayload(BaseModel):
    slug: str
    name: Optional[str] = None
    description: Optional[str] = None


class RunUpdatePayload(BaseModel):
    status: Optional[str] = None
    tags: Optional[List[str]] = None
    execution: Dict[str, Any] = Field(default_factory=dict)
    results: Dict[str, Any] = Field(default_factory=dict)
    parameters: Dict[str, Any] = Field(default_factory=dict)
    context: Dict[str, Any] = Field(default_factory=dict)
    timing: Dict[str, Any] = Field(default_factory=dict)


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _run_to_dict(run: Run, include_health: bool = False) -> Dict[str, Any]:
    d: Dict[str, Any] = {
        "run_id": run.run_id,
        "circuit_name": run.circuit_name,
        "qasm": run.qasm,
        "fingerprint": run.fingerprint or {},
        "context": run.context or {},
        "backend": run.backend,
        "parameters": run.parameters or {},
        "execution": run.execution or {},
        "calibration": run.calibration or {},
        "transpiler": run.transpiler or {},
        "timing": run.timing or {},
        "results": run.results or {},
        "project": run.project_slug,
        "tags": run.tags or [],
        "status": run.status,
        "share_url": run.share_url,
        "benchmark_id": run.benchmark_id,
        "org_id": run.org_id,
        "created_by_user_id": run.created_by_user_id,
        "created_at": run.created_at.isoformat(),
        "received_at": run.received_at.isoformat() if run.received_at else None,
        "dashboard_url": f"http://localhost:8000/runs/{run.run_id}",
        "is_shared": bool(run.share_token),
        "share_page_url": f"http://localhost:3000/share/{run.share_token}" if run.share_token else None,
    }
    if include_health:
        d["health_score"] = compute_health_score(d)
    return d


def _get_or_create_project(db: Session, slug: Optional[str]) -> "Project | None":
    if not slug:
        return None
    project = db.scalar(select(Project).where(Project.slug == slug))
    if project:
        return project
    project = Project(slug=slug, name=slug)
    db.add(project)
    db.flush()
    return project


def _find_run(db: Session, run_id: str) -> Run:
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    return run


def _upsert_run(db: Session, payload: RunPayload, identity: Optional[Identity] = None) -> Run:
    project = _get_or_create_project(db, payload.project)
    run = db.scalar(select(Run).where(Run.run_id == payload.run_id))

    if run is None:
        run = Run(run_id=payload.run_id, created_at=payload.created_at)
        db.add(run)

    run.circuit_name = payload.circuit_name
    run.qasm = payload.qasm
    run.fingerprint = payload.fingerprint
    run.context = payload.context
    run.backend = payload.backend
    run.parameters = payload.parameters
    run.execution = payload.execution
    run.calibration = payload.calibration
    run.transpiler = payload.transpiler
    run.timing = payload.timing
    run.results = payload.results
    run.project_slug = payload.project
    run.project = project
    run.tags = payload.tags
    run.status = payload.status
    run.share_url = payload.share_url
    run.benchmark_id = payload.benchmark_id
    run.created_at = payload.created_at
    if identity:
        run.created_by_user_id = identity.user_id
        run.org_id = identity.org_id

    db.commit()
    db.refresh(run)
    return run


def _migrate_legacy_runs(db: Session) -> None:
    if not LEGACY_RUNS_FILE.exists():
        return
    marker = DATA_DIR / "runs.json.migrated"
    if marker.exists():
        return
    try:
        legacy_runs = json.loads(LEGACY_RUNS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return
    for item in legacy_runs:
        try:
            _upsert_run(db, RunPayload(**item))
        except Exception:
            db.rollback()
    marker.write_text(datetime.utcnow().isoformat(), encoding="utf-8")


def _dict_diff(left: Dict, right: Dict) -> Dict:
    diff = {}
    for key in sorted(set(left) | set(right)):
        lv, rv = left.get(key), right.get(key)
        if lv != rv:
            diff[key] = {"left": lv, "right": rv}
    return diff


def _safe_number(value: Any) -> float:
    try:
        return float(value)
    except Exception:
        return 0.0


def _export_filename(prefix: str, suffix: str) -> str:
    return f"{prefix}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}.{suffix}"


def _flatten_run_for_csv(run: Dict[str, Any]) -> Dict[str, Any]:
    fp = run.get("fingerprint") or {}
    ex = run.get("execution") or {}
    res = run.get("results") or {}
    timing = run.get("timing") or {}
    transpiler = run.get("transpiler") or {}
    ts = transpiler.get("settings") or {}
    return {
        "run_id": run.get("run_id"),
        "circuit_name": run.get("circuit_name"),
        "project": run.get("project"),
        "backend": run.get("backend"),
        "status": run.get("status"),
        "benchmark_id": run.get("benchmark_id"),
        "created_at": run.get("created_at"),
        "received_at": run.get("received_at"),
        "num_qubits": fp.get("num_qubits"),
        "num_clbits": fp.get("num_clbits"),
        "depth": fp.get("depth"),
        "size": fp.get("size"),
        "non_clifford_ratio": fp.get("non_clifford_ratio"),
        "job_id": ex.get("job_id"),
        "job_class": ex.get("job_class"),
        "result_status": ex.get("result_status") or ex.get("status"),
        "success_probability": res.get("success_probability"),
        "shots": res.get("shots") or run.get("parameters", {}).get("shots"),
        "has_qasm": bool(run.get("qasm")),
        "has_results": bool(res),
        "has_calibration": bool(run.get("calibration")),
        "health_score": run.get("health_score"),
        "submit_time": timing.get("submit_time"),
        "result_time": timing.get("result_time"),
        "transpile_duration_ms": transpiler.get("duration_ms"),
        "transpile_optimization_level": ts.get("optimization_level"),
        "seed_simulator": run.get("parameters", {}).get("seed_simulator"),
        "seed_transpiler": ts.get("seed_transpiler"),
        "tags": ",".join(run.get("tags") or []),
    }


def _filtered_runs_query(backend=None, status=None, project=None):
    q = select(Run)
    if backend:
        q = q.where(Run.backend == backend)
    if status:
        q = q.where(Run.status == status)
    if project:
        q = q.where(Run.project_slug == project)
    return q


# ------------------------------------------------------------------
# Health
# ------------------------------------------------------------------

@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    run_count = db.scalar(select(func.count()).select_from(Run)) or 0
    project_count = db.scalar(select(func.count()).select_from(Project)) or 0
    from .models import User, Webhook
    user_count = db.scalar(select(func.count()).select_from(User)) or 0
    webhook_count = db.scalar(select(func.count()).select_from(Webhook)) or 0
    return {
        "status": "ok",
        "version": "1.0.0",
        "runs": run_count,
        "projects": project_count,
        "users": user_count,
        "webhooks": webhook_count,
    }


# ------------------------------------------------------------------
# AI usage quota
# ------------------------------------------------------------------
@app.get("/api/v1/ai-usage")
def ai_usage(identity=Depends(require_auth)):
    from .ai_rate_limit import get_ai_usage
    return get_ai_usage(identity.user_id)


# ------------------------------------------------------------------
# Contact form
# ------------------------------------------------------------------
from pydantic import BaseModel as _BaseModel

class _ContactPayload(_BaseModel):
    name: str
    email: str
    message: str

@app.post("/contact")
def contact(payload: _ContactPayload):
    from .email_service import send_contact_email
    send_contact_email(name=payload.name, from_email=payload.email, message=payload.message)
    return {"ok": True}


# ------------------------------------------------------------------
# Real-time SSE feed
# ------------------------------------------------------------------

@app.get("/api/v1/runs/stream")
async def stream_runs(
    project: Optional[str] = None,
    token: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    # Resolve identity from query-param token (EventSource can't send headers)
    org_id: Optional[int] = None
    if token:
        try:
            from .auth import decode_token
            from .models import User
            payload = decode_token(token)
            user = db.scalar(select(User).where(User.id == int(payload["sub"]), User.is_active.is_(True)))
            if user:
                org_id = user.org_id
        except Exception:
            pass
    return StreamingResponse(
        event_stream(filter_project=project, filter_org_id=org_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ------------------------------------------------------------------
# Advanced search
# ------------------------------------------------------------------

@app.get("/api/v1/search/runs", dependencies=[Depends(read_limiter)])
def search_runs(
    q: Optional[str] = Query(default=None, description="Search circuit name or tags"),
    backend: Optional[str] = None,
    status: Optional[str] = None,
    project: Optional[str] = None,
    min_qubits: Optional[int] = Query(default=None, ge=0),
    max_qubits: Optional[int] = Query(default=None, ge=0),
    min_depth: Optional[int] = Query(default=None, ge=0),
    max_depth: Optional[int] = Query(default=None, ge=0),
    has_results: Optional[bool] = None,
    has_calibration: Optional[bool] = None,
    benchmark_id: Optional[str] = None,
    tags: Optional[str] = Query(default=None, description="Comma-separated tags"),
    created_after: Optional[datetime] = None,
    created_before: Optional[datetime] = None,
    sort_by: str = Query(default="created_at", enum=["created_at", "depth", "num_qubits"]),
    sort_order: str = Query(default="desc", enum=["asc", "desc"]),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    identity: Optional[Identity] = Depends(get_identity),
    db: Session = Depends(get_db),
):
    query = select(Run)
    if identity and identity.org_id:
        query = query.where(Run.org_id == identity.org_id)

    if backend:
        query = query.where(Run.backend == backend)
    if status:
        query = query.where(Run.status == status)
    if project:
        query = query.where(Run.project_slug == project)
    if benchmark_id:
        query = query.where(Run.benchmark_id == benchmark_id)
    if created_after:
        query = query.where(Run.created_at >= created_after)
    if created_before:
        query = query.where(Run.created_at <= created_before)

    # Sort by indexed column
    sort_col = Run.created_at
    query = query.order_by(sort_col.desc() if sort_order == "desc" else sort_col.asc())

    # Fetch all matching (SQL-filtered) before JSON-field filtering
    runs = db.scalars(query).all()
    serialized = [_run_to_dict(run, include_health=True) for run in runs]

    # Python-side JSON-field filters
    if q:
        ql = q.lower()
        serialized = [
            r for r in serialized
            if ql in (r.get("circuit_name") or "").lower()
            or any(ql in t.lower() for t in (r.get("tags") or []))
        ]
    if min_qubits is not None:
        serialized = [r for r in serialized if (r.get("fingerprint") or {}).get("num_qubits", 0) >= min_qubits]
    if max_qubits is not None:
        serialized = [r for r in serialized if (r.get("fingerprint") or {}).get("num_qubits", 0) <= max_qubits]
    if min_depth is not None:
        serialized = [r for r in serialized if (r.get("fingerprint") or {}).get("depth", 0) >= min_depth]
    if max_depth is not None:
        serialized = [r for r in serialized if (r.get("fingerprint") or {}).get("depth", 0) <= max_depth]
    if has_results is True:
        serialized = [r for r in serialized if r.get("results")]
    elif has_results is False:
        serialized = [r for r in serialized if not r.get("results")]
    if has_calibration is True:
        serialized = [r for r in serialized if r.get("calibration")]
    elif has_calibration is False:
        serialized = [r for r in serialized if not r.get("calibration")]
    if tags:
        tag_set = {t.strip() for t in tags.split(",") if t.strip()}
        serialized = [r for r in serialized if tag_set & set(r.get("tags") or [])]

    # Sort by JSON field if requested
    if sort_by == "depth":
        serialized.sort(key=lambda r: (r.get("fingerprint") or {}).get("depth", 0), reverse=(sort_order == "desc"))
    elif sort_by == "num_qubits":
        serialized.sort(key=lambda r: (r.get("fingerprint") or {}).get("num_qubits", 0), reverse=(sort_order == "desc"))

    total = len(serialized)
    offset = (page - 1) * page_size
    page_items = serialized[offset : offset + page_size]

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
        "items": page_items,
    }


# ------------------------------------------------------------------
# Projects
# ------------------------------------------------------------------

@app.post("/api/v1/projects")
def create_project(
    payload: ProjectPayload,
    identity: Optional[Identity] = Depends(get_identity),
    db: Session = Depends(get_db),
):
    project = db.scalar(select(Project).where(Project.slug == payload.slug))
    if project is None:
        project = Project(slug=payload.slug, name=payload.name or payload.slug, description=payload.description)
        db.add(project)
    else:
        project.name = payload.name or project.name
        project.description = payload.description
    db.commit()
    db.refresh(project)
    return {
        "slug": project.slug,
        "name": project.name,
        "description": project.description,
        "created_at": project.created_at.isoformat(),
    }


@app.get("/api/v1/projects/{slug}/stats")
def project_stats(slug: str, db: Session = Depends(get_db)):
    from .health_score import compute_health_score
    project = db.scalar(select(Project).where(Project.slug == slug))
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    runs = db.scalars(
        select(Run).where(Run.project_slug == slug).order_by(Run.created_at.asc())
    ).all()
    if not runs:
        return {
            "slug": slug, "name": project.name, "description": project.description,
            "created_at": project.created_at.isoformat(), "total_runs": 0,
            "by_status": {}, "by_backend": {}, "health_scores": [], "timeline": [],
        }

    by_status: dict[str, int] = {}
    by_backend: dict[str, int] = {}
    health_scores = []
    timeline = []

    for r in runs:
        by_status[r.status] = by_status.get(r.status, 0) + 1
        by_backend[r.backend or "unknown"] = by_backend.get(r.backend or "unknown", 0) + 1
        rd = _run_to_dict(r, include_health=True)
        hs = rd.get("health_score")
        if hs is not None:
            health_scores.append(hs)
        timeline.append({
            "run_id": r.run_id,
            "circuit_name": r.circuit_name,
            "backend": r.backend,
            "status": r.status,
            "created_at": r.created_at.isoformat(),
            "depth": (r.fingerprint or {}).get("depth"),
            "num_qubits": (r.fingerprint or {}).get("num_qubits"),
            "health_score": hs,
        })

    completed = by_status.get("completed", 0)
    total = len(runs)
    return {
        "slug": slug,
        "name": project.name,
        "description": project.description,
        "created_at": project.created_at.isoformat(),
        "total_runs": total,
        "completion_rate": completed / total if total else 0.0,
        "by_status": by_status,
        "by_backend": by_backend,
        "avg_health": round(sum(health_scores) / len(health_scores), 1) if health_scores else None,
        "max_health": max(health_scores) if health_scores else None,
        "min_health": min(health_scores) if health_scores else None,
        "timeline": timeline,
    }


@app.get("/api/v1/projects")
def list_projects(db: Session = Depends(get_db)):
    projects = db.scalars(select(Project).order_by(Project.slug)).all()
    return [
        {
            "slug": p.slug,
            "name": p.name,
            "description": p.description,
            "created_at": p.created_at.isoformat(),
            "run_count": db.scalar(select(func.count()).select_from(Run).where(Run.project_slug == p.slug)) or 0,
        }
        for p in projects
    ]


# ------------------------------------------------------------------
# Runs — CRUD
# ------------------------------------------------------------------

@app.post("/api/v1/runs", dependencies=[Depends(write_limiter)])
def create_run(
    payload: RunPayload,
    request: Request,
    background_tasks: BackgroundTasks,
    identity: Optional[Identity] = Depends(get_identity),
    db: Session = Depends(get_db),
):
    run = _upsert_run(db, payload, identity)
    run_dict = _run_to_dict(run, include_health=True)

    # Real-time SSE
    publish_sync("run.created", run_dict)

    # Webhooks
    background_tasks.add_task(deliver_webhooks, run_dict, "run.created")

    # Audit
    log_audit(db, "run.created", "run", run.run_id, identity=identity, request=request)

    return {"status": "received", "run_id": run.run_id, "dashboard_url": run_dict["dashboard_url"]}


@app.get("/api/v1/runs", dependencies=[Depends(read_limiter)])
def list_runs(
    backend: Optional[str] = None,
    status: Optional[str] = None,
    project: Optional[str] = None,
    benchmark_id: Optional[str] = None,
    min_qubits: Optional[int] = Query(default=None, ge=0),
    max_qubits: Optional[int] = Query(default=None, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    identity: Optional[Identity] = Depends(get_identity),
    db: Session = Depends(get_db),
):
    query = _filtered_runs_query(backend=backend, status=status, project=project)
    if identity and identity.org_id:
        query = query.where(Run.org_id == identity.org_id)
    if benchmark_id:
        query = query.where(Run.benchmark_id == benchmark_id)
    runs = db.scalars(query.order_by(Run.created_at.desc()).limit(limit * 4)).all()
    serialized = [_run_to_dict(r, include_health=True) for r in runs]

    if min_qubits is not None:
        serialized = [r for r in serialized if (r["fingerprint"].get("num_qubits") or 0) >= min_qubits]
    if max_qubits is not None:
        serialized = [r for r in serialized if (r["fingerprint"].get("num_qubits") or 0) <= max_qubits]

    return serialized[:limit]


@app.get("/api/v1/runs/{run_id}")
def get_run(run_id: str, identity: Optional[Identity] = Depends(get_identity), db: Session = Depends(get_db)):
    run = _find_run(db, run_id)
    if identity and identity.org_id and run.org_id and run.org_id != identity.org_id:
        raise HTTPException(status_code=403, detail="Access denied")
    d = _run_to_dict(run, include_health=True)
    d["health_breakdown"] = health_breakdown(d)
    return d


@app.patch("/api/v1/runs/{run_id}")
def update_run(
    run_id: str,
    payload: RunUpdatePayload,
    request: Request,
    background_tasks: BackgroundTasks,
    identity: Optional[Identity] = Depends(get_identity),
    db: Session = Depends(get_db),
):
    run = _find_run(db, run_id)

    if payload.status is not None:
        run.status = payload.status
    if payload.tags is not None:
        run.tags = payload.tags
    if payload.execution:
        run.execution = {**(run.execution or {}), **payload.execution}
    if payload.results:
        run.results = {**(run.results or {}), **payload.results}
    if payload.parameters:
        run.parameters = {**(run.parameters or {}), **payload.parameters}
    if payload.context:
        run.context = {**(run.context or {}), **payload.context}
    if payload.timing:
        run.timing = {**(run.timing or {}), **payload.timing}

    db.commit()
    db.refresh(run)
    run_dict = _run_to_dict(run, include_health=True)

    publish_sync("run.updated", run_dict)

    if payload.status in ("completed", "failed"):
        event = f"run.{payload.status}"
        background_tasks.add_task(deliver_webhooks, run_dict, event)
        log_audit(db, event, "run", run_id, identity=identity, request=request)

    return run_dict


@app.delete("/api/v1/runs/{run_id}")
def delete_run(
    run_id: str,
    request: Request,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    run = _find_run(db, run_id)
    db.delete(run)
    db.commit()
    log_audit(db, "run.deleted", "run", run_id, identity=identity, request=request)
    return {"deleted": True, "run_id": run_id}


@app.get("/api/v1/runs/{run_id}/health")
def get_run_health(run_id: str, db: Session = Depends(get_db)):
    run = _find_run(db, run_id)
    d = _run_to_dict(run)
    return health_breakdown(d)


@app.get("/api/v1/runs/{run_id}/qasm", response_class=PlainTextResponse)
def download_qasm(run_id: str, db: Session = Depends(get_db)):
    run = _find_run(db, run_id)
    if not run.qasm:
        raise HTTPException(status_code=404, detail="QASM not available")
    return run.qasm


@app.get("/api/v1/runs/{run_id}/circuit.svg")
def circuit_svg(run_id: str, db: Session = Depends(get_db)):
    run = _find_run(db, run_id)
    if not run.qasm:
        raise HTTPException(status_code=404, detail="No QASM stored for this run")
    try:
        from .circuit_renderer import render_qasm_svg
        svg_bytes = render_qasm_svg(run_id, run.qasm)
        return Response(content=svg_bytes, media_type="image/svg+xml",
                        headers={"Cache-Control": "public, max-age=3600"})
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not render circuit: {exc}")


@app.get("/api/v1/runs/{run_id}/circuit.txt", response_class=PlainTextResponse)
def circuit_text(run_id: str, db: Session = Depends(get_db)):
    run = _find_run(db, run_id)
    if not run.qasm:
        raise HTTPException(status_code=404, detail="No QASM stored for this run")
    try:
        from .circuit_renderer import render_qasm_text
        return render_qasm_text(run.qasm)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not render circuit: {exc}")


@app.get("/api/v1/runs/{run_id}/rerun.py", response_class=PlainTextResponse)
def rerun_helper(run_id: str, db: Session = Depends(get_db)):
    _find_run(db, run_id)
    return _rerun_script(run_id)


@app.get("/api/v1/runs/{run_id}/bundle.zip")
def reproducibility_bundle(run_id: str, db: Session = Depends(get_db)):
    run = _run_to_dict(_find_run(db, run_id))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("metadata.json", json.dumps(run, indent=2))
        archive.writestr("rerun.py", _rerun_script(run_id))
        if run.get("qasm"):
            archive.writestr("circuit.qasm", run["qasm"])
        pip_freeze = (run.get("context") or {}).get("pip_freeze")
        if pip_freeze:
            archive.writestr("requirements.txt", pip_freeze)
        calibration = run.get("calibration")
        if calibration:
            archive.writestr("calibration.json", json.dumps(calibration, indent=2))
        transpiler = run.get("transpiler")
        if transpiler:
            archive.writestr("transpiler.json", json.dumps(transpiler, indent=2))
    buffer.seek(0)
    return Response(
        content=buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="qlab-run-{run_id}.zip"'},
    )


@app.get("/api/v1/runs/{run_id}/capsule.zip")
def reproducibility_capsule(run_id: str, db: Session = Depends(get_db)):
    """Reproducibility Time Capsule — hermetic zip with SHA256 manifest."""
    run = _run_to_dict(_find_run(db, run_id))
    files: dict[str, bytes] = {}

    # Core artifacts
    metadata = {k: v for k, v in run.items() if k not in ("qasm",)}
    files["metadata.json"] = json.dumps(metadata, indent=2).encode()
    files["rerun.py"] = _rerun_script(run_id).encode()

    if run.get("qasm"):
        files["circuit.qasm"] = run["qasm"].encode()

    ctx = run.get("context") or {}
    pip_freeze = ctx.get("pip_freeze")
    if pip_freeze:
        files["requirements.txt"] = str(pip_freeze).encode()

    for key, fname in [
        ("calibration", "calibration.json"),
        ("transpiler", "transpiler.json"),
        ("results", "results.json"),
        ("parameters", "parameters.json"),
        ("fingerprint", "fingerprint.json"),
    ]:
        val = run.get(key)
        if val:
            files[fname] = json.dumps(val, indent=2).encode()

    # SHA256 manifest — each line: <hash>  <filename>
    manifest_lines = [f"{hashlib.sha256(content).hexdigest()}  {name}" for name, content in files.items()]
    manifest_lines.sort()
    files["MANIFEST.sha256"] = "\n".join(manifest_lines).encode()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(f"qlab-capsule-{run_id[:8]}/{name}", content)
    buffer.seek(0)
    return Response(
        content=buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="qlab-capsule-{run_id[:8]}.zip"'},
    )


# ------------------------------------------------------------------
# Badge SVG + Provenance
# ------------------------------------------------------------------

@app.get("/api/v1/runs/{run_id}/badge.svg")
def run_badge_svg(run_id: str, db: Session = Depends(get_db)):
    run = db.scalars(select(Run).where(Run.run_id == run_id)).first()
    if not run:
        raise HTTPException(404)

    score = getattr(run, 'health_score', None) or 0
    if not score:
        score = compute_health_score(_run_to_dict(run))

    color = "#22c55e" if score >= 80 else "#f59e0b" if score >= 60 else "#ef4444"
    label = "Q-Lab"
    value = f"health {score:.0f}/100"

    label_w = len(label) * 6 + 10
    value_w = len(value) * 6 + 10
    total_w = label_w + value_w

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{total_w}" height="20">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <rect rx="3" width="{total_w}" height="20" fill="#555"/>
  <rect rx="3" x="{label_w}" width="{value_w}" height="20" fill="{color}"/>
  <rect width="{label_w + 4}" height="20" fill="#555"/>
  <rect rx="3" width="{total_w}" height="20" fill="url(#s)"/>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="{label_w // 2}" y="15" fill="#010101" fill-opacity=".3">{label}</text>
    <text x="{label_w // 2}" y="14">{label}</text>
    <text x="{label_w + value_w // 2}" y="15" fill="#010101" fill-opacity=".3">{value}</text>
    <text x="{label_w + value_w // 2}" y="14">{value}</text>
  </g>
</svg>'''
    return Response(content=svg, media_type="image/svg+xml", headers={"Cache-Control": "max-age=3600"})


@app.get("/api/v1/runs/{run_id}/provenance")
def run_provenance(run_id: str, db: Session = Depends(get_db)):
    run = db.scalars(select(Run).where(Run.run_id == run_id)).first()
    if not run:
        raise HTTPException(404)

    metrics = db.scalars(select(RunMetric).where(RunMetric.run_id == run_id)).all()
    assertions = db.scalars(select(RunAssertion).where(RunAssertion.run_id == run_id)).all()

    return {
        "provenance_version": "1.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "run": {
            "run_id": run.run_id,
            "circuit_name": run.circuit_name,
            "backend": run.backend,
            "status": run.status,
            "created_at": run.created_at.isoformat() if run.created_at else None,
            "qasm": run.qasm,
            "project_slug": run.project_slug,
            "tags": run.tags or [],
        },
        "parameters": run.parameters or {},
        "execution": run.execution or {},
        "calibration": run.calibration or {},
        "transpiler": run.transpiler or {},
        "timing": run.timing or {},
        "results": run.results or {},
        "metrics": [{"name": m.name, "value": m.value, "step": m.step} for m in metrics],
        "assertions": [{"label": a.label, "type": a.assertion_type, "passed": a.passed, "actual": a.actual_value} for a in assertions],
        "reproducibility": {
            "instructions": "Run the QASM circuit above on the specified backend with the given parameters.",
            "sdk_snippet": f'import qlab\nqlab.init()\n# Circuit is in provenance["run"]["qasm"]\n# Backend: {run.backend}\n# Parameters: see provenance["parameters"]',
            "verification_url": f"http://localhost:3000/verify/{run.run_id}",
        },
    }


# ------------------------------------------------------------------
# Compare
# ------------------------------------------------------------------

@app.get("/api/v1/runs/compare/{left_run_id}/{right_run_id}", response_class=PlainTextResponse)
def compare_runs_qasm(left_run_id: str, right_run_id: str, db: Session = Depends(get_db)):
    left = _find_run(db, left_run_id)
    right = _find_run(db, right_run_id)
    return "".join(
        unified_diff(
            (left.qasm or "").splitlines(keepends=True),
            (right.qasm or "").splitlines(keepends=True),
            fromfile=f"{left_run_id}.qasm",
            tofile=f"{right_run_id}.qasm",
        )
    )


@app.get("/api/v1/runs/compare/{left_run_id}/{right_run_id}/json")
def compare_runs_json(left_run_id: str, right_run_id: str, db: Session = Depends(get_db)):
    left = _run_to_dict(_find_run(db, left_run_id))
    right = _run_to_dict(_find_run(db, right_run_id))
    lq = (left.get("qasm") or "").splitlines(keepends=True)
    rq = (right.get("qasm") or "").splitlines(keepends=True)
    return {
        "left_run_id": left_run_id,
        "right_run_id": right_run_id,
        "summary": {
            "same_qasm": left.get("qasm") == right.get("qasm"),
            "same_backend": left.get("backend") == right.get("backend"),
            "same_fingerprint": left.get("fingerprint") == right.get("fingerprint"),
            "same_context": left.get("context") == right.get("context"),
            "same_parameters": left.get("parameters") == right.get("parameters"),
        },
        "fingerprint_diff": _dict_diff(left.get("fingerprint") or {}, right.get("fingerprint") or {}),
        "parameter_diff": _dict_diff(left.get("parameters") or {}, right.get("parameters") or {}),
        "context_diff": _dict_diff(left.get("context") or {}, right.get("context") or {}),
        "timing_diff": _dict_diff(left.get("timing") or {}, right.get("timing") or {}),
        "calibration_diff": _dict_diff(left.get("calibration") or {}, right.get("calibration") or {}),
        "result_diff": _dict_diff(left.get("results") or {}, right.get("results") or {}),
        "qasm_diff": "".join(unified_diff(lq, rq, fromfile=f"{left_run_id}.qasm", tofile=f"{right_run_id}.qasm")),
    }


# ------------------------------------------------------------------
# Analytics
# ------------------------------------------------------------------

@app.get("/api/v1/metrics/runs")
def run_metrics(
    backend: Optional[str] = None,
    status: Optional[str] = None,
    project: Optional[str] = None,
    db: Session = Depends(get_db),
):
    runs = db.scalars(
        _filtered_runs_query(backend=backend, status=status, project=project).order_by(Run.created_at.asc())
    ).all()

    total = len(runs)
    completed = sum(1 for r in runs if r.status == "completed")
    failed = sum(1 for r in runs if r.status == "failed")
    submitted = sum(1 for r in runs if r.status == "submitted")
    with_results = sum(1 for r in runs if bool(r.results))
    with_calibration = sum(1 for r in runs if bool(r.calibration))

    backends: Dict[str, int] = {}
    statuses: Dict[str, int] = {}
    projects: Dict[str, int] = {}
    gate_counts: Dict[str, int] = {}
    timeline = []
    max_depth = max_qubits = 0
    nc_total = sp_total = 0.0
    sp_count = 0

    for run in runs:
        backends[run.backend or "unknown"] = backends.get(run.backend or "unknown", 0) + 1
        statuses[run.status] = statuses.get(run.status, 0) + 1
        proj_key = run.project_slug or "unassigned"
        projects[proj_key] = projects.get(proj_key, 0) + 1
        fp = run.fingerprint or {}
        depth = int(_safe_number(fp.get("depth")))
        qubits = int(_safe_number(fp.get("num_qubits")))
        nc = _safe_number(fp.get("non_clifford_ratio"))
        max_depth = max(max_depth, depth)
        max_qubits = max(max_qubits, qubits)
        nc_total += nc
        for g, c in (fp.get("gate_counts") or {}).items():
            gate_counts[str(g)] = gate_counts.get(str(g), 0) + int(_safe_number(c))
        res = run.results or {}
        if "success_probability" in res:
            sp_total += _safe_number(res["success_probability"])
            sp_count += 1
        run_dict = _run_to_dict(run, include_health=True)
        timeline.append({
            "run_id": run.run_id,
            "created_at": run.created_at.isoformat(),
            "status": run.status,
            "backend": run.backend,
            "project": run.project_slug,
            "depth": depth,
            "qubits": qubits,
            "non_clifford_ratio": nc,
            "has_results": bool(run.results),
            "health_score": run_dict.get("health_score"),
        })

    return {
        "total_runs": total,
        "completed_runs": completed,
        "failed_runs": failed,
        "submitted_runs": submitted,
        "runs_with_results": with_results,
        "runs_with_calibration": with_calibration,
        "completion_rate": completed / total if total else 0,
        "failure_rate": failed / total if total else 0,
        "result_capture_rate": with_results / total if total else 0,
        "calibration_capture_rate": with_calibration / total if total else 0,
        "max_depth": max_depth,
        "max_qubits": max_qubits,
        "average_non_clifford_ratio": nc_total / total if total else 0,
        "average_success_probability": sp_total / sp_count if sp_count else None,
        "by_backend": backends,
        "by_status": statuses,
        "by_project": projects,
        "gate_counts": gate_counts,
        "timeline": timeline,
    }


@app.get("/api/v1/analytics/timeseries")
def analytics_timeseries(
    project: Optional[str] = None,
    backend: Optional[str] = None,
    days: int = Query(default=30, ge=1, le=365),
    granularity: str = Query(default="day", pattern="^(hour|day|week)$"),
    identity: Optional[Identity] = Depends(get_identity),
    db: Session = Depends(get_db),
):
    org_id = identity.org_id if identity else None
    return get_timeseries(
        org_id=org_id,
        project_slug=project,
        backend=backend,
        days=days,
        granularity=granularity,
        db=db,
    )


# ------------------------------------------------------------------
# Public share (no auth)
# ------------------------------------------------------------------

@app.post("/api/v1/runs/{run_id}/share")
def generate_share_token(
    run_id: str,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    import secrets as _secrets
    run = _find_run(db, run_id)
    if not run.share_token:
        run.share_token = _secrets.token_urlsafe(24)
        db.commit()
        db.refresh(run)
    return {
        "share_token": run.share_token,
        "share_url": f"http://localhost:3000/share/{run.share_token}",
    }


@app.get("/api/v1/runs/public/{share_token}")
def get_public_run(share_token: str, db: Session = Depends(get_db)):
    from sqlalchemy import text as _text
    run = db.scalar(select(Run).where(Run.share_token == share_token))
    if run is None:
        raise HTTPException(status_code=404, detail="Shared run not found or sharing has been disabled")
    d = _run_to_dict(run, include_health=True)
    d["health_breakdown"] = health_breakdown(d)
    # Strip sensitive internals from public view
    d.pop("org_id", None)
    d.pop("created_by_user_id", None)
    return d


# ------------------------------------------------------------------
# Exports
# ------------------------------------------------------------------

@app.get("/api/v1/exports/runs.csv", response_class=PlainTextResponse)
def export_runs_csv(
    backend: Optional[str] = None,
    status: Optional[str] = None,
    project: Optional[str] = None,
    db: Session = Depends(get_db),
):
    runs = db.scalars(
        _filtered_runs_query(backend=backend, status=status, project=project).order_by(Run.created_at.desc())
    ).all()
    rows = [_flatten_run_for_csv(_run_to_dict(r, include_health=True)) for r in runs]
    buf = io.StringIO()
    fieldnames = list(_flatten_run_for_csv({}).keys())
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return PlainTextResponse(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{_export_filename("qlab-runs", "csv")}"'},
    )


@app.get("/api/v1/exports/runs.jsonl", response_class=PlainTextResponse)
def export_runs_jsonl(
    backend: Optional[str] = None,
    status: Optional[str] = None,
    project: Optional[str] = None,
    db: Session = Depends(get_db),
):
    runs = db.scalars(
        _filtered_runs_query(backend=backend, status=status, project=project).order_by(Run.created_at.desc())
    ).all()
    lines = [json.dumps(_run_to_dict(r, include_health=True)) for r in runs]
    return PlainTextResponse(
        content="\n".join(lines) + ("\n" if lines else ""),
        media_type="application/x-ndjson",
        headers={"Content-Disposition": f'attachment; filename="{_export_filename("qlab-runs", "jsonl")}"'},
    )


@app.get("/api/v1/reports/runs.md", response_class=PlainTextResponse)
def export_runs_report(
    backend: Optional[str] = None,
    status: Optional[str] = None,
    project: Optional[str] = None,
    db: Session = Depends(get_db),
):
    runs = [_run_to_dict(r, include_health=True) for r in
            db.scalars(_filtered_runs_query(backend=backend, status=status, project=project)
                       .order_by(Run.created_at.desc())).all()]
    metrics = run_metrics(backend=backend, status=status, project=project, db=db)
    report = _run_report_markdown({"backend": backend, "status": status, "project": project}, metrics, runs)
    return PlainTextResponse(
        content=report,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{_export_filename("qlab-report", "md")}"'},
    )


# ------------------------------------------------------------------
# HTML dashboard (built-in, always available)
# ------------------------------------------------------------------

def _rerun_script(run_id: str) -> str:
    return f"""from qiskit import qasm3
QASM_URL = "http://localhost:8000/api/v1/runs/{run_id}/qasm"
# Download QASM from Q-Lab then re-submit to your chosen backend.
"""


def _run_report_markdown(filters: Dict, metrics: Dict, runs: List[Dict]) -> str:
    active = ", ".join(f"{k}={v}" for k, v in filters.items() if v) or "none"
    lines = [
        "# Q-Lab Experiment Report", "",
        f"Generated: {datetime.utcnow().isoformat()}Z",
        f"Filters: {active}", "",
        "## Summary", "",
        f"- Total runs: {metrics['total_runs']}",
        f"- Completed: {metrics['completed_runs']}",
        f"- Failed: {metrics['failed_runs']}",
        f"- Completion rate: {metrics['completion_rate']:.1%}",
        f"- Calibration capture rate: {metrics['calibration_capture_rate']:.1%}",
        f"- Max qubits: {metrics['max_qubits']}",
        f"- Max depth: {metrics['max_depth']}",
        f"- Avg non-Clifford ratio: {metrics['average_non_clifford_ratio']:.3f}",
    ]
    if metrics.get("average_success_probability") is not None:
        lines.append(f"- Avg success probability: {metrics['average_success_probability']:.3f}")
    lines += [
        "", "## Recent Runs", "",
        "| Run ID | Circuit | Backend | Status | Qubits | Depth | Health |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in runs[:25]:
        fp = r.get("fingerprint") or {}
        lines.append(
            f"| {r.get('run_id')} | {r.get('circuit_name') or ''} | {r.get('backend') or ''} | "
            f"{r.get('status')} | {fp.get('num_qubits') or ''} | {fp.get('depth') or ''} | "
            f"{r.get('health_score') or 'n/a'} |"
        )
    return "\n".join(lines) + "\n"


@app.get("/", response_class=HTMLResponse)
def dashboard():
    return HTMLResponse(_DASHBOARD_HTML)


@app.get("/runs/{run_id}", response_class=HTMLResponse)
def run_page(run_id: str, db: Session = Depends(get_db)):
    run = _run_to_dict(_find_run(db, run_id), include_health=True)
    hb = health_breakdown(run)

    def esc(v: Any) -> str:
        return html.escape(json.dumps(v, indent=2) if not isinstance(v, str) else v)

    name = html.escape(run.get("circuit_name") or run_id)
    backend = html.escape(run.get("backend") or "—")
    health = run.get("health_score")
    health_color = "#27ae60" if health and health >= 70 else ("#e67e22" if health and health >= 40 else "#e74c3c")

    return HTMLResponse(f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>{name} — Q-Lab</title>
  <style>
    body{{font-family:Inter,Segoe UI,Arial,sans-serif;margin:0;color:#17202a;background:#f7f8fa}}
    header{{padding:20px 32px;background:#fff;border-bottom:1px solid #dfe4ea;display:flex;align-items:center;gap:16px}}
    h1{{margin:0;font-size:22px}}
    .badge{{padding:4px 10px;border-radius:20px;font-size:13px;font-weight:600}}
    main{{padding:24px 32px;display:grid;gap:16px;grid-template-columns:1fr 1fr}}
    section{{background:#fff;border:1px solid #dfe4ea;padding:16px;border-radius:6px}}
    section.full{{grid-column:1/-1}}
    h2{{margin:0 0 12px;font-size:15px;color:#4f5f70}}
    pre{{overflow:auto;white-space:pre-wrap;font-size:12px;line-height:1.5;margin:0;max-height:300px}}
    .actions{{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px}}
    a.btn{{padding:8px 14px;border-radius:5px;background:#1d6f8f;color:#fff;text-decoration:none;font-size:13px}}
    .stat{{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f3f7;font-size:14px}}
    .stat:last-child{{border:none}}
    .score{{font-size:36px;font-weight:700;color:{health_color}}}
  </style>
</head>
<body>
<header>
  <div>
    <h1>{name}</h1>
    <div style="color:#4f5f70;font-size:13px">Backend: {backend} &nbsp;|&nbsp; {html.escape(run_id)}</div>
  </div>
  <div style="margin-left:auto;text-align:right">
    <div class="badge" style="background:{health_color}22;color:{health_color}">
      Health: {health if health is not None else 'n/a'}
    </div>
  </div>
</header>
<main>
  <section class="full">
    <div class="actions">
      <a class="btn" href="/api/v1/runs/{html.escape(run_id)}/qasm">QASM</a>
      <a class="btn" href="/api/v1/runs/{html.escape(run_id)}/rerun.py">Re-run helper</a>
      <a class="btn" href="/api/v1/runs/{html.escape(run_id)}/bundle.zip">Bundle ZIP</a>
      <a class="btn" href="/api/v1/runs/{html.escape(run_id)}/health">Health JSON</a>
      <a class="btn" href="/" style="background:#6c757d">← All runs</a>
    </div>
  </section>

  <section>
    <h2>Health Score</h2>
    <div class="score">{health if health is not None else '—'}</div>
    {''.join(f'<div class="stat"><span>{k}</span><span>{v}</span></div>' for k, v in hb.items() if k != 'overall')}
  </section>

  <section>
    <h2>Fingerprint</h2>
    <pre>{esc(run.get("fingerprint", {}))}</pre>
  </section>

  <section>
    <h2>Timing</h2>
    <pre>{esc(run.get("timing", {}))}</pre>
  </section>

  <section>
    <h2>Transpiler</h2>
    <pre>{esc(run.get("transpiler", {}))}</pre>
  </section>

  <section>
    <h2>Calibration</h2>
    <pre>{esc(run.get("calibration", {}))}</pre>
  </section>

  <section>
    <h2>Execution</h2>
    <pre>{esc(run.get("execution", {}))}</pre>
  </section>

  <section>
    <h2>Results</h2>
    <pre>{esc(run.get("results", {}))}</pre>
  </section>

  <section>
    <h2>Context</h2>
    <pre>{esc(run.get("context", {}))}</pre>
  </section>

  <section class="full">
    <h2>QASM</h2>
    <pre>{html.escape(run.get("qasm") or "—")}</pre>
  </section>
</main>
</body>
</html>""")


_DASHBOARD_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Q-Lab — Quantum Systems of Record</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:Inter,Segoe UI,Arial,sans-serif;margin:0;color:#17202a;background:#f7f8fa}
    header{padding:16px 32px;background:#0d1b2a;color:#fff;display:flex;align-items:center;gap:16px}
    header h1{margin:0;font-size:20px;font-weight:700;letter-spacing:-.5px}
    .badge{padding:3px 8px;border-radius:12px;font-size:11px;font-weight:600;background:#1d6f8f;color:#fff}
    .live-dot{width:8px;height:8px;border-radius:50%;background:#27ae60;display:inline-block;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    main{padding:20px 32px}
    .toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
    input,select{padding:8px 10px;border:1px solid #c7cfd9;border-radius:5px;min-width:140px;font-size:14px}
    button{padding:8px 14px;border:none;border-radius:5px;background:#1d6f8f;color:#fff;cursor:pointer;font-size:14px}
    button.sec{background:#6c757d}
    .metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}
    .card{background:#fff;border:1px solid #dfe4ea;border-radius:6px;padding:16px;text-align:center}
    .card-val{font-size:28px;font-weight:700;color:#1d6f8f}
    .card-lbl{font-size:12px;color:#4f5f70;margin-top:4px}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dfe4ea;border-radius:6px;overflow:hidden}
    th,td{padding:10px 12px;border-bottom:1px solid #edf0f3;font-size:13px;text-align:left}
    th{background:#fafbfc;color:#4f5f70;font-weight:600}
    tr:hover td{background:#f5f9fc}
    a{color:#1d6f8f;text-decoration:none}
    a:hover{text-decoration:underline}
    .status{padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600}
    .s-completed{background:#eafaf1;color:#1e8449}
    .s-failed{background:#fdecea;color:#c0392b}
    .s-submitted{background:#ebf5fb;color:#1a5276}
    .s-other{background:#f4f4f4;color:#555}
    .health{font-weight:700}
    .h-good{color:#27ae60}.h-warn{color:#e67e22}.h-bad{color:#e74c3c}.h-na{color:#aaa}
    .empty{padding:32px;text-align:center;color:#4f5f70}
    .panel{background:#fff;border:1px solid #dfe4ea;border-radius:6px;overflow:hidden}
    .panel-hdr{padding:12px 16px;border-bottom:1px solid #edf0f3;font-weight:600;font-size:14px;display:flex;align-items:center;gap:8px}
  </style>
</head>
<body>
<header>
  <h1>Q-Lab</h1>
  <span class="badge">Quantum Systems of Record</span>
  <div style="margin-left:auto;display:flex;align-items:center;gap:8px;font-size:13px">
    <span class="live-dot"></span> Live
  </div>
</header>
<main>
  <div class="toolbar">
    <input id="q" placeholder="Search circuit / tag"/>
    <input id="backend" placeholder="Backend"/>
    <select id="status">
      <option value="">All statuses</option>
      <option>completed</option><option>failed</option><option>submitted</option>
    </select>
    <input id="project" placeholder="Project"/>
    <input id="min_qubits" placeholder="Min qubits" type="number" style="min-width:100px"/>
    <input id="max_depth" placeholder="Max depth" type="number" style="min-width:100px"/>
    <button onclick="search()">Search</button>
    <button class="sec" onclick="clearFilters()">Clear</button>
    <a href="/api/v1/exports/runs.csv" style="padding:8px 14px;background:#2ecc71;color:#fff;border-radius:5px;text-decoration:none;font-size:14px">CSV</a>
    <a href="/api/v1/exports/runs.jsonl" style="padding:8px 14px;background:#3498db;color:#fff;border-radius:5px;text-decoration:none;font-size:14px">JSONL</a>
    <a href="/api/v1/reports/runs.md" style="padding:8px 14px;background:#9b59b6;color:#fff;border-radius:5px;text-decoration:none;font-size:14px">Report</a>
  </div>

  <div class="metrics" id="metrics"></div>

  <div class="panel">
    <div class="panel-hdr">
      Experiments
      <span id="run-count" style="font-size:12px;color:#4f5f70;font-weight:400"></span>
    </div>
    <div id="app"><div class="empty">Loading…</div></div>
  </div>
</main>

<script>
let _runs = [];
let _es = null;

function statusClass(s){
  if(!s) return 's-other';
  s = s.toLowerCase();
  if(s==='completed') return 's-completed';
  if(s==='failed') return 's-failed';
  if(s==='submitted') return 's-submitted';
  return 's-other';
}

function healthClass(h){
  if(h===null||h===undefined) return 'h-na';
  if(h>=70) return 'h-good';
  if(h>=40) return 'h-warn';
  return 'h-bad';
}

function renderMetrics(runs){
  const total = runs.length;
  const completed = runs.filter(r=>r.status==='completed').length;
  const failed = runs.filter(r=>r.status==='failed').length;
  const maxQ = Math.max(0,...runs.map(r=>r.fingerprint?.num_qubits||0));
  const maxD = Math.max(0,...runs.map(r=>r.fingerprint?.depth||0));
  const withCal = runs.filter(r=>r.calibration&&Object.keys(r.calibration).length>0).length;
  document.getElementById('metrics').innerHTML = [
    ['Runs',total],['Completed',completed],['Failed',failed],
    ['Max Qubits',maxQ],['Max Depth',maxD],['With Calibration',withCal]
  ].map(([l,v])=>`<div class="card"><div class="card-val">${v}</div><div class="card-lbl">${l}</div></div>`).join('');
}

function renderTable(runs){
  document.getElementById('run-count').textContent = `(${runs.length})`;
  if(!runs.length){
    document.getElementById('app').innerHTML='<div class="empty">No experiments found.</div>';
    return;
  }
  const rows = runs.map(r=>{
    const h = r.health_score;
    const hc = healthClass(h);
    return `<tr>
      <td><a href="/runs/${r.run_id}">${r.circuit_name||r.run_id.slice(0,10)}</a></td>
      <td>${r.project||''}</td>
      <td>${r.backend||''}</td>
      <td><span class="status ${statusClass(r.status)}">${r.status}</span></td>
      <td>${r.fingerprint?.num_qubits??''}</td>
      <td>${r.fingerprint?.depth??''}</td>
      <td>${((r.fingerprint?.non_clifford_ratio||0)*100).toFixed(1)}%</td>
      <td class="health ${hc}">${h!==null&&h!==undefined?h:'—'}</td>
      <td style="color:#4f5f70;font-size:12px">${new Date(r.created_at).toLocaleString()}</td>
    </tr>`;
  }).join('');
  document.getElementById('app').innerHTML=`<table>
    <thead><tr><th>Run</th><th>Project</th><th>Backend</th><th>Status</th><th>Qubits</th><th>Depth</th><th>Non-Clifford</th><th>Health</th><th>Created</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

async function search(){
  const params = new URLSearchParams();
  const q=document.getElementById('q').value.trim();
  const backend=document.getElementById('backend').value.trim();
  const status=document.getElementById('status').value;
  const project=document.getElementById('project').value.trim();
  const minQ=document.getElementById('min_qubits').value.trim();
  const maxD=document.getElementById('max_depth').value.trim();
  if(q) params.set('q',q);
  if(backend) params.set('backend',backend);
  if(status) params.set('status',status);
  if(project) params.set('project',project);
  if(minQ) params.set('min_qubits',minQ);
  if(maxD) params.set('max_depth',maxD);
  params.set('page_size','200');
  const res = await fetch('/api/v1/search/runs?'+params);
  const data = await res.json();
  _runs = data.items||[];
  renderMetrics(_runs);
  renderTable(_runs);
}

function clearFilters(){
  ['q','backend','project','min_qubits','max_depth'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('status').value='';
  search();
}

function connectSSE(){
  if(_es) _es.close();
  _es = new EventSource('/api/v1/runs/stream');
  _es.onmessage = e => {
    const {type, data} = JSON.parse(e.data);
    if(type==='run.created'){
      _runs.unshift(data);
      renderMetrics(_runs);
      renderTable(_runs);
    } else if(type==='run.updated'){
      const idx = _runs.findIndex(r=>r.run_id===data.run_id);
      if(idx>=0){ _runs[idx]=data; renderTable(_runs); }
    }
  };
  _es.onerror = () => { setTimeout(connectSSE, 5000); };
}

search().then(connectSSE);
</script>
</body>
</html>"""
