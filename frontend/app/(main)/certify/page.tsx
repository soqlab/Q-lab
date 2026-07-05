"use client";

import { useState, useEffect, useCallback } from "react";
import {
  certifyAdvantage,
  listCertifications,
  getCertification,
  type CertificationResult,
} from "@/lib/api";

type CertListItem = {
  cert_id: string;
  name: string;
  certified: boolean;
  speedup_factor: number;
  p_value: number;
  created_at: string;
};

function CertifiedBanner({ certified }: { certified: boolean }) {
  return certified ? (
    <div style={{ borderRadius: 16, background: "rgba(2,44,34,0.9)", border: "1px solid var(--ok)", padding: 24, textAlign: "center" }}>
      <div style={{ fontSize: 48, fontWeight: 900, color: "var(--ok)", marginBottom: 4 }}>CERTIFIED</div>
      <div style={{ color: "var(--ok)", fontSize: 24 }}>&#10003;</div>
    </div>
  ) : (
    <div style={{ borderRadius: 16, background: "rgba(69,10,10,0.9)", border: "1px solid var(--danger)", padding: 24, textAlign: "center" }}>
      <div style={{ fontSize: 48, fontWeight: 900, color: "var(--danger)", marginBottom: 4 }}>NOT CERTIFIED</div>
      <div style={{ color: "var(--danger)", fontSize: 24 }}>&#10007;</div>
    </div>
  );
}

