"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

const ONBOARDING_KEY = "qlab_onboarding_done";
const TOKEN_KEY = "qlab_token";

const DEMO_RUN_BODY = {
  circuit_name: "Bell State Demo",
  backend: "ibm_kyoto",
  shots: 1024,
  status: "completed",
  success_probability: 0.94,
  n_qubits: 2,
  depth: 3,
  tags: ["demo", "onboarding"],
};

const TOTAL_STEPS = 5;

interface OnboardingWizardProps {
  forceShow?: boolean;
  onDismiss?: () => void;
}

export default function OnboardingWizard({ forceShow = false, onDismiss }: OnboardingWizardProps) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(1);
  const [demoStatus, setDemoStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  useEffect(() => {
    if (forceShow) {
      setVisible(true);
      return;
    }
    if (localStorage.getItem(ONBOARDING_KEY) === "1") return;
    // Check run count
    const token = localStorage.getItem(TOKEN_KEY);
    fetch("/qlab-api/runs?limit=1", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((data) => {
        // Support both array response and paginated object
        const count = Array.isArray(data) ? data.length : (data?.total ?? data?.count ?? 0);
        if (count === 0) setVisible(true);
      })
      .catch(() => {
        // If fetch fails, show wizard anyway for new users
        setVisible(true);
      });
  }, [forceShow]);

  const dismiss = useCallback(() => {
    if (!forceShow) {
      localStorage.setItem(ONBOARDING_KEY, "1");
    }
    setVisible(false);
    if (onDismiss) onDismiss();
  }, [forceShow, onDismiss]);

  const next = useCallback(() => setStep((s) => Math.min(s + 1, TOTAL_STEPS)), []);
  const back = useCallback(() => setStep((s) => Math.max(s - 1, 1)), []);

  async function submitDemoRun() {
    setDemoStatus("loading");
    const token = localStorage.getItem(TOKEN_KEY);
    try {
      const res = await fetch("/qlab-api/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(DEMO_RUN_BODY),
      });
      if (!res.ok) throw new Error("Failed");
      setDemoStatus("success");
    } catch {
      setDemoStatus("error");
    }
  }

  if (!visible) return null;

  const progress = ((step - 1) / (TOTAL_STEPS - 1)) * 100;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.8)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Onboarding Wizard"
    >
      <div
        style={{
          background: "#fff",
          color: "#111",
          borderRadius: 12,
          padding: "40px",
          maxWidth: 600,
          width: "100%",
          boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        {/* Step indicator dots */}
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 16 }}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => {
            const n = i + 1;
            const isActive = n === step;
            const isCompleted = n < step;
            return (
              <div
                key={n}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: isActive || isCompleted ? "#16a34a" : "transparent",
                  border: isActive || isCompleted ? "2px solid #16a34a" : "2px solid #aaa",
                  transition: "background 0.2s, border-color 0.2s",
                }}
                aria-label={`Step ${n}${isActive ? " (current)" : isCompleted ? " (completed)" : ""}`}
              />
            );
          })}
        </div>

        {/* Progress bar */}
        <div
          style={{
            height: 4,
            background: "#e5e7eb",
            borderRadius: 2,
            marginBottom: 32,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              background: "#16a34a",
              borderRadius: 2,
              transition: "width 0.3s ease",
            }}
          />
        </div>

        {/* Step content */}
        {step === 1 && <Step1 onNext={next} onDismiss={dismiss} />}
        {step === 2 && <Step2 onNext={next} onBack={back} />}
        {step === 3 && <Step3 onNext={next} onBack={back} demoStatus={demoStatus} onSubmitDemo={submitDemoRun} />}
        {step === 4 && <Step4 onNext={next} onBack={back} />}
        {step === 5 && <Step5 onDismiss={dismiss} router={router} />}
      </div>
    </div>
  );
}

// ─── Step 1: Welcome ────────────────────────────────────────────────────────

