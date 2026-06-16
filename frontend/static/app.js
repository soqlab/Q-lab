let runs = [];
let metrics = null;

const runsBody = document.getElementById("runs-body");
const leftRun = document.getElementById("left-run");
const rightRun = document.getElementById("right-run");

function pct(value) {
  return `${((value || 0) * 100).toFixed(1)}%`;
}

function ratioPct(value) {
  if (value === null || value === undefined) return "n/a";
  return `${((value || 0) * 100).toFixed(1)}%`;
}

function statusClass(status) {
  return status && status.toLowerCase().includes("fail") ? "status failed" : "status";
}

function runLabel(run) {
  return `${run.circuit_name || run.run_id.slice(0, 8)} (${run.project || "no project"})`;
}

function jobLabel(run) {
  return run.execution?.job_id || run.execution?.job_class || "";
}

async function api(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function loadRuns() {
  const params = currentFilterParams();
  updateExportLinks(params);

  runs = await api(`/api/v1/runs?${params.toString()}`);
  metrics = await api(`/api/v1/metrics/runs?${params.toString()}`);
  renderMetrics();
  renderAnalytics();
  renderRuns();
  renderRunOptions();
}

function currentFilterParams() {
  const params = new URLSearchParams();
  for (const id of ["backend", "status", "project"]) {
    const value = document.getElementById(id).value.trim();
    if (value) params.set(id, value);
  }
  return params;
}

function updateExportLinks(params) {
  const suffix = params.toString() ? `?${params.toString()}` : "";
  document.getElementById("export-csv").href = `/api/v1/exports/runs.csv${suffix}`;
  document.getElementById("export-jsonl").href = `/api/v1/exports/runs.jsonl${suffix}`;
  document.getElementById("export-report").href = `/api/v1/reports/runs.md${suffix}`;
}

function renderMetrics() {
  document.getElementById("metric-runs").textContent = metrics?.total_runs ?? runs.length;
  document.getElementById("metric-depth").textContent = metrics?.max_depth ?? 0;
  document.getElementById("metric-qubits").textContent = metrics?.max_qubits ?? 0;
  document.getElementById("metric-projects").textContent = Object.keys(metrics?.by_project || {}).length;
  document.getElementById("metric-completion").textContent = ratioPct(metrics?.completion_rate);
  document.getElementById("metric-results").textContent = ratioPct(metrics?.result_capture_rate);
  document.getElementById("metric-failures").textContent = ratioPct(metrics?.failure_rate);
  document.getElementById("metric-success").textContent = ratioPct(metrics?.average_success_probability);
}

function renderAnalytics() {
  renderBars("status-mix", metrics?.by_status || {});
  renderBars("backend-mix", metrics?.by_backend || {});
  renderBars("gate-mix", metrics?.gate_counts || {});
}

function renderBars(id, values) {
  const container = document.getElementById(id);
  const entries = Object.entries(values).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!entries.length) {
    container.innerHTML = `<div class="empty">No data.</div>`;
    return;
  }

  const max = Math.max(...entries.map((entry) => entry[1]), 1);
  container.innerHTML = entries
    .map(([label, value]) => {
      const width = Math.max(3, (value / max) * 100);
      return `
        <div class="bar-row">
          <span>${escapeHtml(label)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
          <strong>${value}</strong>
        </div>
      `;
    })
    .join("");
}

function renderRuns() {
  if (!runs.length) {
    runsBody.innerHTML = `<tr><td colspan="9" class="empty">No runs found.</td></tr>`;
    return;
  }

  runsBody.innerHTML = runs
    .map(
      (run) => `
      <tr>
        <td><a href="#detail" data-run-id="${run.run_id}">${run.circuit_name || run.run_id.slice(0, 8)}</a></td>
        <td>${run.project || ""}</td>
        <td>${run.backend || ""}</td>
        <td>${jobLabel(run)}</td>
        <td><span class="${statusClass(run.status)}">${run.status}</span></td>
        <td>${run.fingerprint?.num_qubits ?? ""}</td>
        <td>${run.fingerprint?.depth ?? ""}</td>
        <td>${pct(run.fingerprint?.non_clifford_ratio)}</td>
        <td>${new Date(run.created_at).toLocaleString()}</td>
      </tr>
    `,
    )
    .join("");

  runsBody.querySelectorAll("[data-run-id]").forEach((link) => {
    link.addEventListener("click", () => showRun(link.dataset.runId));
  });
}

