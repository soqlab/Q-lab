"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Atom } from "lucide-react";
import { useAuth } from "../../../lib/auth";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const router = useRouter();
  const { clearSession } = useAuth();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("No verification token found. Please use the link from your email.");
      return;
    }
    fetch(`/qlab-api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(async res => {
        const data = await res.json();
        if (res.ok) {
          // Clear any existing session — user must sign in fresh after verifying
          clearSession();
          setStatus("success");
          setMessage(data.message ?? "Email verified successfully.");
        } else {
          setStatus("error");
          setMessage(data.detail ?? "Verification failed. The link may have expired.");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("Something went wrong. Please try again.");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark" style={{ width: 40, height: 40 }}>
            <Atom size={20} aria-hidden="true" />
          </div>
          <div>
            <span>Q-Lab</span>
            <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 1 }}>State of Quantum</div>
          </div>
        </div>

        <div style={{ textAlign: "center", padding: "12px 0 24px" }}>
          {status === "loading" && (
            <>
              <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
              <p style={{ color: "var(--muted)", fontSize: 14 }}>Verifying your email…</p>
            </>
          )}
          {status === "success" && (
            <>
              <div style={{ fontSize: 40, marginBottom: 16 }}>✅</div>
              <h1 className="auth-title">Email verified!</h1>
              <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 24 }}>{message}</p>
              <button
                className="button"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={() => router.push("/login")}
              >
                Sign in to Q-Lab
              </button>
            </>
          )}
          {status === "error" && (
            <>
              <div style={{ fontSize: 40, marginBottom: 16 }}>❌</div>
              <h1 className="auth-title">Verification failed</h1>
              <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 24 }}>{message}</p>
              <button
                className="button"
                onClick={() => router.push("/login")}
              >
                Back to sign in
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
