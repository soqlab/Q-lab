"use client";

import { useState, useEffect, useCallback } from "react";
import {
  addEquipmentItem,
  listEquipmentItems,
  getEquipmentItem,
  logMaintenance,
  getMaintenanceSchedule,
  EquipmentItem,
  MaintenanceLog,
  MaintenanceScheduleEntry,
} from "@/lib/api";

const CATEGORIES = ["cryostat", "microwave", "control_electronics", "software", "consumable"];
const STATUSES = ["operational", "maintenance", "failed", "decommissioned"];
const MAINT_TYPES = ["preventive", "corrective", "calibration"];

type BadgeStyle = { background: string; color: string; border: string };

const STATUS_STYLES: Record<string, BadgeStyle> = {
  operational: { background: "rgba(16,185,129,0.1)", color: "var(--ok)", border: "1px solid var(--ok)" },
  maintenance: { background: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "1px solid #f59e0b" },
  failed: { background: "rgba(239,68,68,0.1)", color: "var(--danger)", border: "1px solid var(--danger)" },
  decommissioned: { background: "var(--line)", color: "var(--muted)", border: "1px solid var(--line)" },
};

const CATEGORY_STYLES: Record<string, BadgeStyle> = {
  cryostat: { background: "rgba(59,130,246,0.1)", color: "var(--info-text)", border: "1px solid rgba(59,130,246,0.4)" },
  microwave: { background: "rgba(139,92,246,0.1)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.4)" },
  control_electronics: { background: "rgba(249,115,22,0.1)", color: "#f97316", border: "1px solid rgba(249,115,22,0.4)" },
  software: { background: "rgba(20,184,166,0.1)", color: "#2dd4bf", border: "1px solid rgba(20,184,166,0.4)" },
  consumable: { background: "var(--line)", color: "var(--muted)", border: "1px solid var(--line)" },
};

const DEFAULT_BADGE: BadgeStyle = { background: "var(--line)", color: "var(--muted)", border: "1px solid var(--line)" };

function isOverdue(date?: string) {
  if (!date) return false;
  return new Date(date) < new Date();
}