function Step1({ onNext, onDismiss }: { onNext: () => void; onDismiss: () => void }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>⚛️</div>
      <h2 style={{ fontSize: 28, fontWeight: 700, color: "#111", marginBottom: 8 }}>
        Welcome to Q-Lab
      </h2>
      <p style={{ fontSize: 16, color: "#6b7280", marginBottom: 12, fontWeight: 500 }}>
        The world's most complete quantum experiment tracking platform
      </p>
      <p style={{ fontSize: 15, color: "#374151", marginBottom: 32, lineHeight: 1.6 }}>
        Q-Lab automatically captures your quantum circuits, hardware calibration, and results —
        so you can focus on research, not bookkeeping. It works seamlessly with{" "}
        <strong>Qiskit</strong>, <strong>PennyLane</strong>, and <strong>Cirq</strong>.
      </p>
      <button
        onClick={onNext}
        style={{
          background: "#16a34a",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          padding: "14px 40px",
          fontSize: 16,
          fontWeight: 600,
          cursor: "pointer",
          marginBottom: 16,
          width: "100%",
          transition: "background 0.15s",
        }}
        onMouseOver={(e) => ((e.target as HTMLButtonElement).style.background = "#15803d")}
        onMouseOut={(e) => ((e.target as HTMLButtonElement).style.background = "#16a34a")}
      >
        Get Started
      </button>
      <button
        onClick={onDismiss}
        style={{
          background: "none",
          border: "none",
          color: "#9ca3af",
          fontSize: 14,
          cursor: "pointer",
          textDecoration: "underline",
        }}
      >
        Skip tour
      </button>
    </div>
  );
}

// ─── Step 2: Connect SDK ─────────────────────────────────────────────────────

const CODE_SNIPPET = `# Install
pip install "git+https://github.com/yasseennandally/Q-lab.git#subdirectory=sdk"

# Add to your Qiskit code
from qlab import QLabTracker
tracker = QLabTracker(api_key="qlab_YOUR_KEY", url="https://soqlab.com")

# That's it — Q-Lab captures everything automatically
circuit = QuantumCircuit(2)
circuit.h(0)
circuit.cx(0, 1)
job = execute(circuit, backend)  # ← captured automatically`;

function Step2({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 700, color: "#111", marginBottom: 8 }}>
        Connect Your Quantum Code
      </h2>
      <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 20 }}>
        Two lines of code. That's all it takes.
      </p>
      <pre
        style={{
          background: "#1e1e2e",
          color: "#cdd6f4",
          borderRadius: 8,
          padding: "20px",
          fontSize: 13,
          lineHeight: 1.6,
          overflowX: "auto",
          marginBottom: 20,
          fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
          border: "1px solid #313244",
        }}
      >
        {CODE_SNIPPET}
      </pre>
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 28,
        }}
      >
        {["Qiskit ✓", "PennyLane ✓", "Cirq ✓"].map((fw) => (
          <span
            key={fw}
            style={{
              background: "#dcfce7",
              color: "#166534",
              borderRadius: 20,
              padding: "4px 14px",
              fontSize: 13,
              fontWeight: 600,
              border: "1px solid #bbf7d0",
            }}
          >
            {fw}
          </span>
        ))}
      </div>
      <NavButtons onBack={onBack} onNext={onNext} />
    </div>
  );
}

// ─── Step 3: First Run ────────────────────────────────────────────────────────

