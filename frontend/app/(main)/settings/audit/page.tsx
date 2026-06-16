"use client";

import { useEffect, useState } from "react";
import { getAuditLog, AuditLogEntry } from "../../../../lib/api";

const ACTION_ICONS: Record<string, string> = {
  "rbac.role_changed": "👤",
  "run.deleted": "🗑️",
  "run.created": "✓",
  "webhook.triggered": "⚡",
};

export default function AuditPage() {
  const [items, setItems] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterResource, setFilterResource] = useState("");
  const LIMIT = 50;

  const load = (off = 0) => {
    setLoading(true);
    getAuditLog({ action: filterAction || undefined, resource_type: filterResource || undefined, limit: LIMIT, offset: off })
      .then(r => { setItems(r.items); setTotal(r.total); setOffset(off); setErr(""); })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(0); }, [filterAction, filterResource]);

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Audit Log</h1>
        <button className="btn" onClick={() => load(offset)}>Refresh</button>
      </div>

      {err && <div className="alert alert-error" style={{ marginBottom: 16 }}>{err}</div>}

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input
          className="input"
          style={{ width: 200 }}
          placeholder="Filter by action..."
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
        />
        <input
          className="input"
          style={{ width: 180 }}
          placeholder="Resource type..."
          value={filterResource}
          onChange={e => setFilterResource(e.target.value)}
        />
        <span style={{ fontSize: 13, color: "#9ca3af", alignSelf: "center" }}>
          {total.toLocaleString()} events
        </span>
      </div>

      <div className="panel">
        {loading ? (
          <div style={{ padding: 20, color: "#9ca3af" }}>Loading audit log...</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "#6b7280" }}>No audit events found.</div>
        ) : (
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1f2937" }}>
                {["Time", "Action", "Resource", "Resource ID", "User ID", "IP", "Meta"].map(h => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#9ca3af", fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} style={{ borderBottom: "1px solid #111827" }}>
                  <td style={{ padding: "8px 10px", color: "#9ca3af", whiteSpace: "nowrap" }}>
                    {new Date(item.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <span>{ACTION_ICONS[item.action] ?? "•"} {item.action}</span>
                  </td>
                  <td style={{ padding: "8px 10px", color: "#9ca3af" }}>{item.resource_type ?? "—"}</td>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace", color: "#9ca3af" }}>{item.resource_id ?? "—"}</td>
                  <td style={{ padding: "8px 10px", color: "#9ca3af" }}>{item.user_id ?? "—"}</td>
                  <td style={{ padding: "8px 10px", color: "#9ca3af" }}>{item.ip_address ?? "—"}</td>
                  <td style={{ padding: "8px 10px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.meta ? (
                      <span title={JSON.stringify(item.meta)} style={{ color: "#6b7280", cursor: "help" }}>
                        {JSON.stringify(item.meta).slice(0, 60)}{JSON.stringify(item.meta).length > 60 ? "…" : ""}
                      </span>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "center" }}>
          <button className="btn" disabled={offset === 0} onClick={() => load(Math.max(0, offset - LIMIT))}>← Prev</button>
          <span style={{ fontSize: 13, color: "#9ca3af", alignSelf: "center" }}>
            {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
          </span>
          <button className="btn" disabled={offset + LIMIT >= total} onClick={() => load(offset + LIMIT)}>Next →</button>
        </div>
      )}
    </div>
  );
}