export default function LabInventoryPage() {
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [itemsError, setItemsError] = useState<string | null>(null);

  const [selectedItem, setSelectedItem] = useState<EquipmentItem | null>(null);
  const [loadingItem, setLoadingItem] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "log">("details");

  const [schedule, setSchedule] = useState<MaintenanceScheduleEntry[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);

  // Maintenance log form
  const [logType, setLogType] = useState("preventive");
  const [logDescription, setLogDescription] = useState("");
  const [logPerformedBy, setLogPerformedBy] = useState("");
  const [logDuration, setLogDuration] = useState(1);
  const [logParts, setLogParts] = useState("");
  const [logCost, setLogCost] = useState(0);
  const [logNextDue, setLogNextDue] = useState("");
  const [loggingMaint, setLoggingMaint] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logSuccess, setLogSuccess] = useState(false);

  // Add Equipment form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCategory, setAddCategory] = useState("cryostat");
  const [addModel, setAddModel] = useState("");
  const [addSerial, setAddSerial] = useState("");
  const [addLocation, setAddLocation] = useState("");
  const [addStatus, setAddStatus] = useState("operational");
  const [addPurchaseDate, setAddPurchaseDate] = useState("");
  const [addWarranty, setAddWarranty] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addBackends, setAddBackends] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setLoadingItems(true);
    setItemsError(null);
    try {
      const params: { category?: string; status?: string } = {};
      if (filterCategory) params.category = filterCategory;
      if (filterStatus) params.status = filterStatus;
      const data = await listEquipmentItems(params);
      setItems(data);
    } catch {
      setItemsError("Failed to load equipment.");
    } finally {
      setLoadingItems(false);
    }
  }, [filterCategory, filterStatus]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleSelectItem = async (id: string) => {
    setLoadingItem(true);
    try {
      const item = await getEquipmentItem(id);
      setSelectedItem(item);
      setActiveTab("details");
      setLogSuccess(false);
      setLogError(null);
    } catch {
      setSelectedItem(null);
    } finally {
      setLoadingItem(false);
    }
  };

  const handleLogMaintenance = async () => {
    if (!selectedItem) return;
    setLoggingMaint(true);
    setLogError(null);
    setLogSuccess(false);
    try {
      await logMaintenance({
        item_id: selectedItem.item_id,
        type: logType,
        description: logDescription,
        performed_by: logPerformedBy,
        duration_hours: logDuration,
        parts_replaced: logParts ? logParts.split(",").map((s) => s.trim()) : [],
        cost_usd: logCost,
        next_due: logNextDue || undefined,
      });
      setLogSuccess(true);
      setLogDescription("");
      setLogPerformedBy("");
      setLogParts("");
      setLogCost(0);
      setLogNextDue("");
      loadItems();
    } catch (e: unknown) {
      setLogError(e instanceof Error ? e.message : "Failed to log maintenance.");
    } finally {
      setLoggingMaint(false);
    }
  };

  const handleViewSchedule = async () => {
    setLoadingSchedule(true);
    setScheduleError(null);
    setShowSchedule(true);
    try {
      const data = await getMaintenanceSchedule();
      const sorted = [...data].sort((a, b) => new Date(a.next_due).getTime() - new Date(b.next_due).getTime());
      setSchedule(sorted);
    } catch {
      setScheduleError("Failed to load schedule.");
    } finally {
      setLoadingSchedule(false);
    }
  };

  const handleAddItem = async () => {
    setAddingItem(true);
    setAddError(null);
    try {
      await addEquipmentItem({
        name: addName,
        category: addCategory,
        model: addModel,
        serial_number: addSerial,
        location: addLocation,
        status: addStatus,
        purchase_date: addPurchaseDate,
        warranty_expires: addWarranty || undefined,
        notes: addNotes,
        linked_backends: addBackends ? addBackends.split(",").map((s) => s.trim()) : [],
      });
      setShowAddForm(false);
      setAddName(""); setAddModel(""); setAddSerial(""); setAddLocation(""); setAddNotes(""); setAddBackends(""); setAddWarranty("");
      loadItems();
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : "Failed to add equipment.");
    } finally {
      setAddingItem(false);
    }
  };

  const addDisabled = addingItem || !addName || !addModel || !addSerial;
  const logDisabled = loggingMaint || !logDescription || !logPerformedBy;

  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>Lab Inventory</h1>
          <p style={{ color: "var(--muted)", marginTop: 4, fontSize: 13 }}>Equipment tracking and maintenance scheduling</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleViewSchedule} className="button secondary">
            View Schedule
          </button>
          <button onClick={() => setShowAddForm((v) => !v)} className="button">
            {showAddForm ? "Cancel" : "+ Add Equipment"}
          </button>
        </div>
      </div>

      {/* Add Equipment Form */}
      {showAddForm && (
        <div className="panel" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--strong)" }}>New Equipment</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
            {[
              { label: "Name", value: addName, set: setAddName, type: "text" },
              { label: "Model", value: addModel, set: setAddModel, type: "text" },
              { label: "Serial Number", value: addSerial, set: setAddSerial, type: "text" },
              { label: "Location", value: addLocation, set: setAddLocation, type: "text" },
              { label: "Purchase Date", value: addPurchaseDate, set: setAddPurchaseDate, type: "date" },
              { label: "Warranty Expires", value: addWarranty, set: setAddWarranty, type: "date" },
            ].map(({ label, value, set, type }) => (
              <div key={label}>
                <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{label}</label>
                <input
                  type={type}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  className="input"
                  style={{ width: "100%" }}
                />
              </div>
            ))}
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Category</label>
              <select value={addCategory} onChange={(e) => setAddCategory(e.target.value)} className="input" style={{ width: "100%" }}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Status</label>
              <select value={addStatus} onChange={(e) => setAddStatus(e.target.value)} className="input" style={{ width: "100%" }}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Linked Backends (comma-sep)</label>
              <input type="text" value={addBackends} onChange={(e) => setAddBackends(e.target.value)} placeholder="ibm_brisbane, ibm_kyoto" className="input" style={{ width: "100%" }} />
            </div>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Notes</label>
            <textarea value={addNotes} onChange={(e) => setAddNotes(e.target.value)} rows={2} className="input" style={{ width: "100%" }} />
          </div>
          {addError && (
            <div style={{ color: "var(--danger)", fontSize: 13, background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 8, padding: "8px 12px" }}>
              {addError}
            </div>
          )}
          <button
            onClick={handleAddItem}
            disabled={addDisabled}
            className="button"
            style={{ opacity: addDisabled ? 0.5 : 1, cursor: addDisabled ? "not-allowed" : "pointer" }}
          >
            {addingItem ? "Adding…" : "Add Equipment"}
          </button>
        </div>
      )}

      {/* Maintenance Schedule */}
      {showSchedule && (
        <div className="panel" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--strong)" }}>Maintenance Schedule</h2>
            <button
              onClick={() => setShowSchedule(false)}
              style={{ fontSize: 12, color: "var(--muted)", background: "none", border: "none", cursor: "pointer" }}
            >
              Close
            </button>
          </div>
          {loadingSchedule ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading schedule…</div>
          ) : scheduleError ? (
            <div style={{ color: "var(--danger)", fontSize: 13 }}>{scheduleError}</div>
          ) : (schedule ?? []).length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>No scheduled maintenance.</div>
          ) : (
            <table style={{ width: "100%", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
                  <th style={{ paddingBottom: 8, fontWeight: 500 }}>Item</th>
                  <th style={{ paddingBottom: 8, fontWeight: 500 }}>Type</th>
                  <th style={{ paddingBottom: 8, fontWeight: 500 }}>Next Due</th>
                  <th style={{ paddingBottom: 8, fontWeight: 500 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {(schedule ?? []).map((s, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ paddingTop: 8, paddingBottom: 8, paddingRight: 16, fontSize: 12 }}>{s.item_name}</td>
                    <td style={{ paddingTop: 8, paddingBottom: 8, paddingRight: 16, fontSize: 12, textTransform: "capitalize" }}>{s.type}</td>
                    <td style={{ paddingTop: 8, paddingBottom: 8, paddingRight: 16, fontSize: 12, fontFamily: "ui-monospace,monospace" }}>{new Date(s.next_due).toLocaleDateString()}</td>
                    <td style={{ paddingTop: 8, paddingBottom: 8 }}>
                      {s.overdue ? (
                        <span style={{ fontSize: 12, padding: "2px 6px", borderRadius: 999, background: "rgba(239,68,68,0.1)", color: "var(--danger)", border: "1px solid var(--danger)" }}>Overdue</span>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>Upcoming</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Main two-column layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 24 }}>
        {/* LEFT: Equipment List */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Filters */}
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="input"
              style={{ flex: 1 }}
            >
              <option value="">All Categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="input"
              style={{ flex: 1 }}
            >
              <option value="">All Statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {loadingItems ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading equipment…</div>
          ) : itemsError ? (
            <div style={{ color: "var(--danger)", fontSize: 13 }}>{itemsError}</div>
          ) : (items ?? []).length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>No equipment found.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "calc(100vh - 280px)", overflowY: "auto", paddingRight: 4 }}>
              {(items ?? []).map((item) => (
                <div
                  key={item.item_id}
                  onClick={() => handleSelectItem(item.item_id)}
                  className="panel"
                  style={{
                    padding: 12,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    border: selectedItem?.item_id === item.item_id ? "1px solid var(--strong)" : "1px solid var(--line)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>{item.name}</p>
                    <span style={{ fontSize: 12, padding: "2px 6px", borderRadius: 999, flexShrink: 0, ...(STATUS_STYLES[item.status] ?? DEFAULT_BADGE) }}>
                      {item.status}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, padding: "2px 6px", borderRadius: 999, ...(CATEGORY_STYLES[item.category] ?? DEFAULT_BADGE) }}>
                      {item.category}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{item.model}</span>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--muted)" }}>{item.location}</p>
                  {item.next_maintenance && (
                    <p style={{ fontSize: 12, color: isOverdue(item.next_maintenance) ? "var(--danger)" : "var(--muted)", fontWeight: isOverdue(item.next_maintenance) ? 500 : undefined }}>
                      Next maintenance: {new Date(item.next_maintenance).toLocaleDateString()}
                      {isOverdue(item.next_maintenance) && " — OVERDUE"}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: Detail Panel */}
        <div>
          {loadingItem ? (
            <div className="panel" style={{ padding: 24, fontSize: 13, color: "var(--muted)" }}>Loading item…</div>
          ) : selectedItem ? (
            <div className="panel" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 600 }}>{selectedItem.name}</h2>
                  <p style={{ fontSize: 13, color: "var(--muted)" }}>{selectedItem.model}</p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ fontSize: 12, padding: "4px 8px", borderRadius: 999, ...(CATEGORY_STYLES[selectedItem.category] ?? DEFAULT_BADGE) }}>{selectedItem.category}</span>
                  <span style={{ fontSize: 12, padding: "4px 8px", borderRadius: 999, ...(STATUS_STYLES[selectedItem.status] ?? DEFAULT_BADGE) }}>{selectedItem.status}</span>
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)" }}>
                {(["details", "log"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: "8px 16px",
                      fontSize: 13,
                      fontWeight: 500,
                      color: activeTab === tab ? "var(--strong)" : "var(--muted)",
                      background: "none",
                      cursor: "pointer",
                      borderTop: "none",
                      borderLeft: "none",
                      borderRight: "none",
                      borderBottom: activeTab === tab ? "2px solid var(--strong)" : "2px solid transparent",
                      marginBottom: activeTab === tab ? -1 : 0,
                    }}
                  >
                    {tab === "details" ? "Details" : "Log Maintenance"}
                  </button>
                ))}
              </div>

              {activeTab === "details" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
                    {[
                      { label: "Serial Number", value: selectedItem.serial_number },
                      { label: "Location", value: selectedItem.location },
                      { label: "Purchase Date", value: selectedItem.purchase_date ? new Date(selectedItem.purchase_date).toLocaleDateString() : "—" },
                      { label: "Warranty Expires", value: selectedItem.warranty_expires ? new Date(selectedItem.warranty_expires).toLocaleDateString() : "—" },
                      { label: "Last Maintenance", value: selectedItem.last_maintenance ? new Date(selectedItem.last_maintenance).toLocaleDateString() : "—" },
                      { label: "Next Maintenance", value: selectedItem.next_maintenance ? new Date(selectedItem.next_maintenance).toLocaleDateString() : "—" },
                    ].map(({ label, value }) => (
                      <div key={label} style={{ background: "var(--line)", borderRadius: 8, padding: "8px 12px" }}>
                        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 2 }}>{label}</p>
                        <p style={{ fontSize: 13, color: "var(--text)" }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {(selectedItem.linked_backends ?? []).length > 0 && (
                    <div>
                      <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Linked Backends</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {(selectedItem.linked_backends ?? []).map((b) => (
                          <span key={b} style={{ fontSize: 12, padding: "4px 8px", background: "rgba(99,102,241,0.1)", color: "var(--strong)", border: "1px solid var(--strong)", borderRadius: 999 }}>{b}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedItem.notes && (
                    <div>
                      <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Notes</p>
                      <p style={{ fontSize: 13, color: "var(--text)" }}>{selectedItem.notes}</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "log" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Type</label>
                      <select value={logType} onChange={(e) => setLogType(e.target.value)} className="input" style={{ width: "100%" }}>
                        {MAINT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Performed By</label>
                      <input type="text" value={logPerformedBy} onChange={(e) => setLogPerformedBy(e.target.value)} className="input" style={{ width: "100%" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Duration (hours)</label>
                      <input type="number" min={0} step={0.5} value={logDuration} onChange={(e) => setLogDuration(Number(e.target.value))} className="input" style={{ width: "100%" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Cost (USD)</label>
                      <input type="number" min={0} value={logCost} onChange={(e) => setLogCost(Number(e.target.value))} className="input" style={{ width: "100%" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Parts Replaced (comma-sep)</label>
                      <input type="text" value={logParts} onChange={(e) => setLogParts(e.target.value)} className="input" style={{ width: "100%" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Next Due</label>
                      <input type="date" value={logNextDue} onChange={(e) => setLogNextDue(e.target.value)} className="input" style={{ width: "100%" }} />
                    </div>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Description</label>
                    <textarea value={logDescription} onChange={(e) => setLogDescription(e.target.value)} rows={3} className="input" style={{ width: "100%" }} />
                  </div>
                  {logError && (
                    <div style={{ color: "var(--danger)", fontSize: 13, background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 8, padding: "8px 12px" }}>
                      {logError}
                    </div>
                  )}
                  {logSuccess && (
                    <div style={{ color: "var(--ok)", fontSize: 13, background: "rgba(16,185,129,0.1)", border: "1px solid var(--ok)", borderRadius: 8, padding: "8px 12px" }}>
                      Maintenance logged successfully.
                    </div>
                  )}
                  <button
                    onClick={handleLogMaintenance}
                    disabled={logDisabled}
                    className="button"
                    style={{ opacity: logDisabled ? 0.5 : 1, cursor: logDisabled ? "not-allowed" : "pointer" }}
                  >
                    {loggingMaint ? "Logging…" : "Log Maintenance"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="panel" style={{ padding: 32, display: "flex", alignItems: "center", justifyContent: "center", height: 256 }}>
              <p style={{ color: "var(--muted)", fontSize: 13 }}>Select an equipment item to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
