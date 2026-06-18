"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Meter {
  used: number;
  limit: number;
  unlimited: boolean;
  pct: number;
}

interface UsageResponse {
  billing_enabled: boolean;
  stripe_configured: boolean;
  month: string;
  plan: string;
  runs: Meter;
  api_calls: Meter;
  qpu_seconds: Meter;
  storage_mb: Meter;
  ai_insights: Meter;
}

interface PlanInfo {
  slug: string;
  name: string;
  runs: number;
  api_calls: number;
  qpu_seconds: number;
  ai_insights: number;
  price_usd: number;
  features: string[];
}

interface PlansResponse {
  billing_enabled: boolean;
  stripe_configured: boolean;
  plans: Record<string, PlanInfo>;
}

interface Invoice {
  month: string;
  plan: string;
  runs: number;
  api_calls: number;
  qpu_seconds: number;
  ai_insights: number;
  storage_mb: number;
  amount_usd: number;
  status: string;
  simulated: boolean;
}

interface InvoicesResponse {
  billing_enabled: boolean;
  stripe_configured: boolean;
  invoices: Invoice[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatQPU(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function formatMonth(ym: string): string {
  if (!ym) return "—";
  const [year, month] = ym.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleString("default", { month: "long", year: "numeric" });
}

function meterColor(pct: number): string {
  if (pct >= 0.85) return "#e74c3c";
  if (pct >= 0.6) return "#f59e0b";
  return "#27ae60";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProgressBar({ pct, unlimited }: { pct: number; unlimited: boolean }) {
  if (unlimited) {
    return (
      <div style={{ background: "#f0f3f7", borderRadius: 4, height: 8, overflow: "hidden" }}>
        <div style={{ width: "100%", background: "#6366f1", height: "100%", borderRadius: 4, opacity: 0.4 }} />
      </div>
    );
  }
  const color = meterColor(pct);
  return (
    <div style={{ background: "#f0f3f7", borderRadius: 4, height: 8, overflow: "hidden" }}>
      <div
        style={{
          width: `${Math.min(pct * 100, 100)}%`,
          background: color,
          height: "100%",
          borderRadius: 4,
          transition: "width 0.4s",
        }}
      />
    </div>
  );
}

function UsageCard({
  label,
  meter,
  formatted,
  limitFormatted,
}: {
  label: string;
  meter: Meter;
  formatted: string;
  limitFormatted: string;
}) {
  const color = meter.unlimited ? "#6366f1" : meterColor(meter.pct);
  return (
    <div className="panel" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, color: "#5f6f80", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
        {formatted}
      </div>
      <div style={{ fontSize: 12, color: "#9aa8b6" }}>
        {meter.unlimited ? "Unlimited" : `of ${limitFormatted}`}
      </div>
      <ProgressBar pct={meter.pct} unlimited={meter.unlimited} />
      {!meter.unlimited && meter.pct >= 0.85 && (
        <div style={{ fontSize: 12, color: "#e74c3c", fontWeight: 600 }}>
          {meter.pct >= 1 ? "Limit reached" : "Approaching limit"}
        </div>
      )}
    </div>
  );
}

function PlanCard({
  plan,
  currentPlan,
  stripeConfigured,
  billingEnabled,
  onUpgrade,
  upgrading,
}: {
  plan: PlanInfo;
  currentPlan: string;
  stripeConfigured: boolean;
  billingEnabled: boolean;
  onUpgrade: (slug: string) => void;
  upgrading: boolean;
}) {
  const isCurrent = plan.slug === currentPlan;
  const isDowngrade =
    (currentPlan === "enterprise" && plan.slug !== "enterprise") ||
    (currentPlan === "pro" && plan.slug === "free");

  const accentColor =
    plan.slug === "enterprise" ? "#6366f1" : plan.slug === "pro" ? "#1d6f8f" : "#374151";

  return (
    <div
      className="panel"
      style={{
        padding: "20px 22px",
        border: isCurrent ? `2px solid ${accentColor}` : undefined,
        position: "relative",
      }}
    >
      {isCurrent && (
        <div
          style={{
            position: "absolute",
            top: -1,
            right: 14,
            background: accentColor,
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            padding: "3px 10px",
            borderRadius: "0 0 6px 6px",
            letterSpacing: "0.05em",
          }}
        >
          CURRENT
        </div>
      )}
      <div style={{ fontSize: 18, fontWeight: 700, color: accentColor, marginBottom: 4 }}>
        {plan.name}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: "#0d1b2a", marginBottom: 14 }}>
        {plan.price_usd === 0 ? "Free" : `$${plan.price_usd}`}
        {plan.price_usd > 0 && (
          <span style={{ fontSize: 14, fontWeight: 400, color: "#5f6f80" }}> / month</span>
        )}
      </div>
      <ul style={{ margin: "0 0 18px", padding: "0 0 0 16px", fontSize: 13, color: "#374151", lineHeight: 1.8 }}>
        {plan.features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      {!isCurrent && !isDowngrade && (
        stripeConfigured ? (
          <button
            className="button"
            style={{ background: accentColor, borderColor: accentColor, width: "100%" }}
            onClick={() => onUpgrade(plan.slug)}
            disabled={upgrading}
          >
            {upgrading ? "Processing…" : `Upgrade to ${plan.name}`}
          </button>
        ) : (
          <div>
            <a
              href={`mailto:contact@soqlab.com?subject=Interested in Q-Lab ${plan.name} Plan`}
              className="button"
              style={{ display: "block", textAlign: "center", textDecoration: "none", background: accentColor, borderColor: accentColor }}
            >
              Join the Waitlist
            </a>
            <p style={{ fontSize: 11, color: "#9aa8b6", textAlign: "center", margin: "8px 0 0" }}>
              Premium plans coming soon — we&apos;ll be in touch.
            </p>
          </div>
        )
      )}
      {isCurrent && (
        <div
          style={{
            fontSize: 13,
            color: accentColor,
            fontWeight: 600,
            textAlign: "center",
            padding: "8px 0",
          }}
        >
          Your current plan
        </div>
      )}
      {isDowngrade && !isCurrent && (
        <div style={{ fontSize: 12, color: "#9aa8b6", textAlign: "center" }}>
          Contact support to downgrade
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function BillingPageInner() {
  const { token } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const paymentSuccess = searchParams.get("success") === "true";
  const paymentCanceled = searchParams.get("canceled") === "true";

  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [plansData, setPlansData] = useState<PlansResponse | null>(null);
  const [invoicesData, setInvoicesData] = useState<InvoicesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeMsg, setUpgradeMsg] = useState<string | null>(paymentSuccess ? "Payment successful! Your plan has been upgraded." : null);
  const [upgradeErr, setUpgradeErr] = useState<string | null>(paymentCanceled ? "Payment canceled — your plan was not changed." : null);

  useEffect(() => {
    if (token === undefined) return;
    if (!token) { router.push("/login"); return; }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};
      const [usageRes, plansRes, invoicesRes] = await Promise.all([
        fetch("/qlab-api/billing/usage", { headers }),
        fetch("/qlab-api/billing/plans", { headers }),
        fetch("/qlab-api/billing/invoices", { headers }),
      ]);
      if (!usageRes.ok) throw new Error(`Usage fetch failed: ${usageRes.status}`);
      if (!plansRes.ok) throw new Error(`Plans fetch failed: ${plansRes.status}`);
      const [u, p, inv] = await Promise.all([
        usageRes.json() as Promise<UsageResponse>,
        plansRes.json() as Promise<PlansResponse>,
        invoicesRes.ok ? (invoicesRes.json() as Promise<InvoicesResponse>) : Promise.resolve({ billing_enabled: false, stripe_configured: false, invoices: [] }),
      ]);
      setUsage(u);
      setPlansData(p);
      setInvoicesData(inv);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing data");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpgrade(planSlug: string) {
    if (!token) return;
    setUpgrading(true);
    setUpgradeMsg(null);
    setUpgradeErr(null);
    try {
      // If Stripe is configured → create checkout session and redirect
      if (stripeConfigured) {
        const res = await fetch("/qlab-api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ plan: planSlug }),
        });
        const data = await res.json() as { checkout_url?: string; detail?: string };
        if (!res.ok) { setUpgradeErr(data.detail ?? "Checkout failed"); return; }
        if (data.checkout_url) { window.location.href = data.checkout_url; return; }
      }
      // Fallback: simulate (no Stripe key)
      const res = await fetch("/qlab-api/billing/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: planSlug }),
      });
      const data = await res.json() as { message?: string; detail?: string };
      if (!res.ok) { setUpgradeErr(data.detail ?? "Upgrade failed"); return; }
      setUpgradeMsg(data.message ?? `Switched to ${planSlug} plan.`);
      await load();
    } catch {
      setUpgradeErr("Network error during upgrade");
    } finally {
      setUpgrading(false);
    }
  }

  async function handleManageSubscription() {
    if (!token) return;
    try {
      const res = await fetch("/qlab-api/billing/portal", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as { portal_url?: string; detail?: string };
      if (!res.ok) { setUpgradeErr(data.detail ?? "Could not open portal"); return; }
      if (data.portal_url) window.location.href = data.portal_url;
    } catch {
      setUpgradeErr("Could not open Stripe portal");
    }
  }

  const billingEnabled = usage?.billing_enabled ?? plansData?.billing_enabled ?? false;
  const stripeConfigured = usage?.stripe_configured ?? plansData?.stripe_configured ?? false;
  const currentPlan = usage?.plan ?? "free";

  return (
    <main className="page">
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 4,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Billing &amp; Usage</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {usage && (
            <div style={{ fontSize: 13, color: "#5f6f80", background: "var(--panel-2, #f7f8fa)", padding: "4px 12px", borderRadius: 999 }}>
              {formatMonth(usage.month)}
            </div>
          )}
          {stripeConfigured && currentPlan !== "free" && (
            <button className="button secondary" style={{ fontSize: 13, padding: "6px 14px" }} onClick={handleManageSubscription}>
              Manage Subscription
            </button>
          )}
        </div>
      </div>

      {/* Tracking-only banner */}
      {!billingEnabled && !loading && (
        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: 8,
            padding: "10px 16px",
            fontSize: 13,
            color: "#92400e",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 16 }}>ℹ</span>
          <span>
            <strong>Usage tracking only</strong> — limits are not enforced. Set{" "}
            <code
              style={{
                background: "#fef3c7",
                padding: "1px 5px",
                borderRadius: 3,
                fontSize: 12,
              }}
            >
              QLAB_BILLING_ENABLED=true
            </code>{" "}
            to activate plan enforcement.
          </span>
        </div>
      )}

      {error && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 8,
            padding: "10px 16px",
            fontSize: 13,
            color: "#b91c1c",
          }}
        >
          {error}
        </div>
      )}

      {loading && <div className="empty">Loading billing data…</div>}

      {!loading && usage && (
        <>
          {/* Usage KPI cards */}
          <section className="panel" style={{ padding: 0 }}>
            <div className="panel-header">
              <h2>This Month&apos;s Usage</h2>
              <span
                style={{
                  fontSize: 12,
                  background: billingEnabled ? "#eaf6ef" : "#f7f8fa",
                  color: billingEnabled ? "#1f8a5b" : "#5f6f80",
                  padding: "3px 10px",
                  borderRadius: 999,
                  fontWeight: 600,
                }}
              >
                {billingEnabled ? "Limits enforced" : "Tracking only"}
              </span>
            </div>
            <div
              style={{
                padding: "16px 18px",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              <UsageCard
                label="Experiment Runs"
                meter={usage.runs}
                formatted={usage.runs.used.toLocaleString()}
                limitFormatted={usage.runs.unlimited ? "∞" : usage.runs.limit.toLocaleString()}
              />
              <UsageCard
                label="API Calls"
                meter={usage.api_calls}
                formatted={usage.api_calls.used.toLocaleString()}
                limitFormatted={usage.api_calls.unlimited ? "∞" : usage.api_calls.limit.toLocaleString()}
              />
              <UsageCard
                label="QPU Time"
                meter={usage.qpu_seconds}
                formatted={formatQPU(usage.qpu_seconds.used)}
                limitFormatted={
                  usage.qpu_seconds.unlimited
                    ? "∞"
                    : formatQPU(usage.qpu_seconds.limit)
                }
              />
              <UsageCard
                label="AI Insights"
                meter={usage.ai_insights}
                formatted={usage.ai_insights.used.toLocaleString()}
                limitFormatted={
                  usage.ai_insights.unlimited ? "∞" : usage.ai_insights.limit.toLocaleString()
                }
              />
              <UsageCard
                label="Storage"
                meter={usage.storage_mb}
                formatted={`${usage.storage_mb.used.toFixed(1)} MB`}
                limitFormatted="Unlimited"
              />
            </div>
          </section>

          {/* Upgrade / plan feedback messages */}
          {upgradeMsg && (
            <div
              style={{
                background: "#eaf6ef",
                border: "1px solid #c0e8d0",
                borderRadius: 8,
                padding: "10px 16px",
                fontSize: 13,
                color: "#1f8a5b",
                fontWeight: 600,
              }}
            >
              {upgradeMsg}
            </div>
          )}
          {upgradeErr && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 8,
                padding: "10px 16px",
                fontSize: 13,
                color: "#b91c1c",
              }}
            >
              {upgradeErr}
            </div>
          )}
        </>
      )}

