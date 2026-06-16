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
    <div className="rounded-2xl bg-emerald-950 border border-emerald-700 p-6 text-center">
      <div className="text-5xl font-black text-emerald-400 mb-1">CERTIFIED</div>
      <div className="text-emerald-500 text-2xl">&#10003;</div>
    </div>
  ) : (
    <div className="rounded-2xl bg-red-950 border border-red-800 p-6 text-center">
      <div className="text-5xl font-black text-red-400 mb-1">NOT CERTIFIED</div>
      <div className="text-red-500 text-2xl">&#10007;</div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between p-5 border-b border-gray-800">
          <div>
            <div className="flex items-center gap-2 mb-1">
              {cert.certified ? (
                <span className="text-xs bg-emerald-900/60 text-emerald-300 px-2 py-0.5 rounded-full font-semibold">
                  Certified
                </span>
              ) : (
                <span className="text-xs bg-red-900/60 text-red-300 px-2 py-0.5 rounded-full font-semibold">
                  Not Certified
                </span>
              )}
              <span className="text-xs text-gray-500 capitalize">{cert.claim_type.replace(/_/g, " ")}</span>
            </div>
            <h2 className="text-gray-100 font-semibold text-lg">{cert.name}</h2>
            <p className="text-gray-500 text-xs mt-0.5">
              {cert.backend} &middot; {cert.n_qubits} qubits &middot; {cert.statistical_test}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xl leading-none ml-4">
            &times;
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Key metrics */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-900 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-indigo-400">{cert.speedup_factor.toFixed(2)}x</p>
              <p className="text-xs text-gray-500 mt-1">Speedup Factor</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-gray-100">{cert.p_value.toExponential(2)}</p>
              <p className="text-xs text-gray-500 mt-1">p-value</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-gray-100">{cert.test_statistic.toFixed(4)}</p>
              <p className="text-xs text-gray-500 mt-1">Test Statistic</p>
            </div>
          </div>

          {/* Runtimes */}
          <div className="bg-gray-900 rounded-xl p-4">
            <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-3">Runtime Comparison</h3>
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <p className="text-lg font-bold text-gray-200">{cert.classical_runtime_sec}s</p>
                <p className="text-xs text-gray-500">Classical Runtime</p>
              </div>
              <div>
                <p className="text-lg font-bold text-indigo-400">{cert.quantum_runtime_sec}s</p>
                <p className="text-xs text-gray-500">Quantum Runtime</p>
              </div>
            </div>
          </div>

          {/* Methodology notes */}
          {cert.methodology_notes.length > 0 && (
            <div>
              <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-2">Methodology Notes</h3>
              <ul className="space-y-1">
                {cert.methodology_notes.map((note, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-300">
                    <span className="text-gray-600 flex-shrink-0">•</span>
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
              className="inline-flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
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

  const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500";

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      {selectedCert && (
        <CertDetailPanel cert={selectedCert} onClose={() => setSelectedCert(null)} />
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Quantum Advantage Certifier</h1>
        <p className="text-gray-500 text-sm mt-1">
          Rigorous statistical certification of quantum computational advantage.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mb-10">
        {/* Certification form */}
        <div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-gray-100 mb-5">New Certification</h2>
            <form onSubmit={handleCertify} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Experiment Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Bell State Supremacy Claim"
                  className={inputCls}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Claim Type</label>
                  <select
                    value={claimType}
                    onChange={(e) => setClaimType(e.target.value as typeof claimType)}
                    className={inputCls}
                  >
                    <option value="speedup">Speedup</option>
                    <option value="sampling_advantage">Sampling Advantage</option>
                    <option value="optimization">Optimization</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Backend</label>
                  <select value={backend} onChange={(e) => setBackend(e.target.value)} className={inputCls}>
                    <option value="ibmq_manila">ibmq_manila</option>
                    <option value="ibmq_nairobi">ibmq_nairobi</option>
                    <option value="ibmq_kyoto">ibmq_kyoto</option>
                    <option value="ibmq_brisbane">ibmq_brisbane</option>
                    <option value="aer_simulator">aer_simulator</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">
                  Number of Qubits: <span className="text-indigo-400 font-semibold">{nQubits}</span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={127}
                  value={nQubits}
                  onChange={(e) => setNQubits(Number(e.target.value))}
                  className="w-full accent-indigo-500"
                />
                <div className="flex justify-between text-xs text-gray-600 mt-0.5"><span>1</span><span>127</span></div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Classical Runtime (sec)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.001}
                    value={classicalRuntime}
                    onChange={(e) => setClassicalRuntime(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="3600"
                    className={inputCls}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Quantum Runtime (sec)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.001}
                    value={quantumRuntime}
                    onChange={(e) => setQuantumRuntime(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="1.2"
                    className={inputCls}
                    required
                  />
                </div>
              </div>

              {/* Live speedup */}
              {speedupFactor !== null && (
                <div className="bg-indigo-950/40 border border-indigo-800 rounded-xl p-3 text-center">
                  <span className="text-gray-400 text-sm">Speedup Factor: </span>
                  <span className="text-indigo-400 text-2xl font-bold">{speedupFactor}x</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Statistical Test</label>
                  <select
                    value={statisticalTest}
                    onChange={(e) => setStatisticalTest(e.target.value as typeof statisticalTest)}
                    className={inputCls}
                  >
                    <option value="cross_entropy">Cross Entropy</option>
                    <option value="total_variation">Total Variation</option>
                    <option value="linear_xeb">Linear XEB</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">
                    Confidence: <span className="text-indigo-400 font-semibold">{(confidenceLevel * 100).toFixed(1)}%</span>
                  </label>
                  <input
                    type="range"
                    min={0.90}
                    max={0.999}
                    step={0.001}
                    value={confidenceLevel}
                    onChange={(e) => setConfidenceLevel(Number(e.target.value))}
                    className="w-full accent-indigo-500 mt-2"
                  />
                  <div className="flex justify-between text-xs text-gray-600 mt-0.5"><span>90.0%</span><span>99.9%</span></div>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Evidence Run IDs (comma-separated)</label>
                <input
                  value={evidenceRunIds}
                  onChange={(e) => setEvidenceRunIds(e.target.value)}
                  placeholder="run-001, run-002, run-003"
                  className={inputCls}
                />
              </div>

              {certError && (
                <div className="bg-red-950 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm">
                  {certError}
                </div>
              )}

              <button
                type="submit"
                disabled={certifying}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
              >
                {certifying ? "Certifying…" : "Certify Advantage"}
              </button>
            </form>
          </div>
        </div>

        {/* Result panel */}
        <div>
          {certResult ? (
            <div className="space-y-4">
              <CertifiedBanner certified={certResult.certified} />

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-indigo-400">{certResult.speedup_factor.toFixed(2)}x</p>
                  <p className="text-xs text-gray-500 mt-1">Speedup Factor</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                  <p className="text-xl font-bold text-gray-100">{certResult.p_value.toExponential(2)}</p>
                  <p className="text-xs text-gray-500 mt-1">p-value</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                  <p className="text-xl font-bold text-gray-100">{certResult.test_statistic.toFixed(4)}</p>
                  <p className="text-xs text-gray-500 mt-1">Test Statistic</p>
                </div>
              </div>

              {certResult.methodology_notes.length > 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <h3 className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2">Methodology Notes</h3>
                  <ul className="space-y-1">
                    {certResult.methodology_notes.map((note, i) => (
                      <li key={i} className="text-sm text-gray-300 flex gap-2">
                        <span className="text-gray-600">•</span>
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
                  className="inline-flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 text-white text-sm px-4 py-2.5 rounded-xl font-medium transition-colors w-full justify-center"
                >
                  Download Certificate
                </a>
              )}
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 h-full flex items-center justify-center">
              <div className="text-center">
                <div className="text-5xl mb-4 text-gray-700">⚛</div>
                <p className="text-gray-600 text-sm">
                  Submit a certification request to see results here.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Certifications table */}
      <div>
        <h2 className="text-lg font-semibold text-gray-100 mb-3">All Certifications</h2>
        {certsError && (
          <div className="mb-4 bg-red-950 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm">
            {certsError}
          </div>
        )}
        {certsLoading ? (
          <div className="text-gray-500 text-sm py-8 text-center bg-gray-900 rounded-xl border border-gray-800">
            Loading certifications…
          </div>
        ) : certsList.length === 0 ? (
          <div className="text-gray-600 text-sm py-8 text-center bg-gray-900 rounded-xl border border-gray-800">
            No certifications yet.
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 font-semibold uppercase tracking-wide border-b border-gray-800">
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Speedup</th>
                  <th className="text-right px-4 py-3">p-value</th>
                  <th className="text-left px-4 py-3">Created</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {certsList.map((cert) => (
                  <tr
                    key={cert.cert_id}
                    className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40 transition-colors cursor-pointer"
                    onClick={() => handleSelectCert(cert.cert_id)}
                  >
                    <td className="px-4 py-3 text-gray-100 font-medium">{cert.name}</td>
                    <td className="px-4 py-3">
                      {cert.certified ? (
                        <span className="inline-block bg-emerald-900/60 text-emerald-300 text-xs font-semibold px-2 py-0.5 rounded-full">
                          Certified
                        </span>
                      ) : (
                        <span className="inline-block bg-red-900/60 text-red-300 text-xs font-semibold px-2 py-0.5 rounded-full">
                          Not Certified
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-indigo-400 font-bold tabular-nums">
                      {cert.speedup_factor.toFixed(2)}x
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 font-mono tabular-nums">
                      {cert.p_value.toExponential(2)}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(cert.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {detailLoading ? (
                        <span className="text-xs text-gray-600">…</span>
                      ) : (
                        <span className="text-xs text-indigo-400 hover:text-indigo-300">View</span>
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