function renderRunOptions() {
  const options = runs
    .map((run) => `<option value="${run.run_id}">${runLabel(run)}</option>`)
    .join("");
  leftRun.innerHTML = options;
  rightRun.innerHTML = options;
  if (runs[1]) rightRun.value = runs[1].run_id;
}

async function showRun(runId) {
  const run = await api(`/api/v1/runs/${runId}`);
  document.getElementById("detail").classList.remove("hidden");
  document.getElementById("detail-title").textContent = run.circuit_name || run.run_id;
  document.getElementById("detail-actions").innerHTML = `
    <a class="button" href="/api/v1/runs/${run.run_id}/bundle.zip">Bundle</a>
    <a class="button secondary" href="/api/v1/runs/${run.run_id}/qasm">QASM</a>
    <a class="button secondary" href="/api/v1/runs/${run.run_id}/rerun.py">Rerun</a>
  `;
  document.getElementById("detail-body").innerHTML = `
    <div class="detail-grid">
      <div>
        <pre class="code">${escapeHtml(run.qasm || "QASM not available for this run.")}</pre>
      </div>
      <div>
        <pre class="code">${escapeHtml(JSON.stringify(run.fingerprint || {}, null, 2))}</pre>
      </div>
    </div>
    <div class="detail-grid">
      <pre class="code">${escapeHtml(JSON.stringify(run.parameters || {}, null, 2))}</pre>
      <pre class="code">${escapeHtml(JSON.stringify(run.context || {}, null, 2))}</pre>
    </div>
    <div class="detail-grid">
      <pre class="code">${escapeHtml(JSON.stringify(run.execution || {}, null, 2))}</pre>
      <pre class="code">${escapeHtml(JSON.stringify(run.results || {}, null, 2))}</pre>
    </div>
    <div class="detail-grid">
      <pre class="code">${escapeHtml(JSON.stringify({
        run_id: run.run_id,
        status: run.status,
        backend: run.backend,
        project: run.project,
        tags: run.tags,
      }, null, 2))}</pre>
    </div>
  `;
}

async function compareSelectedRuns() {
  if (!leftRun.value || !rightRun.value) return;
  const result = await api(`/api/v1/runs/compare/${leftRun.value}/${rightRun.value}/json`);
  const summary = Object.entries(result.summary)
    .map(([key, same]) => `<div><span>${key.replaceAll("_", " ")}</span><strong>${same ? "Same" : "Diff"}</strong></div>`)
    .join("");
  document.getElementById("compare-output").innerHTML = `
    <div class="metrics">${summary}</div>
    <div class="detail-grid">
      <pre class="code">${escapeHtml(JSON.stringify(result.fingerprint_diff, null, 2))}</pre>
      <pre class="code">${escapeHtml(JSON.stringify(result.parameter_diff, null, 2))}</pre>
    </div>
    <div class="detail-grid">
      <pre class="code">${escapeHtml(JSON.stringify(result.execution_diff || {}, null, 2))}</pre>
      <pre class="code">${escapeHtml(JSON.stringify(result.result_diff || {}, null, 2))}</pre>
    </div>
    <div class="detail-grid">
      <pre class="code">${escapeHtml(JSON.stringify(result.metadata_diff || {}, null, 2))}</pre>
    </div>
    <pre class="code">${escapeHtml(result.qasm_diff || "No QASM differences.")}</pre>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.getElementById("refresh").addEventListener("click", loadRuns);
document.getElementById("filter").addEventListener("click", loadRuns);
document.getElementById("compare-button").addEventListener("click", compareSelectedRuns);

loadRuns().catch((error) => {
  runsBody.innerHTML = `<tr><td colspan="8" class="empty">${escapeHtml(error.message)}</td></tr>`;
});