function CertDetailPanel({
  cert,
  onClose,
}: {
  cert: CertificationResult;
  onClose: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)", padding: 16 }}>
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, width: "100%", maxWidth: 672, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: 20, borderBottom: "1px solid var(--line)" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              {cert.certified ? (
                <span style={{ fontSize: 12, background: "rgba(6,78,59,0.6)", color: "var(--ok)", padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}>
                  Certified
                </span>
              ) : (
                <span style={{ fontSize: 12, background: "rgba(127,29,29,0.6)", color: "var(--danger)", padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}>
                  Not Certified
                </span>
              )}
              <span style={{ fontSize: 12, color: "var(--muted)", textTransform: "capitalize" }}>{cert.claim_type.replace(/_/g, " ")}</span>
            </div>
            <h2 style={{ color: "var(--text)", fontWeight: 600, fontSize: 18 }}>{cert.name}</h2>
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
              {cert.backend} &middot; {cert.n_qubits} qubits &middot; {cert.statistical_test}
            </p>
          </div>
          <button onClick={onClose} style={{ color: "var(--muted)", fontSize: 20, lineHeight: 1, marginLeft: 16, background: "none", border: "none", cursor: "pointer" }}>
            &times;
          </button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Key metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            <div style={{ background: "var(--surface)", borderRadius: 12, padding: 12, textAlign: "center" }}>
              <p style={{ fontSize: 24, fontWeight: 700, color: "var(--strong)" }}>{cert.speedup_factor.toFixed(2)}x</p>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Speedup Factor</p>
            </div>
            <div style={{ background: "var(--surface)", borderRadius: 12, padding: 12, textAlign: "center" }}>
              <p style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>{cert.p_value.toExponential(2)}</p>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>p-value</p>
            </div>
            <div style={{ background: "var(--surface)", borderRadius: 12, padding: 12, textAlign: "center" }}>
              <p style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>{cert.test_statistic.toFixed(4)}</p>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Test Statistic</p>
            </div>
          </div>

          {/* Runtimes */}
          <div style={{ background: "var(--surface)", borderRadius: 12, padding: 16 }}>
            <h3 style={{ color: "var(--muted)", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Runtime Comparison</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, textAlign: "center" }}>
              <div>
                <p style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{cert.classical_runtime_sec}s</p>
                <p style={{ fontSize: 12, color: "var(--muted)" }}>Classical Runtime</p>
              </div>
              <div>
                <p style={{ fontSize: 18, fontWeight: 700, color: "var(--strong)" }}>{cert.quantum_runtime_sec}s</p>
                <p style={{ fontSize: 12, color: "var(--muted)" }}>Quantum Runtime</p>
              </div>
            </div>
          </div>

          {/* Methodology notes */}
          {(cert.methodology_notes ?? []).length > 0 && (
            <div>
              <h3 style={{ color: "var(--muted)", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Methodology Notes</h3>
              <ul style={{ display: "flex", flexDirection: "column", gap: 4, listStyle: "none", padding: 0, margin: 0 }}>
                {(cert.methodology_notes ?? []).map((note, i) => (
                  <li key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: "var(--text)" }}>
                    <span style={{ color: "var(--muted)", flexShrink: 0 }}>•</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Certificate link */}
          {cert.certificate_url && (
            <a
              href={cert.certificate_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#059669", color: "white", fontSize: 13, padding: "8px 16px", borderRadius: 8, fontWeight: 500, textDecoration: "none" }}
            >
              Download Certificate
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CertifyPage() {
  // Form state
  const [name, setName] = useState("");
  const [claimType, setClaimType] = useState<"speedup" | "sampling_advantage" | "optimization">("speedup");
  const [backend, setBackend] = useState("ibmq_manila");
  const [nQubits, setNQubits] = useState(5);
  const [classicalRuntime, setClassicalRuntime] = useState<number | "">("");
  const [quantumRuntime, setQuantumRuntime] = useState<number | "">("");
  const [statisticalTest, setStatisticalTest] = useState<"cross_entropy" | "total_variation" | "linear_xeb">("cross_entropy");
  const [confidenceLevel, setConfidenceLevel] = useState(0.95);
  const [evidenceRunIds, setEvidenceRunIds] = useState("");

  const [certifying, setCertifying] = useState(false);
  const [certError, setCertError] = useState<string | null>(null);
  const [certResult, setCertResult] = useState<CertificationResult | null>(null);

  // Certifications list
  const [certsList, setCertsList] = useState<CertListItem[]>([]);
  const [certsLoading, setCertsLoading] = useState(true);
  const [certsError, setCertsError] = useState<string | null>(null);

  // Detail panel
  const [selectedCert, setSelectedCert] = useState<CertificationResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const speedupFactor =
    classicalRuntime !== "" && quantumRuntime !== "" && Number(quantumRuntime) > 0
      ? (Number(classicalRuntime) / Number(quantumRuntime)).toFixed(2)
      : null;

  const loadCertifications = useCallback(async () => {
    setCertsLoading(true);
    setCertsError(null);
    try {
      const data = await listCertifications();
      setCertsList(data);
    } catch {
      setCertsError("Failed to load certifications.");
    } finally {
      setCertsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCertifications();
  }, [loadCertifications]);

  async function handleCertify(e: React.FormEvent) {
    e.preventDefault();
    setCertifying(true);
    setCertError(null);
    setCertResult(null);
    try {
      const result = await certifyAdvantage({
        name,
        claim_type: claimType,
        backend,
        n_qubits: nQubits,
        classical_runtime_sec: Number(classicalRuntime),
        quantum_runtime_sec: Number(quantumRuntime),
        statistical_test: statisticalTest,
        confidence_level: confidenceLevel,
        evidence_run_ids: evidenceRunIds.split(",").map((id) => id.trim()).filter(Boolean),
      });
      setCertResult(result);
      void loadCertifications();
    } catch (err) {
      setCertError(err instanceof Error ? err.message : "Certification failed.");
    } finally {
      setCertifying(false);
    }
  }

  async function handleSelectCert(certId: string) {
    setDetailLoading(true);
    try {
      const detail = await getCertification(certId);
      setSelectedCert(detail);
    } catch {
      const fallback = certsList.find((c) => c.cert_id === certId);
      if (fallback) {
        setSelectedCert({
          cert_id: fallback.cert_id,
          name: fallback.name,
          certified: fallback.certified,
          speedup_factor: fallback.speedup_factor,
          p_value: fallback.p_value,
          created_at: fallback.created_at,
          claim_type: "",
          backend: "",
          n_qubits: 0,
          classical_runtime_sec: 0,
          quantum_runtime_sec: 0,
          statistical_test: "",
          test_statistic: 0,
          confidence_level: 0,
          methodology_notes: [],
        });
      }
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", color: "var(--text)", padding: 24 }}>
      {selectedCert && (
        <CertDetailPanel cert={selectedCert} onClose={() => setSelectedCert(null)} />
      )}

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>Quantum Advantage Certifier</h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
          Rigorous statistical certification of quantum computational advantage.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 32, marginBottom: 40 }}>
        {/* Certification form */}
        <div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 20 }}>New Certification</h2>
            <form onSubmit={handleCertify} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Experiment Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Bell State Supremacy Claim"
                  className="input"
                  required
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Claim Type</label>
                  <select
                    value={claimType}
                    onChange={(e) => setClaimType(e.target.value as typeof claimType)}
                    className="input"
                  >
                    <option value="speedup">Speedup</option>
                    <option value="sampling_advantage">Sampling Advantage</option>
                    <option value="optimization">Optimization</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Backend</label>
                  <select value={backend} onChange={(e) => setBackend(e.target.value)} className="input">
                    <option value="ibmq_manila">ibmq_manila</option>
                    <option value="ibmq_nairobi">ibmq_nairobi</option>
                    <option value="ibmq_kyoto">ibmq_kyoto</option>
                    <option value="ibmq_brisbane">ibmq_brisbane</option>
                    <option value="aer_simulator">aer_simulator</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Number of Qubits: <span style={{ color: "var(--strong)", fontWeight: 600 }}>{nQubits}</span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={127}
                  value={nQubits}
                  onChange={(e) => setNQubits(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--strong)" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginTop: 2 }}><span>1</span><span>127</span></div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Classical Runtime (sec)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.001}
                    value={classicalRuntime}
                    onChange={(e) => setClassicalRuntime(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="3600"
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Quantum Runtime (sec)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.001}
                    value={quantumRuntime}
                    onChange={(e) => setQuantumRuntime(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="1.2"
                    className="input"
                    required
                  />
                </div>
              </div>

              {/* Live speedup */}
              {speedupFactor !== null && (
                <div style={{ background: "rgba(49,46,129,0.4)", border: "1px solid var(--strong)", borderRadius: 12, padding: 12, textAlign: "center" }}>
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>Speedup Factor: </span>
                  <span style={{ color: "var(--strong)", fontSize: 24, fontWeight: 700 }}>{speedupFactor}x</span>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Statistical Test</label>
                  <select
                    value={statisticalTest}
                    onChange={(e) => setStatisticalTest(e.target.value as typeof statisticalTest)}
                    className="input"
                  >
                    <option value="cross_entropy">Cross Entropy</option>
                    <option value="total_variation">Total Variation</option>
                    <option value="linear_xeb">Linear XEB</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Confidence: <span style={{ color: "var(--strong)", fontWeight: 600 }}>{(confidenceLevel * 100).toFixed(1)}%</span>
                  </label>
                  <input
                    type="range"
                    min={0.90}
                    max={0.999}
                    step={0.001}
                    value={confidenceLevel}
                    onChange={(e) => setConfidenceLevel(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "var(--strong)", marginTop: 8 }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginTop: 2 }}><span>90.0%</span><span>99.9%</span></div>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Evidence Run IDs (comma-separated)</label>
                <input
                  value={evidenceRunIds}
                  onChange={(e) => setEvidenceRunIds(e.target.value)}
                  placeholder="run-001, run-002, run-003"
                  className="input"
                />
              </div>

              {certError && (
                <div style={{ background: "rgba(69,10,10,0.9)", border: "1px solid var(--danger)", color: "var(--danger)", borderRadius: 8, padding: "12px 16px", fontSize: 13 }}>
                  {certError}
                </div>
              )}

              <button
                type="submit"
                disabled={certifying}
                style={{ width: "100%", background: "var(--strong)", color: "white", fontWeight: 600, padding: "12px 0", borderRadius: 12, fontSize: 13, border: "none", cursor: certifying ? "not-allowed" : "pointer", opacity: certifying ? 0.5 : 1 }}
              >
                {certifying ? "Certifying…" : "Certify Advantage"}
              </button>
            </form>
          </div>
        </div>

        {/* Result panel */}
        <div>
          {certResult ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <CertifiedBanner certified={certResult.certified} />

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, textAlign: "center" }}>
                  <p style={{ fontSize: 30, fontWeight: 700, color: "var(--strong)" }}>{certResult.speedup_factor.toFixed(2)}x</p>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Speedup Factor</p>
                </div>
                <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, textAlign: "center" }}>
                  <p style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{certResult.p_value.toExponential(2)}</p>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>p-value</p>
                </div>
                <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, textAlign: "center" }}>
                  <p style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{certResult.test_statistic.toFixed(4)}</p>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Test Statistic</p>
                </div>
              </div>

              {(certResult.methodology_notes ?? []).length > 0 && (
                <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16 }}>
                  <h3 style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Methodology Notes</h3>
                  <ul style={{ display: "flex", flexDirection: "column", gap: 4, listStyle: "none", padding: 0, margin: 0 }}>
                    {(certResult.methodology_notes ?? []).map((note, i) => (
                      <li key={i} style={{ fontSize: 13, color: "var(--text)", display: "flex", gap: 8 }}>
                        <span style={{ color: "var(--muted)" }}>•</span>
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {certResult.certificate_url && (
                <a
                  href={certResult.certificate_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#059669", color: "white", fontSize: 13, padding: "10px 16px", borderRadius: 12, fontWeight: 500, textDecoration: "none", width: "100%", justifyContent: "center", boxSizing: "border-box" }}
                >
                  Download Certificate
                </a>
              )}
            </div>
          ) : (
            <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 32, height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 16, color: "var(--muted)" }}>⚛</div>
                <p style={{ color: "var(--muted)", fontSize: 13 }}>
                  Submit a certification request to see results here.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Certifications table */}
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>All Certifications</h2>
        {certsError && (
          <div style={{ marginBottom: 16, background: "rgba(69,10,10,0.9)", border: "1px solid var(--danger)", color: "var(--danger)", borderRadius: 8, padding: "12px 16px", fontSize: 13 }}>
            {certsError}
          </div>
        )}
        {certsLoading ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: "32px 0", textAlign: "center", background: "var(--surface)", borderRadius: 12, border: "1px solid var(--line)" }}>
            Loading certifications…
          </div>
        ) : certsList.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: "32px 0", textAlign: "center", background: "var(--surface)", borderRadius: 12, border: "1px solid var(--line)" }}>
            No certifications yet.
          </div>
        ) : (
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--line)" }}>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Name</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Status</th>
                  <th style={{ textAlign: "right", padding: "12px 16px" }}>Speedup</th>
                  <th style={{ textAlign: "right", padding: "12px 16px" }}>p-value</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Created</th>
                  <th style={{ padding: "12px 16px" }}></th>
                </tr>
              </thead>
              <tbody>
                {certsList.map((cert) => (
                  <tr
                    key={cert.cert_id}
                    style={{ borderBottom: "1px solid var(--line)", cursor: "pointer" }}
                    onClick={() => handleSelectCert(cert.cert_id)}
                  >
                    <td style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 500 }}>{cert.name}</td>
                    <td style={{ padding: "12px 16px" }}>
                      {cert.certified ? (
                        <span style={{ display: "inline-block", background: "rgba(6,78,59,0.6)", color: "var(--ok)", fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 999 }}>
                          Certified
                        </span>
                      ) : (
                        <span style={{ display: "inline-block", background: "rgba(127,29,29,0.6)", color: "var(--danger)", fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 999 }}>
                          Not Certified
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right", color: "var(--strong)", fontWeight: 700 }}>
                      {cert.speedup_factor.toFixed(2)}x
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right", color: "var(--muted)", fontFamily: "ui-monospace,monospace" }}>
                      {cert.p_value.toExponential(2)}
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--muted)", fontSize: 12 }}>
                      {new Date(cert.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      {detailLoading ? (
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>…</span>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--strong)" }}>View</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
