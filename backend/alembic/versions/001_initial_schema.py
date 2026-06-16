"""Initial schema — all Q-Lab tables

Revision ID: 001
Revises:
Create Date: 2026-06-15 00:00:00.000000

This migration is intentionally idempotent: every table is created with
CREATE TABLE IF NOT EXISTS so it is safe to run against a database that
was already bootstrapped by init_db() / Base.metadata.create_all().
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import sqlite

# revision identifiers, used by Alembic.
revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    statements = [
        # ------------------------------------------------------------------
        # organizations
        # ------------------------------------------------------------------
        """CREATE TABLE IF NOT EXISTS organizations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug VARCHAR(120) NOT NULL UNIQUE,
            name VARCHAR(200) NOT NULL,
            plan VARCHAR(64) NOT NULL DEFAULT 'free',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS ix_organizations_slug ON organizations(slug)",

        # ------------------------------------------------------------------
        # users
        # ------------------------------------------------------------------
        """CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            org_id INTEGER REFERENCES organizations(id),
            email VARCHAR(320) NOT NULL UNIQUE,
            name VARCHAR(200) NOT NULL,
            password_hash VARCHAR(256) NOT NULL,
            role VARCHAR(64) NOT NULL DEFAULT 'researcher',
            is_active BOOLEAN NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS ix_users_email ON users(email)",
        "CREATE INDEX IF NOT EXISTS ix_users_org_id ON users(org_id)",

        # ------------------------------------------------------------------
        # api_keys
        # ------------------------------------------------------------------
        """CREATE TABLE IF NOT EXISTS api_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            org_id INTEGER REFERENCES organizations(id),
            name VARCHAR(200) NOT NULL,
            key_hash VARCHAR(256) NOT NULL UNIQUE,
            key_prefix VARCHAR(16) NOT NULL,
            last_used_at DATETIME,
            expires_at DATETIME,
            is_active BOOLEAN NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS ix_api_keys_user_id ON api_keys(user_id)",
        "CREATE INDEX IF NOT EXISTS ix_api_keys_org_id ON api_keys(org_id)",
        "CREATE INDEX IF NOT EXISTS ix_api_keys_key_hash ON api_keys(key_hash)",

        # ------------------------------------------------------------------
        # audit_logs
        # ------------------------------------------------------------------
        """CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            org_id INTEGER REFERENCES organizations(id),
            user_id INTEGER REFERENCES users(id),
            action VARCHAR(120) NOT NULL,
            resource_type VARCHAR(64),
            resource_id VARCHAR(128),
            ip_address VARCHAR(64),
            user_agent VARCHAR(500),
            meta JSON NOT NULL DEFAULT '{}',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS ix_audit_logs_org_id ON audit_logs(org_id)",
        "CREATE INDEX IF NOT EXISTS ix_audit_logs_user_id ON audit_logs(user_id)",
        "CREATE INDEX IF NOT EXISTS ix_audit_logs_action ON audit_logs(action)",
        "CREATE INDEX IF NOT EXISTS ix_audit_logs_created_at ON audit_logs(created_at)",

        # ------------------------------------------------------------------
        # benchmarks
        # ------------------------------------------------------------------
        """CREATE TABLE IF NOT EXISTS benchmarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            benchmark_id VARCHAR(64) NOT NULL UNIQUE,
            name VARCHAR(255),
            circuit_qasm TEXT,
            backends JSON NOT NULL DEFAULT '[]',
            run_ids JSON NOT NULL DEFAULT '[]',
            status VARCHAR(64) NOT NULL DEFAULT 'running',
            project_slug VARCHAR(120),
            created_by_user_id INTEGER REFERENCES users(id),
            org_id INTEGER REFERENCES organizations(id),
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS ix_benchmarks_benchmark_id ON benchmarks(benchmark_id)",
        "CREATE INDEX IF NOT EXISTS ix_benchmarks_project_slug ON benchmarks(project_slug)",
        "CREATE INDEX IF NOT EXISTS ix_benchmarks_org_id ON benchmarks(org_id)",
        "CREATE INDEX IF NOT EXISTS ix_benchmarks_created_at ON benchmarks(created_at)",

        # ------------------------------------------------------------------
        # webhooks
        # ------------------------------------------------------------------
        """CREATE TABLE IF NOT EXISTS webhooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            org_id INTEGER REFERENCES organizations(id),
            name VARCHAR(200) NOT NULL,
            url VARCHAR(2000) NOT NULL,
            events JSON NOT NULL DEFAULT '[]',
            secret VARCHAR(256),
            project_slug VARCHAR(120),
            is_active BOOLEAN NOT NULL DEFAULT 1,
            last_triggered_at DATETIME,
            last_status_code INTEGER,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS ix_webhooks_org_id ON webhooks(org_id)",

        # ------------------------------------------------------------------
        # projects
        # ------------------------------------------------------------------
        """CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug VARCHAR(120) NOT NULL UNIQUE,
            name VARCHAR(200) NOT NULL,
            description TEXT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS ix_projects_slug ON projects(slug)",

        # ------------------------------------------------------------------
        # runs
        # ------------------------------------------------------------------
        """CREATE TABLE IF NOT EXISTS runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id VARCHAR(64) NOT NULL,
            circuit_name VARCHAR(255),
            qasm TEXT,
            backend VARCHAR(255),
            status VARCHAR(64) NOT NULL DEFAULT 'submitted',
            share_url VARCHAR(500),
            project_slug VARCHAR(120),
            project_id INTEGER REFERENCES projects(id),
            org_id INTEGER REFERENCES organizations(id),
            created_by_user_id INTEGER REFERENCES users(id),
            benchmark_id VARCHAR(64),
            created_at DATETIME NOT NULL,
            received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            fingerprint JSON NOT NULL DEFAULT '{}',
            context JSON NOT NULL DEFAULT '{}',
            parameters JSON NOT NULL DEFAULT '{}',
            execution JSON NOT NULL DEFAULT '{}',
            calibration JSON NOT NULL DEFAULT '{}',
            transpiler JSON NOT NULL DEFAULT '{}',
            timing JSON NOT NULL DEFAULT '{}',
            results JSON NOT NULL DEFAULT '{}',
            shadow_results JSON NOT NULL DEFAULT '{}',
            tags JSON NOT NULL DEFAULT '[]',
            share_token VARCHAR(64) UNIQUE,
            CONSTRAINT uq_runs_run_id UNIQUE (run_id)
        )""",
        "CREATE INDEX IF NOT EXISTS ix_runs_run_id ON runs(run_id)",
        "CREATE INDEX IF NOT EXISTS ix_runs_backend ON runs(backend)",
        "CREATE INDEX IF NOT EXISTS ix_runs_status ON runs(status)",
        "CREATE INDEX IF NOT EXISTS ix_runs_project_slug ON runs(project_slug)",
        "CREATE INDEX IF NOT EXISTS ix_runs_org_id ON runs(org_id)",
        "CREATE INDEX IF NOT EXISTS ix_runs_benchmark_id ON runs(benchmark_id)",
        "CREATE INDEX IF NOT EXISTS ix_runs_created_at ON runs(created_at)",
        "CREATE INDEX IF NOT EXISTS ix_runs_share_token ON runs(share_token)",

        # ------------------------------------------------------------------
        # campaigns
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_campaigns_project_slug ON campaigns(project_slug)",
        "CREATE INDEX IF NOT EXISTS ix_campaigns_org_id ON campaigns(org_id)",
        "CREATE INDEX IF NOT EXISTS ix_campaigns_status ON campaigns(status)",
        "CREATE INDEX IF NOT EXISTS ix_campaigns_created_at ON campaigns(created_at)",

        # ------------------------------------------------------------------
        # run_notes
        # ------------------------------------------------------------------
        """CREATE TABLE IF NOT EXISTS run_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id VARCHAR(64) NOT NULL,
            user_id INTEGER REFERENCES users(id),
            content TEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS ix_run_notes_run_id ON run_notes(run_id)",
        "CREATE INDEX IF NOT EXISTS ix_run_notes_user_id ON run_notes(user_id)",

        # ------------------------------------------------------------------
        # run_metrics
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_run_metrics_logged_at ON run_metrics(logged_at)",

        # ------------------------------------------------------------------
        # run_assertions
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_run_assertions_created_at ON run_assertions(created_at)",

        # ------------------------------------------------------------------
        # advice_feedback
        # ------------------------------------------------------------------
        """CREATE TABLE IF NOT EXISTS advice_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id VARCHAR(64) NOT NULL,
            feature VARCHAR(64) NOT NULL,
            item_id VARCHAR(120),
            rating VARCHAR(32) NOT NULL,
            note TEXT,
            user_id INTEGER REFERENCES users(id),
            org_id INTEGER REFERENCES organizations(id),
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS ix_advice_feedback_run_id ON advice_feedback(run_id)",
        "CREATE INDEX IF NOT EXISTS ix_advice_feedback_feature ON advice_feedback(feature)",
        "CREATE INDEX IF NOT EXISTS ix_advice_feedback_item_id ON advice_feedback(item_id)",
        "CREATE INDEX IF NOT EXISTS ix_advice_feedback_rating ON advice_feedback(rating)",
        "CREATE INDEX IF NOT EXISTS ix_advice_feedback_user_id ON advice_feedback(user_id)",
        "CREATE INDEX IF NOT EXISTS ix_advice_feedback_org_id ON advice_feedback(org_id)",
        "CREATE INDEX IF NOT EXISTS ix_advice_feedback_created_at ON advice_feedback(created_at)",

        # ------------------------------------------------------------------
        # org_invites
        # ------------------------------------------------------------------
        """CREATE TABLE IF NOT EXISTS org_invites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            org_id INTEGER NOT NULL REFERENCES organizations(id),
            email VARCHAR(320) NOT NULL,
            role VARCHAR(64) NOT NULL DEFAULT 'researcher',
            token VARCHAR(64) NOT NULL UNIQUE,
            invited_by_user_id INTEGER REFERENCES users(id),
            accepted_at DATETIME,
            expires_at DATETIME NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS ix_org_invites_org_id ON org_invites(org_id)",
        "CREATE INDEX IF NOT EXISTS ix_org_invites_email ON org_invites(email)",
        "CREATE INDEX IF NOT EXISTS ix_org_invites_token ON org_invites(token)",

        # ------------------------------------------------------------------
        # job_submissions
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_job_submissions_provider ON job_submissions(provider)",
        "CREATE INDEX IF NOT EXISTS ix_job_submissions_provider_job_id ON job_submissions(provider_job_id)",
        "CREATE INDEX IF NOT EXISTS ix_job_submissions_run_id ON job_submissions(run_id)",
        "CREATE INDEX IF NOT EXISTS ix_job_submissions_backend ON job_submissions(backend)",
        "CREATE INDEX IF NOT EXISTS ix_job_submissions_status ON job_submissions(status)",
        "CREATE INDEX IF NOT EXISTS ix_job_submissions_org_id ON job_submissions(org_id)",
        "CREATE INDEX IF NOT EXISTS ix_job_submissions_project_slug ON job_submissions(project_slug)",
        "CREATE INDEX IF NOT EXISTS ix_job_submissions_submitted_at ON job_submissions(submitted_at)",

        # ------------------------------------------------------------------
        # circuit_versions
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_circuit_versions_version_id ON circuit_versions(version_id)",
        "CREATE INDEX IF NOT EXISTS ix_circuit_versions_circuit_family ON circuit_versions(circuit_family)",
        "CREATE INDEX IF NOT EXISTS ix_circuit_versions_project_slug ON circuit_versions(project_slug)",
        "CREATE INDEX IF NOT EXISTS ix_circuit_versions_org_id ON circuit_versions(org_id)",
        "CREATE INDEX IF NOT EXISTS ix_circuit_versions_created_at ON circuit_versions(created_at)",

        # ------------------------------------------------------------------
        # budget_alerts
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_budget_alerts_alert_id ON budget_alerts(alert_id)",
        "CREATE INDEX IF NOT EXISTS ix_budget_alerts_org_id ON budget_alerts(org_id)",

        # ------------------------------------------------------------------
        # variational_runs
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_variational_runs_algorithm ON variational_runs(algorithm)",
        "CREATE INDEX IF NOT EXISTS ix_variational_runs_run_id ON variational_runs(run_id)",
        "CREATE INDEX IF NOT EXISTS ix_variational_runs_project_slug ON variational_runs(project_slug)",
        "CREATE INDEX IF NOT EXISTS ix_variational_runs_created_at ON variational_runs(created_at)",

        # ------------------------------------------------------------------
        # cicd_integrations
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_cicd_integrations_integration_id ON cicd_integrations(integration_id)",
        "CREATE INDEX IF NOT EXISTS ix_cicd_integrations_org_id ON cicd_integrations(org_id)",

        # ------------------------------------------------------------------
        # cicd_checks
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_cicd_checks_check_id ON cicd_checks(check_id)",
        "CREATE INDEX IF NOT EXISTS ix_cicd_checks_integration_id ON cicd_checks(integration_id)",
        "CREATE INDEX IF NOT EXISTS ix_cicd_checks_created_at ON cicd_checks(created_at)",

        # ------------------------------------------------------------------
        # tomography_jobs
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_tomography_jobs_tomo_id ON tomography_jobs(tomo_id)",
        "CREATE INDEX IF NOT EXISTS ix_tomography_jobs_run_id ON tomography_jobs(run_id)",
        "CREATE INDEX IF NOT EXISTS ix_tomography_jobs_created_at ON tomography_jobs(created_at)",

        # ------------------------------------------------------------------
        # api_credentials
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_api_credentials_cred_id ON api_credentials(cred_id)",
        "CREATE INDEX IF NOT EXISTS ix_api_credentials_org_id ON api_credentials(org_id)",
        "CREATE INDEX IF NOT EXISTS ix_api_credentials_provider ON api_credentials(provider)",

        # ------------------------------------------------------------------
        # notification_channels
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_notification_channels_channel_id ON notification_channels(channel_id)",
        "CREATE INDEX IF NOT EXISTS ix_notification_channels_org_id ON notification_channels(org_id)",

        # ------------------------------------------------------------------
        # notification_logs
        # ------------------------------------------------------------------
        """CREATE TABLE IF NOT EXISTS notification_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel_id VARCHAR(64) NOT NULL,
            event VARCHAR(120) NOT NULL,
            payload JSON NOT NULL DEFAULT '{}',
            status VARCHAR(32) NOT NULL DEFAULT 'sent',
            error TEXT,
            sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS ix_notification_logs_channel_id ON notification_logs(channel_id)",
        "CREATE INDEX IF NOT EXISTS ix_notification_logs_sent_at ON notification_logs(sent_at)",

        # ------------------------------------------------------------------
        # qv_results
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_qv_results_qv_id ON qv_results(qv_id)",
        "CREATE INDEX IF NOT EXISTS ix_qv_results_backend ON qv_results(backend)",
        "CREATE INDEX IF NOT EXISTS ix_qv_results_created_at ON qv_results(created_at)",

        # ------------------------------------------------------------------
        # gate_char_results
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_gate_char_results_char_id ON gate_char_results(char_id)",
        "CREATE INDEX IF NOT EXISTS ix_gate_char_results_backend ON gate_char_results(backend)",
        "CREATE INDEX IF NOT EXISTS ix_gate_char_results_char_type ON gate_char_results(char_type)",
        "CREATE INDEX IF NOT EXISTS ix_gate_char_results_created_at ON gate_char_results(created_at)",

        # ------------------------------------------------------------------
        # circuit_templates
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_circuit_templates_template_id ON circuit_templates(template_id)",
        "CREATE INDEX IF NOT EXISTS ix_circuit_templates_name ON circuit_templates(name)",
        "CREATE INDEX IF NOT EXISTS ix_circuit_templates_category ON circuit_templates(category)",

        # ------------------------------------------------------------------
        # decoherence_alerts
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_decoherence_alerts_alert_id ON decoherence_alerts(alert_id)",
        "CREATE INDEX IF NOT EXISTS ix_decoherence_alerts_backend ON decoherence_alerts(backend)",

        # ------------------------------------------------------------------
        # evolution_runs
        # ------------------------------------------------------------------
        """CREATE TABLE IF NOT EXISTS evolution_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id VARCHAR(64) NOT NULL UNIQUE,
            circuit_name VARCHAR(200) NOT NULL DEFAULT '',
            original_qasm TEXT NOT NULL,
            evolved_qasm TEXT NOT NULL,
            best_fitness REAL NOT NULL,
            improvement REAL NOT NULL DEFAULT 0.0,
            n_generations INTEGER NOT NULL,
            population_size INTEGER NOT NULL,
            fitness_history JSON NOT NULL DEFAULT '[]',
            config JSON NOT NULL DEFAULT '{}',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS ix_evolution_runs_run_id ON evolution_runs(run_id)",

        # ------------------------------------------------------------------
        # health_forecasts
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_health_forecasts_forecast_id ON health_forecasts(forecast_id)",
        "CREATE INDEX IF NOT EXISTS ix_health_forecasts_backend ON health_forecasts(backend)",

        # ------------------------------------------------------------------
        # advantage_results
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_advantage_results_result_id ON advantage_results(result_id)",

        # ------------------------------------------------------------------
        # fault_injection_results
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_fault_injection_results_result_id ON fault_injection_results(result_id)",

        # ------------------------------------------------------------------
        # reproducibility_results
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_reproducibility_results_result_id ON reproducibility_results(result_id)",
        "CREATE INDEX IF NOT EXISTS ix_reproducibility_results_original_run_id ON reproducibility_results(original_run_id)",

        # ------------------------------------------------------------------
        # circuit_dna
        # ------------------------------------------------------------------
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
        "CREATE INDEX IF NOT EXISTS ix_circuit_dna_dna_id ON circuit_dna(dna_id)",
        "CREATE INDEX IF NOT EXISTS ix_circuit_dna_dna_hash ON circuit_dna(dna_hash)",

        # ------------------------------------------------------------------
        # qrng_results
        # ------------------------------------------------------------------
        """CREATE TABLE IF NOT EXISTS qrng_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            result_id VARCHAR(64) NOT NULL UNIQUE,
            n_bits INTEGER NOT NULL,
            hex_output TEXT NOT NULL,
            chsh_value REAL NOT NULL,
            is_quantum_certified BOOLEAN NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS ix_qrng_results_result_id ON qrng_results(result_id)",

        # ------------------------------------------------------------------
        # generic_records
        # ------------------------------------------------------------------
        """CREATE TABLE IF NOT EXISTS generic_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            namespace VARCHAR(120) NOT NULL,
            record_id VARCHAR(64) NOT NULL,
            data JSON NOT NULL DEFAULT '{}',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT uq_generic_ns_rid UNIQUE (namespace, record_id)
        )""",
        "CREATE INDEX IF NOT EXISTS ix_generic_records_namespace ON generic_records(namespace)",
        "CREATE INDEX IF NOT EXISTS ix_generic_records_record_id ON generic_records(record_id)",
        "CREATE INDEX IF NOT EXISTS ix_generic_records_created_at ON generic_records(created_at)",
    ]

    for stmt in statements:
        try:
            conn.execute(sa.text(stmt))
        except Exception:
            # Table or index already exists — safe to skip in idempotent migration.
            pass

    # Insert Alembic version stamp manually so the migration runner knows
    # this revision has been applied even on pre-existing databases.
    # (Alembic handles this automatically when using op.* helpers, but since
    # we are using raw SQL for idempotency we still let Alembic do it via the
    # normal transaction context — no action needed here.)


def downgrade() -> None:
    # Drop tables in reverse dependency order.
    conn = op.get_bind()
    tables = [
        "generic_records",
        "qrng_results",
        "circuit_dna",
        "reproducibility_results",
        "fault_injection_results",
        "advantage_results",
        "health_forecasts",
        "evolution_runs",
        "decoherence_alerts",
        "circuit_templates",
        "gate_char_results",
        "qv_results",
        "notification_logs",
        "notification_channels",
        "api_credentials",
        "tomography_jobs",
        "cicd_checks",
        "cicd_integrations",
        "variational_runs",
        "budget_alerts",
        "circuit_versions",
        "job_submissions",
        "org_invites",
        "advice_feedback",
        "run_assertions",
        "run_metrics",
        "run_notes",
        "campaigns",
        "runs",
        "projects",
        "webhooks",
        "benchmarks",
        "audit_logs",
        "api_keys",
        "users",
        "organizations",
    ]
    for table in tables:
        conn.execute(sa.text(f"DROP TABLE IF EXISTS {table}"))
