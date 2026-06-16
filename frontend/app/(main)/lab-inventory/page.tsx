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

const statusColor: Record<string, string> = {
  operational: "bg-green-900/40 text-green-400 border border-green-800",
  maintenance: "bg-yellow-900/40 text-yellow-400 border border-yellow-800",
  failed: "bg-red-900/40 text-red-400 border border-red-800",
  decommissioned: "bg-gray-700/60 text-gray-400 border border-gray-600",
};

const categoryColor: Record<string, string> = {
  cryostat: "bg-blue-900/40 text-blue-400 border border-blue-800",
  microwave: "bg-purple-900/40 text-purple-400 border border-purple-800",
  control_electronics: "bg-orange-900/40 text-orange-400 border border-orange-800",
  software: "bg-teal-900/40 text-teal-400 border border-teal-800",
  consumable: "bg-gray-700/60 text-gray-400 border border-gray-600",
};

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

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Lab Inventory</h1>
          <p className="text-gray-400 mt-1 text-sm">Equipment tracking and maintenance scheduling</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleViewSchedule}
            className="bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-3 py-2 text-sm transition-colors"
          >
            View Schedule
          </button>
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="bg-indigo-600 hover:bg-indigo-500 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
          >
            {showAddForm ? "Cancel" : "+ Add Equipment"}
          </button>
        </div>
      </div>

      {/* Add Equipment Form */}
      {showAddForm && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-indigo-400">New Equipment</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { label: "Name", value: addName, set: setAddName, type: "text" },
              { label: "Model", value: addModel, set: setAddModel, type: "text" },
              { label: "Serial Number", value: addSerial, set: setAddSerial, type: "text" },
              { label: "Location", value: addLocation, set: setAddLocation, type: "text" },
              { label: "Purchase Date", value: addPurchaseDate, set: setAddPurchaseDate, type: "date" },
              { label: "Warranty Expires", value: addWarranty, set: setAddWarranty, type: "date" },
            ].map(({ label, value, set, type }) => (
              <div key={label}>
                <label className="block text-xs text-gray-400 mb-1">{label}</label>
                <input
                  type={type}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
            ))}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Category</label>
              <select value={addCategory} onChange={(e) => setAddCategory(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Status</label>
              <select value={addStatus} onChange={(e) => setAddStatus(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500">
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Linked Backends (comma-sep)</label>
              <input type="text" value={addBackends} onChange={(e) => setAddBackends(e.target.value)} placeholder="ibm_brisbane, ibm_kyoto" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Notes</label>
            <textarea value={addNotes} onChange={(e) => setAddNotes(e.target.value)} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
          </div>
          {addError && <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{addError}</div>}
          <button onClick={handleAddItem} disabled={addingItem || !addName || !addModel || !addSerial} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-4 py-2 text-sm font-medium transition-colors">
            {addingItem ? "Adding…" : "Add Equipment"}
          </button>
        </div>
      )}

      {/* Maintenance Schedule */}
      {showSchedule && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-indigo-400">Maintenance Schedule</h2>
            <button onClick={() => setShowSchedule(false)} className="text-xs text-gray-500 hover:text-gray-300">Close</button>
          </div>
          {loadingSchedule ? (
            <div className="text-sm text-gray-400 animate-pulse">Loading schedule…</div>
          ) : scheduleError ? (
            <div className="text-red-400 text-sm">{scheduleError}</div>
          ) : schedule.length === 0 ? (
            <div className="text-sm text-gray-500">No scheduled maintenance.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-800">
                  <th className="pb-2 font-medium">Item</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Next Due</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((s, i) => (
                  <tr key={i} className="border-b border-gray-800/50">
                    <td className="py-2 pr-4 text-xs">{s.item_name}</td>
                    <td className="py-2 pr-4 text-xs capitalize">{s.type}</td>
                    <td className="py-2 pr-4 text-xs font-mono">{new Date(s.next_due).toLocaleDateString()}</td>
                    <td className="py-2">
                      {s.overdue ? (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-900/40 text-red-400 border border-red-800">Overdue</span>
                      ) : (
                        <span className="text-xs text-gray-400">Upcoming</span>
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Equipment List */}
        <div className="space-y-3">
          {/* Filters */}
          <div className="flex gap-2">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-xs text-gray-100 focus:outline-none focus:border-indigo-500"
            >
              <option value="">All Categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-xs text-gray-100 focus:outline-none focus:border-indigo-500"
            >
              <option value="">All Statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {loadingItems ? (
            <div className="text-sm text-gray-400 animate-pulse">Loading equipment…</div>
          ) : itemsError ? (
            <div className="text-red-400 text-sm">{itemsError}</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-gray-500">No equipment found.</div>
          ) : (
            <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
              {items.map((item) => (
                <div
                  key={item.item_id}
                  onClick={() => handleSelectItem(item.item_id)}
                  className={`bg-gray-900 border rounded-lg p-3 cursor-pointer transition-colors space-y-2 ${selectedItem?.item_id === item.item_id ? "border-indigo-600" : "border-gray-800 hover:border-gray-600"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-tight">{item.name}</p>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${statusColor[item.status] ?? "bg-gray-700 text-gray-400"}`}>
                      {item.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${categoryColor[item.category] ?? "bg-gray-700 text-gray-400"}`}>
                      {item.category}
                    </span>
                    <span className="text-xs text-gray-500">{item.model}</span>
                  </div>
                  <p className="text-xs text-gray-500">{item.location}</p>
                  {item.next_maintenance && (
                    <p className={`text-xs ${isOverdue(item.next_maintenance) ? "text-red-400 font-medium" : "text-gray-400"}`}>
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
        <div className="lg:col-span-2">
          {loadingItem ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-sm text-gray-400 animate-pulse">Loading item…</div>
          ) : selectedItem ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">{selectedItem.name}</h2>
                  <p className="text-sm text-gray-400">{selectedItem.model}</p>
                </div>
                <div className="flex gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${categoryColor[selectedItem.category] ?? "bg-gray-700 text-gray-400"}`}>{selectedItem.category}</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${statusColor[selectedItem.status] ?? "bg-gray-700 text-gray-400"}`}>{selectedItem.status}</span>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 border-b border-gray-800">
                {(["details", "log"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === tab ? "text-indigo-400 border-b-2 border-indigo-500 -mb-px" : "text-gray-400 hover:text-gray-200"}`}
                  >
                    {tab === "details" ? "Details" : "Log Maintenance"}
                  </button>
                ))}
              </div>

              {activeTab === "details" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      { label: "Serial Number", value: selectedItem.serial_number },
                      { label: "Location", value: selectedItem.location },
                      { label: "Purchase Date", value: selectedItem.purchase_date ? new Date(selectedItem.purchase_date).toLocaleDateString() : "—" },
                      { label: "Warranty Expires", value: selectedItem.warranty_expires ? new Date(selectedItem.warranty_expires).toLocaleDateString() : "—" },
                      { label: "Last Maintenance", value: selectedItem.last_maintenance ? new Date(selectedItem.last_maintenance).toLocaleDateString() : "—" },
                      { label: "Next Maintenance", value: selectedItem.next_maintenance ? new Date(selectedItem.next_maintenance).toLocaleDateString() : "—" },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-gray-800 rounded-lg px-3 py-2">
                        <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                        <p className="text-sm text-gray-100">{value}</p>
                      </div>
                    ))}
                  </div>

                  {selectedItem.linked_backends.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-2">Linked Backends</p>
                      <div className="flex flex-wrap gap-2">
                        {selectedItem.linked_backends.map((b) => (
                          <span key={b} className="text-xs px-2 py-1 bg-indigo-900/40 text-indigo-400 border border-indigo-800 rounded-full">{b}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedItem.notes && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Notes</p>
                      <p className="text-sm text-gray-300">{selectedItem.notes}</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "log" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Type</label>
                      <select value={logType} onChange={(e) => setLogType(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500">
                        {MAINT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Performed By</label>
                      <input type="text" value={logPerformedBy} onChange={(e) => setLogPerformedBy(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Duration (hours)</label>
                      <input type="number" min={0} step={0.5} value={logDuration} onChange={(e) => setLogDuration(Number(e.target.value))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Cost (USD)</label>
                      <input type="number" min={0} value={logCost} onChange={(e) => setLogCost(Number(e.target.value))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Parts Replaced (comma-sep)</label>
                      <input type="text" value={logParts} onChange={(e) => setLogParts(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Next Due</label>
                      <input type="date" value={logNextDue} onChange={(e) => setLogNextDue(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Description</label>
                    <textarea value={logDescription} onChange={(e) => setLogDescription(e.target.value)} rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" />
                  </div>
                  {logError && <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{logError}</div>}
                  {logSuccess && <div className="text-green-400 text-sm bg-green-900/20 border border-green-800 rounded-lg px-3 py-2">Maintenance logged successfully.</div>}
                  <button onClick={handleLogMaintenance} disabled={loggingMaint || !logDescription || !logPerformedBy} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-4 py-2 text-sm font-medium transition-colors">
                    {loggingMaint ? "Logging…" : "Log Maintenance"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 flex items-center justify-center h-64">
              <p className="text-gray-500 text-sm">Select an equipment item to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
