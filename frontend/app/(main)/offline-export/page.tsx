"use client";

import { useState, useEffect } from "react";
import {
  createOfflineExport,
  getOfflineExportStatus,
  getExportRequirements,
  OfflineExport,
} from "@/lib/api";

type ExportRequirements = {
  cpu_cores: number;
  ram_gb: number;
  disk_gb: number;
  os: string[];
  docker_version: string;
  notes: string[];
};

type ExportTab = "components" | "compose" | "readme";

const FORMAT_OPTIONS = [
  { value: "docker-compose", label: "Docker Compose" },
  { value: "ova", label: "OVA (VM Image)" },
  { value: "tar-gz", label: "TAR.GZ Archive" },
];

const CLASSIFICATION_OPTIONS = [
  { value: "unclassified", label: "Unclassified" },
  { value: "CUI", label: "CUI (Controlled Unclassified)" },
  { value: "SECRET", label: "SECRET" },
];

const CLASSIFICATION_STYLES: Record<string, string> = {
  unclassified: "bg-green-900 text-green-300",
  CUI: "bg-yellow-900 text-yellow-300",
  SECRET: "bg-red-900 text-red-200",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-gray-700 text-gray-300",
  building: "bg-blue-700 text-blue-200",
  ready: "bg-green-700 text-green-200",
  failed: "bg-red-700 text-red-200",
};

