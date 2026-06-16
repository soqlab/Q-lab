"use client";

import { useEffect, useState } from "react";
import { Split } from "lucide-react";
import { fetchAEMD, type AEMDComponent, type AEMDResult } from "../../../../lib/api";

const VERDICT_LABEL: Record<AEMDResult["verdict"], string> = {
  hardware_limited: "Hardware limited",
  algorithm_limited: "Algorithm limited",
  mixed: "Mixed cause",
};

export default function AEMDPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<AEMDResult | null>(null);

  useEffect(() => {
    fetchAEMD(runId).then(setData).catch(() => setData(null));
  }, [runId]);

  if (!data) return null;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Split size={16} aria-hidden="true" />
          AEMD Error Deconvolution
        </h2>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          {VERDICT_LABEL[data.verdict]}
        </span>
      </div>
      <div style={{ padding: "14px 18px", display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <Attribution label="Hardware" value={data.hardware_attribution_pct} color="var(--danger)" />
          <Attribution label="Algorithmic residual" value={data.algorithmic_attribution_pct} color="var(--warn)" />
          <Metric label="Observed success" value={`${(data.observed_success * 100).toFixed(1)}%`} />
          <Metric label="Hardware prediction" value={`${(data.predicted_success_from_hardware * 100).toFixed(1)}%`} />
        </div>

        <div style={{ display: "grid", gap: 7 }}>
          {data.components.slice(0, 5).map((component) => <ComponentBar key={component.source} component={component} />)}
        </div>

        {data.logical_signals.length > 0 && (
          <div style={{ border: "1px solid var(--warn)", background: "var(--warn-bg)", color: "var(--warn)", borderRadius: 6, padding: "8px 10px", fontSize: 12 }}>
            {data.logical_signals.join(" ")}
          </div>
        )}

        <div style={{ fontSize: 11, color: "var(--muted)" }}>{data.note}</div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function Attribution({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>
        <span>{label}</span>
        <span>{value.toFixed(1)}%</span>
      </div>
      <div style={{ height: 8, background: "var(--line)", borderRadius: 999, marginTop: 6 }}>
        <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, value))}%`, background: color, borderRadius: 999 }} />
      </div>
    </div>
  );
}

function ComponentBar({ component }: { component: AEMDComponent }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 48px", gap: 8, alignItems: "center", fontSize: 12 }}>
      <span style={{ color: "var(--text)", fontWeight: 600 }}>{component.label}</span>
      <div style={{ height: 7, background: "var(--line)", borderRadius: 999 }}>
        <div style={{ height: "100%", width: `${Math.max(2, Math.min(100, component.pct_of_physical))}%`, background: "#64748b", borderRadius: 999 }} />
      </div>
      <span style={{ textAlign: "right", color: "var(--muted)" }}>{component.pct_of_physical.toFixed(0)}%</span>
      <span style={{ gridColumn: "2 / 4", color: "var(--muted)", fontSize: 11 }}>{component.detail}</span>
    </div>
  );
}