function Step3({
  onNext,
  onBack,
  demoStatus,
  onSubmitDemo,
}: {
  onNext: () => void;
  onBack: () => void;
  demoStatus: "idle" | "loading" | "success" | "error";
  onSubmitDemo: () => void;
}) {
  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 700, color: "#111", marginBottom: 8 }}>
        Submit Your First Experiment
      </h2>
      <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 20 }}>
        Try it now with a Bell State demo run, or skip if you already have data.
      </p>

      <div
        style={{
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: "16px",
          marginBottom: 20,
          fontSize: 13,
          color: "#374151",
          lineHeight: 1.7,
        }}
      >
        <strong style={{ display: "block", marginBottom: 6, color: "#111" }}>
          What Q-Lab captures:
        </strong>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Circuit QASM and gate-level structure</li>
          <li>Hardware calibration data at time of execution</li>
          <li>Gate fidelity and error rates per qubit</li>
          <li>Automatic health score (0–100)</li>
        </ul>
      </div>

      {demoStatus === "idle" && (
        <div style={{ display: "flex", gap: 10, flexDirection: "column" }}>
          <button
            onClick={onSubmitDemo}
            style={{
              background: "#16a34a",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "12px 24px",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Submit a demo run
          </button>
          <button
            onClick={onNext}
            style={{
              background: "none",
              border: "1px solid #d1d5db",
              borderRadius: 8,
              padding: "11px 24px",
              fontSize: 15,
              color: "#6b7280",
              cursor: "pointer",
            }}
          >
            I already have data →
          </button>
        </div>
      )}

      {demoStatus === "loading" && (
        <div style={{ textAlign: "center", padding: "24px 0", color: "#16a34a", fontSize: 15 }}>
          <div
            style={{
              display: "inline-block",
              width: 28,
              height: 28,
              border: "3px solid #bbf7d0",
              borderTopColor: "#16a34a",
              borderRadius: "50%",
              animation: "qlab-spin 0.8s linear infinite",
              marginBottom: 12,
            }}
          />
          <style>{`@keyframes qlab-spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ margin: 0 }}>Submitting Bell State run...</p>
        </div>
      )}

      {demoStatus === "success" && (
        <div
          style={{
            background: "#dcfce7",
            border: "1px solid #86efac",
            borderRadius: 8,
            padding: "16px",
            color: "#166534",
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          ✅ Run submitted! You can find it in Run History.
        </div>
      )}

      {demoStatus === "error" && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: 8,
            padding: "16px",
            color: "#991b1b",
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          ⚠️ Submission failed. You can try again later.
        </div>
      )}

      {(demoStatus === "success" || demoStatus === "error") && (
        <div style={{ marginTop: 20 }}>
          <NavButtons onBack={onBack} onNext={onNext} />
        </div>
      )}

      {demoStatus === "idle" && (
        <div style={{ marginTop: 20 }}>
          <NavButtons onBack={onBack} onNext={undefined} />
        </div>
      )}
    </div>
  );
}

// ─── Step 4: Features ────────────────────────────────────────────────────────

const FEATURES = [
  { icon: "🔬", title: "AI Insights", desc: "Claude analyzes every experiment for bottlenecks and optimization paths." },
  { icon: "📊", title: "Health Score", desc: "Automatic 0-100 quality score computed for every run." },
  { icon: "📄", title: "DOI Minting", desc: "Cite your experiments in papers with a permanent DOI." },
  { icon: "🔍", title: "FAIR Compliance", desc: "Journal-ready data standards check built in." },
  { icon: "🤝", title: "Peer Review", desc: "Cryptographic workflow for research integrity and reproducibility." },
  { icon: "🌐", title: "Federated Registry", desc: "Share anonymized benchmarks globally with the quantum community." },
];

function Step4({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 700, color: "#111", marginBottom: 8 }}>
        What Q-Lab Can Do
      </h2>
      <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 20 }}>
        Everything you need for rigorous quantum research in one platform.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 28,
        }}
      >
        {FEATURES.map((f) => (
          <div
            key={f.title}
            style={{
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: "14px",
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 6 }}>{f.icon}</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#111", marginBottom: 4 }}>
              {f.title}
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>{f.desc}</div>
          </div>
        ))}
      </div>
      <NavButtons onBack={onBack} onNext={onNext} />
    </div>
  );
}

// ─── Step 5: All Set ──────────────────────────────────────────────────────────

const CHECKLIST = [
  "200+ research tools in the left sidebar",
  "AI-powered circuit analysis",
  "Publication-grade data export",
  "Hardware drift alerts",
  "Collaboration tools",
];

function Step5({
  onDismiss,
  router,
}: {
  onDismiss: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
      <h2 style={{ fontSize: 26, fontWeight: 700, color: "#111", marginBottom: 8 }}>
        You're All Set!
      </h2>
      <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 24 }}>
        Here's what's waiting for you in Q-Lab:
      </p>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "0 0 28px",
          textAlign: "left",
          display: "inline-block",
        }}
      >
        {CHECKLIST.map((item) => (
          <li
            key={item}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 0",
              fontSize: 15,
              color: "#374151",
              borderBottom: "1px solid #f3f4f6",
            }}
          >
            <span style={{ color: "#16a34a", fontSize: 18, flexShrink: 0 }}>✅</span>
            {item}
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button
          onClick={() => {
            onDismiss();
            router.push("/runs");
          }}
          style={{
            background: "#16a34a",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "13px 24px",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Go to Dashboard
        </button>
        <button
          onClick={onDismiss}
          style={{
            background: "none",
            border: "1px solid #d1d5db",
            borderRadius: 8,
            padding: "12px 24px",
            fontSize: 15,
            color: "#6b7280",
            cursor: "pointer",
          }}
        >
          Explore Features
        </button>
      </div>
    </div>
  );
}

// ─── Shared Nav Buttons ───────────────────────────────────────────────────────

function NavButtons({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext?: () => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <button
        onClick={onBack}
        style={{
          background: "none",
          border: "1px solid #d1d5db",
          borderRadius: 8,
          padding: "10px 20px",
          fontSize: 14,
          color: "#6b7280",
          cursor: "pointer",
        }}
      >
        ← Back
      </button>
      {onNext && (
        <button
          onClick={onNext}
          style={{
            background: "#16a34a",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "10px 24px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Next →
        </button>
      )}
    </div>
  );
}
