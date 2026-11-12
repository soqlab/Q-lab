// Passkeys (WebAuthn) in the browser: plain navigator.credentials, no library.
// The server sends WebAuthn options as JSON (binary fields base64url); this file turns them into
// the ArrayBuffers the browser API wants and turns the authenticator's answer back into JSON.

import { apiUrl, type AuthResponse } from "./api";

export type PasskeyInfo = {
  id: number;
  name: string;
  created_at: string | null;
  last_used_at: string | null;
  backed_up: boolean;
  transports: string[];
};

export type PasskeyConfig = { passkeys_only: boolean; rp_id: string };

type Begin = { challenge_id: string; options: Record<string, unknown> };
type Descriptor = { id: string; type: string; transports?: string[] };

function toBuffer(b64url: string): ArrayBuffer {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer as ArrayBuffer;
}

function toB64url(buf: ArrayBuffer | null): string | null {
  if (!buf) return null;
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function descriptors(list: unknown): PublicKeyCredentialDescriptor[] {
  return ((list as Descriptor[] | undefined) ?? []).map((d) => ({
    id: toBuffer(d.id),
    type: "public-key",
    transports: d.transports as AuthenticatorTransport[] | undefined,
  }));
}

function creationOptions(o: Record<string, unknown>): PublicKeyCredentialCreationOptions {
  const user = o.user as { id: string; name: string; displayName: string };
  return {
    ...(o as unknown as PublicKeyCredentialCreationOptions),
    challenge: toBuffer(o.challenge as string),
    user: { ...user, id: toBuffer(user.id) },
    excludeCredentials: descriptors(o.excludeCredentials),
  };
}

function requestOptions(o: Record<string, unknown>): PublicKeyCredentialRequestOptions {
  return {
    ...(o as unknown as PublicKeyCredentialRequestOptions),
    challenge: toBuffer(o.challenge as string),
    allowCredentials: descriptors(o.allowCredentials),
  };
}

function registrationJSON(cred: PublicKeyCredential) {
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: toB64url(r.clientDataJSON),
      attestationObject: toB64url(r.attestationObject),
      transports: typeof r.getTransports === "function" ? r.getTransports() : [],
    },
    clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
  };
}

function authenticationJSON(cred: PublicKeyCredential) {
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: toB64url(r.clientDataJSON),
      authenticatorData: toB64url(r.authenticatorData),
      signature: toB64url(r.signature),
      userHandle: toB64url(r.userHandle),
    },
    clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
  };
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(apiUrl(path), { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: unknown };
    throw new Error(typeof err.detail === "string" ? err.detail : "Passkey request failed");
  }
  return res.json() as Promise<T>;
}

/** A browser error a person caused (cancelled the prompt, timed out) gets a plain message. */
export function passkeyErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") return "The passkey prompt was closed or timed out.";
    if (err.name === "InvalidStateError") return "This device already has a passkey for this account.";
    if (err.name === "SecurityError") return "Passkeys need https (or localhost) on this site's own domain.";
    return err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong with the passkey.";
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && typeof window.PublicKeyCredential === "function";
}

export async function conditionalUiAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  const check = (PublicKeyCredential as unknown as { isConditionalMediationAvailable?: () => Promise<boolean> })
    .isConditionalMediationAvailable;
  return typeof check === "function" ? check.call(PublicKeyCredential).catch(() => false) : false;
}

export async function fetchPasskeyConfig(): Promise<PasskeyConfig> {
  const res = await fetch(apiUrl("/auth/passkeys/config"), { cache: "no-store" });
  if (!res.ok) return { passkeys_only: true, rp_id: "" };
  return res.json();
}

async function create(begin: Begin): Promise<Record<string, unknown>> {
  const cred = (await navigator.credentials.create({ publicKey: creationOptions(begin.options) })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was created.");
  return registrationJSON(cred);
}

/** New account: the passkey is the only way in; no password is ever set. */
export async function signUpWithPasskey(email: string, name: string, orgName?: string): Promise<AuthResponse> {
  const begin = await post<Begin>("/auth/passkeys/signup/begin", { email, name, org_name: orgName || null });
  const credential = await create(begin);
  return post<AuthResponse>("/auth/passkeys/signup/finish", { challenge_id: begin.challenge_id, credential });
}

/**
 * Sign in with a discoverable passkey. With `conditional`, the request waits for the person to
 * pick a passkey from the browser's autofill on an input with autocomplete="username webauthn".
 */
export async function signInWithPasskey(opts: { conditional?: boolean; signal?: AbortSignal } = {}): Promise<AuthResponse> {
  const begin = await post<Begin>("/auth/passkeys/login/begin", {});
  const request: CredentialRequestOptions = { publicKey: requestOptions(begin.options), signal: opts.signal };
  if (opts.conditional) (request as CredentialRequestOptions & { mediation: string }).mediation = "conditional";
  const cred = (await navigator.credentials.get(request)) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was chosen.");
  return post<AuthResponse>("/auth/passkeys/login/finish", {
    challenge_id: begin.challenge_id,
    credential: authenticationJSON(cred),
  });
}

/**
 * Add a passkey to the account behind `token`: a session, or the enrolment token a password
 * sign-in returns. Returns a passkey session (and the account's password is gone).
 */
export async function addPasskey(token: string, passkeyName?: string): Promise<AuthResponse & { passkey: PasskeyInfo }> {
  const begin = await post<Begin>("/auth/passkeys/register/begin", {}, token);
  const credential = await create(begin);
  return post("/auth/passkeys/register/finish", { challenge_id: begin.challenge_id, credential, passkey_name: passkeyName }, token);
}

/** Account recovery from the emailed single-use link: registers a new passkey. */
export async function recoverWithPasskey(linkToken: string): Promise<AuthResponse> {
  const begin = await post<Begin>("/auth/passkeys/recovery/begin", { token: linkToken });
  const credential = await create(begin);
  return post<AuthResponse>("/auth/passkeys/recovery/finish", { challenge_id: begin.challenge_id, token: linkToken, credential });
}

export type PasswordSignIn =
  | ({ kind: "session" } & AuthResponse)
  | { kind: "enrol"; enrolment_token: string; user: { email: string; name: string } };

/** Password sign-in for accounts that still have one. With passkeys-only it only lets them add a passkey. */
export async function passwordSignIn(email: string, password: string): Promise<PasswordSignIn> {
  const resp = await post<AuthResponse & { passkey_enrolment_required?: boolean; enrolment_token?: string }>(
    "/auth/login", { email, password },
  );
  if (resp.passkey_enrolment_required && resp.enrolment_token) {
    return { kind: "enrol", enrolment_token: resp.enrolment_token, user: resp.user };
  }
  return { kind: "session", ...resp };
}

export async function listPasskeys(token: string): Promise<PasskeyInfo[]> {
  const res = await fetch(apiUrl("/auth/passkeys"), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Failed to load passkeys");
  return res.json();
}

export async function renamePasskey(token: string, id: number, name: string): Promise<PasskeyInfo> {
  const res = await fetch(apiUrl(`/auth/passkeys/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Failed to rename passkey");
  return res.json();
}

export async function removePasskey(token: string, id: number): Promise<void> {
  const res = await fetch(apiUrl(`/auth/passkeys/${id}`), { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? "Failed to remove passkey");
  }
}
