// Sign in with SOQLAB: one passkey, made at id.soqlab.com, for Q-Lab and SOQLAB's other products.
//
// Off unless the server is configured (GET /auth/passkeys/config → soqlab_id). The browser goes to
// id.soqlab.com and comes back to /soqlab-callback with a one-time code. No cookies: the tab that
// started the round trip keeps a random `flow` secret in sessionStorage, and the server only
// accepts the code together with it (so a code can't be planted in someone else's browser).

import { apiUrl, type AuthResponse } from "./api";

const FLOW_KEY = "qlab_soqlab_flow";
const CARD_KEY = "qlab_soqlab_card_dismissed";

export type SoqlabPurpose = "login" | "signup" | "link" | "recover";

type Pending = { state: string; flow: string; purpose: SoqlabPurpose; next: string; at: number };

export type SoqlabResult = AuthResponse & {
  soqlab_linked?: boolean;
  recovery_codes_remaining?: number;
  purpose: SoqlabPurpose;
  next: string;
};

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const res = await fetch(apiUrl(path), { ...init, headers, cache: "no-store" });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: unknown };
    throw new Error(typeof err.detail === "string" ? err.detail : "SOQLAB sign-in didn't work. Try again.");
  }
  return res.json() as Promise<T>;
}

function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/runs";
}

function go(begun: { authorize_url: string; state: string; flow: string }, purpose: SoqlabPurpose, next?: string) {
  const pending: Pending = { state: begun.state, flow: begun.flow, purpose, next: safeNext(next), at: Date.now() };
  sessionStorage.setItem(FLOW_KEY, JSON.stringify(pending));
  window.location.assign(begun.authorize_url);
}

/** Sign in, or create a new Q-Lab account, with a SOQLAB passkey. Leaves the page. */
export async function startSoqlab(purpose: "login" | "signup", opts: { name?: string; orgName?: string; next?: string } = {}) {
  const begun = await call<{ authorize_url: string; state: string; flow: string }>("/auth/soqlab/start", {
    method: "POST",
    body: JSON.stringify({ purpose, name: opts.name ?? null, org_name: opts.orgName || null }),
  });
  go(begun, purpose, opts.next);
}

/**
 * Create a SOQLAB passkey for this Q-Lab account. `token` is a session from a recent sign-in, or
 * the one-step token a password or Google/GitHub sign-in gives an account without a passkey.
 */
export async function linkSoqlab(token: string, next = "/settings#signin") {
  const begun = await call<{ authorize_url: string; state: string; flow: string }>("/auth/soqlab/link-ticket", {
    method: "POST", token, body: JSON.stringify({ purpose: "link" }),
  });
  go(begun, "link", next);
}

/** Get back in with a recovery code or emailed link, ending in a SOQLAB passkey for this account. */
export async function recoverWithSoqlab(proof: { code?: string; token?: string }) {
  const begun = await call<{ authorize_url: string; state: string; flow: string }>("/auth/soqlab/link-ticket", {
    method: "POST", body: JSON.stringify({ purpose: "recover", ...proof }),
  });
  go(begun, "recover", "/settings#recovery");
}

/** Finish on /soqlab-callback: the code and state from the address, the flow secret from this tab. */
export async function finishSoqlab(code: string, state: string): Promise<SoqlabResult> {
  let pending: Pending | null = null;
  try { pending = JSON.parse(sessionStorage.getItem(FLOW_KEY) || "null") as Pending | null; } catch { pending = null; }
  sessionStorage.removeItem(FLOW_KEY);
  if (!pending || pending.state !== state || Date.now() - pending.at > 10 * 60 * 1000) {
    throw new Error("This sign-in didn't start in this tab, or took longer than 10 minutes. Start again.");
  }
  const resp = await call<AuthResponse & { soqlab_linked?: boolean; recovery_codes_remaining?: number }>(
    "/auth/soqlab/callback", { method: "POST", body: JSON.stringify({ code, state, flow: pending.flow }) },
  );
  return { ...resp, purpose: pending.purpose, next: safeNext(pending.next) };
}

export type SoqlabStatus = { linked: boolean; linked_at: string | null; has_passkey: boolean; session: string };

export async function soqlabStatus(token: string): Promise<SoqlabStatus> {
  return call("/auth/soqlab/status", { token });
}

export async function unlinkSoqlab(token: string): Promise<{ linked: boolean; remote_unlinked: boolean }> {
  return call("/auth/soqlab/link", { method: "DELETE", token });
}

/** A server error code turned into a sentence for the person. */
export function soqlabMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  switch (msg) {
    case "soqlab_not_linked":
      return "No Q-Lab account uses this SOQLAB passkey yet. Sign in with your older Q-Lab passkey and link it in Settings, or create a new account.";
    case "recent_sign_in_required":
      return "For your safety, sign in again first, then create the SOQLAB passkey within 10 minutes.";
    case "passkey_session_required":
      return "Sign in with your passkey first, then try again.";
    default:
      return msg || "SOQLAB sign-in didn't work. Try again.";
  }
}

/** The one-time card offering a SOQLAB passkey, once dismissed, stays dismissed in this browser. */
export function soqlabCardDismissed(userId: number): boolean {
  try { return localStorage.getItem(`${CARD_KEY}:${userId}`) === "1"; } catch { return true; }
}

export function dismissSoqlabCard(userId: number) {
  try { localStorage.setItem(`${CARD_KEY}:${userId}`, "1"); } catch { /* private mode: it shows again next time */ }
}
