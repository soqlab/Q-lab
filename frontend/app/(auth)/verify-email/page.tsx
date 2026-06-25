"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Atom } from "lucide-react";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
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
              <Link href="/runs" className="button" style={{ display: "inline-flex" }}>
                Go to Q-Lab
              </Link>
            </>
          )}
          {status === "error" && (
            <>
              <div style={{ fontSize: 40, marginBottom: 16 }}>❌</div>
              <h1 className="auth-title">Verification failed</h1>
              <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 24 }}>{message}</p>
              <Link href="/runs" style={{ color: "var(--strong)", fontSize: 14 }}>
                Back to Q-Lab
              </Link>
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