export default function OfflineExportPage() {
  const [requirements, setRequirements] = useState<ExportRequirements | null>(null);
  const [reqLoading, setReqLoading] = useState(true);
  const [reqError, setReqError] = useState<string | null>(null);

  // Form
  const [includeData, setIncludeData] = useState(true);
  const [includeModels, setIncludeModels] = useState(false);
  const [format, setFormat] = useState("docker-compose");
  const [classificationLevel, setClassificationLevel] = useState("unclassified");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [exportBundle, setExportBundle] = useState<OfflineExport | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [activeTab, setActiveTab] = useState<ExportTab>("components");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setReqLoading(true);
    getExportRequirements()
      .then((data) => setRequirements(data))
      .catch((e: unknown) =>
        setReqError(e instanceof Error ? e.message : "Failed to load requirements")
      )
      .finally(() => setReqLoading(false));
  }, []);

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const bundle = await createOfflineExport({
        include_data: includeData,
        include_models: includeModels,
        format,
        classification_level: classificationLevel,
      });
      setExportBundle(bundle);
      setActiveTab("components");
    } catch (e: unknown) {
      setGenerateError(e instanceof Error ? e.message : "Failed to generate bundle");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCheckStatus() {
    if (!exportBundle) return;
    setCheckingStatus(true);
    try {
      const updated = await getOfflineExportStatus(exportBundle.export_id);
      setExportBundle(updated);
    } catch {
      // silently ignore refresh errors
    } finally {
      setCheckingStatus(false);
    }
  }

  function copyChecksum() {
    if (!exportBundle?.checksum) return;
    navigator.clipboard.writeText(exportBundle.checksum).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function Toggle({
    value,
    onChange,
    label,
  }: {
    value: boolean;
    onChange: (v: boolean) => void;
    label: string;
  }) {
    return (
      <label className="flex items-center gap-3 cursor-pointer select-none">
        <div
          onClick={() => onChange(!value)}
          className={`w-10 h-5 rounded-full transition-colors ${value ? "bg-indigo-600" : "bg-gray-700"} relative shrink-0`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${value ? "translate-x-5" : ""}`}
          />
        </div>
        <span className="text-sm text-gray-300">{label}</span>
      </label>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Offline / Air-Gap Export</h1>
        <p className="text-gray-400 mt-1">
          Bundle Q-Lab for classified or disconnected networks
        </p>
      </div>

      {/* System Requirements */}
      <section>
        <h2 className="text-lg font-semibold text-gray-300 mb-3">System Requirements</h2>
        {reqLoading && <p className="text-gray-400 animate-pulse">Loading requirements...</p>}
        {reqError && (
          <p className="text-red-400 bg-red-950 border border-red-800 rounded px-4 py-2">{reqError}</p>
        )}
        {requirements && (
          <div className="bg-blue-950 border border-blue-800 rounded-xl p-5 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-xs text-blue-400 uppercase tracking-wide mb-0.5">CPU Cores</div>
                <div className="font-semibold text-white">{requirements.cpu_cores}</div>
              </div>
              <div>
                <div className="text-xs text-blue-400 uppercase tracking-wide mb-0.5">RAM</div>
                <div className="font-semibold text-white">{requirements.ram_gb} GB</div>
              </div>
              <div>
                <div className="text-xs text-blue-400 uppercase tracking-wide mb-0.5">Disk</div>
                <div className="font-semibold text-white">{requirements.disk_gb} GB</div>
              </div>
              <div>
                <div className="text-xs text-blue-400 uppercase tracking-wide mb-0.5">Docker</div>
                <div className="font-semibold text-white">{requirements.docker_version}</div>
              </div>
            </div>
            <div>
              <div className="text-xs text-blue-400 uppercase tracking-wide mb-1">Supported OS</div>
              <div className="flex flex-wrap gap-2">
                {requirements.os.map((os) => (
                  <span key={os} className="bg-blue-900 text-blue-200 text-xs px-2 py-0.5 rounded">{os}</span>
                ))}
              </div>
            </div>
            {requirements.notes.length > 0 && (
              <ul className="space-y-1">
                {requirements.notes.map((note, i) => (
                  <li key={i} className="text-xs text-blue-300">• {note}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Export Config Form */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-5">
          <h2 className="text-lg font-semibold text-gray-200">Export Configuration</h2>

          <div className="space-y-3">
            <Toggle value={includeData} onChange={setIncludeData} label="Include all experiment data" />
            <Toggle value={includeModels} onChange={setIncludeModels} label="Include ML models" />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Bundle Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {FORMAT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Classification Level</label>
            <select
              value={classificationLevel}
              onChange={(e) => setClassificationLevel(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {CLASSIFICATION_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {generateError && (
            <p className="text-red-400 bg-red-950 border border-red-800 rounded px-3 py-2 text-sm">
              {generateError}
            </p>
          )}

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors"
          >
            {generating ? "Generating Bundle..." : "Generate Bundle"}
          </button>
        </section>

        {/* Export Card */}
        {exportBundle && (
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold text-gray-200">Export Bundle</h2>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded font-semibold ${STATUS_STYLES[exportBundle.status] ?? "bg-gray-700 text-gray-300"}`}
                >
                  {exportBundle.status}
                  {exportBundle.status === "building" && (
                    <span className="ml-1 animate-pulse">...</span>
                  )}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-semibold ${CLASSIFICATION_STYLES[exportBundle.classification_level ?? ""] ?? "bg-gray-700 text-gray-300"}`}
                >
                  {exportBundle.classification_level ?? ""}
                </span>
              </div>
            </div>

            <div className="text-sm text-gray-400">
              Estimated size:{" "}
              <span className="text-gray-200 font-medium">{exportBundle.estimated_size_mb} MB</span>
            </div>

            {/* Checksum */}
            {exportBundle.checksum && (
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-gray-800 text-green-300 font-mono text-xs px-3 py-1.5 rounded truncate">
                  {exportBundle.checksum}
                </code>
                <button
                  onClick={copyChecksum}
                  className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1.5 rounded transition-colors shrink-0"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 border-b border-gray-800">
              {(["components", "compose", "readme"] as ExportTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeTab === tab
                      ? "border-b-2 border-indigo-500 text-indigo-400"
                      : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {tab === "components" ? "Components" : tab === "compose" ? "Docker Compose" : "README"}
                </button>
              ))}
            </div>

            {activeTab === "components" && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-800">
                      <th className="text-left pb-2">Component</th>
                      <th className="text-right pb-2">Size (MB)</th>
                      <th className="text-right pb-2">Included</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exportBundle.components?.map((c) => (
                      <tr key={c.name} className="border-b border-gray-800 last:border-0">
                        <td className="py-2 text-gray-200">{c.name}</td>
                        <td className="py-2 text-right text-gray-400">{c.size_mb}</td>
                        <td className="py-2 text-right">
                          {c.included ? (
                            <span className="text-green-400">✓</span>
                          ) : (
                            <span className="text-gray-600">✗</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === "compose" && (
              <pre className="bg-gray-950 border border-gray-700 rounded p-4 text-green-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap max-h-72">
                {exportBundle.docker_compose_yaml ?? "Not available yet"}
              </pre>
            )}

            {activeTab === "readme" && (
              <pre className="bg-gray-950 border border-gray-700 rounded p-4 text-gray-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap max-h-72">
                {exportBundle.readme ?? "Not available yet"}
              </pre>
            )}

            <button
              onClick={handleCheckStatus}
              disabled={checkingStatus}
              className="w-full bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {checkingStatus ? "Checking..." : "Check Status"}
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
