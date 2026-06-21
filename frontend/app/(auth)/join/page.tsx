"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle, LogIn, UserPlus } from "lucide-react";
import { acceptInvite, validateInvite, type InviteInfo } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

function JoinInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("token") ?? "";
  const router = useRouter();
  const { token: authToken, user } = useAuth();

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [validating, setValidating] = useState(true);
  const [validError, setValidError] = useState<string | null>(null);

  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    if (!inviteToken) { setValidError("No invite token provided."); setValidating(false); return; }
    void validateInvite(inviteToken)
      .then(d => { setInfo(d); setValidating(false); })
      .catch(err => { setValidError(err instanceof Error ? err.message : "Invalid invite"); setValidating(false); });
  }, [inviteToken]);

  async function handleAccept() {
    if (!authToken) {
      router.push(`/login?redirect=/join?token=${encodeURIComponent(inviteToken)}`);
      return;
    }
    setAccepting(true);
    setAcceptError(null);
    try {
      await acceptInvite(authToken, inviteToken);
      setAccepted(true);
      setTimeout(() => router.push("/runs"), 2500);
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : "Failed to accept invite");
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg, #0d1b2a 0%, #1a3a5c 100%)",
      fontFamily: "Inter, Segoe UI, Arial, sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 440, margin: "0 auto", padding: "0 24px" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>Q-Lab</div>
          <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>Quantum Systems of Record</div>
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: "36px 32px", boxShadow: "0 20px 60px rgba(0,0,0,0.35)" }}>
          {validating && (
            <div style={{ textAlign: "center", color: "#5f6f80", padding: "24px 0" }}>Validating invite…</div>
          )}

          {validError && (
            <>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#e74c3c", marginBottom: 8 }}>Invite invalid</div>
                <div style={{ color: "#5f6f80", fontSize: 14 }}>{validError}</div>
              </div>
              <a href="/login" style={{ display: "block", textAlign: "center", color: "#1d6f8f", fontSize: 14 }}>Go to login →</a>
            </>
          )}

          {accepted && (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <CheckCircle size={48} style={{ color: "#27ae60", marginBottom: 16 }} />
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Welcome to the team!</div>
              <div style={{ color: "#5f6f80", fontSize: 14 }}>Redirecting to dashboard…</div>
            </div>
          )}

          {!validating && !validError && !accepted && info && (
            <>
              <div style={{ textAlign: "center", marginBottom: 28 }}>
                <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
                  {"You've been invited"}
                </div>
                <p style={{ color: "#5f6f80", fontSize: 14, margin: 0 }}>
                  Join <strong style={{ color: "#1d6f8f" }}>{info.org_name}</strong> as a{" "}
                  <strong style={{ textTransform: "capitalize" }}>{info.role}</strong>
                </p>
                <p style={{ color: "#9aa8b6", fontSize: 12, marginTop: 6 }}>
                  Invite for: {info.email} · Expires {new Date(info.expires_at).toLocaleDateString()}
                </p>
              </div>

              {acceptError && (
                <div className="auth-error" style={{ marginBottom: 16 }}>{acceptError}</div>
              )}

              {user ? (
                <>
                  <div style={{ background: "#f7f8fa", borderRadius: 10, padding: "12px 16px", marginBottom: 18, fontSize: 13, color: "#5f6f80" }}>
                    Logged in as <strong>{user.email}</strong>
                  </div>
                  <button
                    className="button"
                    style={{ width: "100%", height: 44, fontSize: 15 }}
                    onClick={() => void handleAccept()}
                    disabled={accepting}
                  >
                    <CheckCircle size={16} />
                    {accepting ? "Joining…" : `Accept & join ${info.org_name}`}
                  </button>
                  <div style={{ textAlign: "center", marginTop: 14, fontSize: 13, color: "#9aa8b6" }}>
                    Not you?{" "}
                    <a href="/login" style={{ color: "#1d6f8f" }}>Switch account</a>
                  </div>
                </>
              ) : (
                <>
                  <a
                    href={`/login?redirect=${encodeURIComponent(`/join?token=${inviteToken}`)}`}
                    className="button"
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", height: 44, fontSize: 15, textDecoration: "none", marginBottom: 10 }}
                  >
                    <LogIn size={16} /> Log in to accept
                  </a>
                  <a
                    href={`/register?email=${encodeURIComponent(info.email)}&redirect=${encodeURIComponent(`/join?token=${inviteToken}`)}`}
                    className="button secondary"
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", height: 44, fontSize: 15, textDecoration: "none" }}
                  >
                    <UserPlus size={16} /> Create new account
                  </a>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinInner />
    </Suspense>
  );
}