      {/* Plan cards */}
      {!loading && plansData && (
        <section className="panel" style={{ padding: 0 }}>
          <div className="panel-header">
            <h2>Plans</h2>
            {!stripeConfigured && (
              <span style={{ fontSize: 12, color: "#9aa8b6" }}>
                Stripe not configured — upgrades simulated
              </span>
            )}
          </div>
          <div
            style={{
              padding: "16px 18px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 16,
            }}
          >
            {Object.values(plansData.plans).map((plan) => (
              <PlanCard
                key={plan.slug}
                plan={plan}
                currentPlan={currentPlan}
                stripeConfigured={stripeConfigured}
                billingEnabled={billingEnabled}
                onUpgrade={handleUpgrade}
                upgrading={upgrading}
              />
            ))}
          </div>
        </section>
      )}

      {/* Usage history / invoices */}
      {!loading && invoicesData && invoicesData.invoices.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <h2>Usage History</h2>
            {!billingEnabled && (
              <span style={{ fontSize: 12, color: "#9aa8b6" }}>
                Cost shown as $0.00 while billing is disabled
              </span>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Plan</th>
                  <th style={{ textAlign: "right" }}>Runs</th>
                  <th style={{ textAlign: "right" }}>API Calls</th>
                  <th style={{ textAlign: "right" }}>QPU Time</th>
                  <th style={{ textAlign: "right" }}>AI Insights</th>
                  <th style={{ textAlign: "right" }}>Cost</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoicesData.invoices.map((inv) => (
                  <tr key={inv.month}>
                    <td style={{ fontWeight: 600 }}>{formatMonth(inv.month)}</td>
                    <td style={{ textTransform: "capitalize" }}>{inv.plan}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {inv.runs.toLocaleString()}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {inv.api_calls.toLocaleString()}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {formatQPU(inv.qpu_seconds)}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {inv.ai_insights.toLocaleString()}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 600,
                        color: inv.amount_usd === 0 ? "#9aa8b6" : "#0d1b2a",
                      }}
                    >
                      ${inv.amount_usd.toFixed(2)}
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          background:
                            inv.status === "paid"
                              ? "#eaf6ef"
                              : inv.status === "tracking_only"
                              ? "#f7f8fa"
                              : "#fffbeb",
                          color:
                            inv.status === "paid"
                              ? "#1f8a5b"
                              : inv.status === "tracking_only"
                              ? "#5f6f80"
                              : "#92400e",
                        }}
                      >
                        {inv.status === "tracking_only" ? "Tracking" : inv.status}
                        {inv.simulated && " (sim)"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!loading && invoicesData && invoicesData.invoices.length === 0 && (
        <section className="panel">
          <div className="panel-header"><h2>Usage History</h2></div>
          <div className="empty" style={{ padding: "24px 18px" }}>
            No usage history yet. Data will appear here after the current month.
          </div>
        </section>
      )}

      {/* Stripe not configured notice */}
      {!loading && !stripeConfigured && (
        <section className="panel" style={{ background: "linear-gradient(135deg, #0d1b2a 0%, #1d3557 100%)", border: "none" }}>
          <div
            style={{
              padding: "20px 24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 16,
            }}
          >
            <div>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>
                Premium plans coming soon
              </div>
              <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4, maxWidth: 480 }}>
                We&apos;re working on Pro and Enterprise plans. Join the waitlist and we&apos;ll notify you when they launch.
              </div>
            </div>
            <a
              href="mailto:contact@soqlab.com?subject=Q-Lab Premium Waitlist"
              className="button"
              style={{
                background: "#6366f1",
                borderColor: "#6366f1",
                color: "#fff",
                textDecoration: "none",
              }}
            >
              Join Waitlist
            </a>
          </div>
        </section>
      )}
    </main>
  );
}

export default function BillingPage() {
  return (
    <Suspense>
      <BillingPageInner />
    </Suspense>
  );
}
