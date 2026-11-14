"use client";

import { qlabApiPath } from "./api";

/*
 * Provenance certificates (backend/app/provenance/). The check runs in this browser: the noble
 * ML-DSA-65 / Ed25519 / SHA-256 code is vendored at /vendor/qlab-pq-verify.js (built by
 * tools/pq-verify-js) and the certificate rules are in /certificate-verify.js, the same rules as
 * the offline verifier. Both are served from this site; nothing is fetched from anywhere else.
 */

export type CertState = "reproduced" | "mixed" | "not_reproduced" | "not_yet";

export type CertReproductionRun = {
  state: string; exact: boolean; tvd: string | null; expected_tvd: string | null; p_value: string | null;
  shots: number | null; backend: string | null; same_machine: boolean; created_at: string | null;
  by: "author" | "other"; run_id: string | null; public_page: string | null;
};

export type CertReproduction = {
  state: CertState; agreed: number; disagreed: number; pending: number; not_judged: number; all_exact: boolean;
  max_agreeing_tvd: string | null; alpha: string | null; sentence: string;
  sentences: { plain: string; standard: string; expert: string }; runs: CertReproductionRun[];
};

type Hashes = Record<string, string | null>;

export type CertBody = {
  schema: string; issued_at: string;
  issuer: { name: string; url: string | null; backend_commit: string | null; source: string };
  run: { run_id: string; circuit_name: string | null; status: string | null; created_at: string | null;
         received_at: string | null; record_sha256: string; public_page: string | null };
  circuit: { as_run: Hashes; logical: Hashes; compiled: Hashes; hash_only: boolean;
             num_qubits: number | null; depth: number | null; size: number | null };
  machine: { backend: string | null; kind: string };
  calibration: { recorded: boolean; sha256: string | null; hash_method: string; calibrated_at: string | null; source: string | null;
                 rewind_snapshot: { sha256: string | null; provider: string | null; machine: string | null; calibrated_at: string | null;
                                    manifest_date: string | null; match: string | null } | null };
  software: { versions: Record<string, string>; python: string | null; qlab_sdk: string | null };
  settings: { shots: number | null; transpiler: Record<string, unknown>; compiled_with: string | null;
              seed_simulator: number | null; ran_with: string | null };
  results: { counts_sha256: string | null; hash_method: string; total_shots: number | null; outcomes: number | null };
  reproduction: CertReproduction;
};

export type CertDoc = {
  format: string; certificate: CertBody; body_sha256: string;
  signature: { key: string; signed_at: string; ed25519: string; ml_dsa_65: string;
               public_key: { key_id: string; ed25519: string; ml_dsa_65: string } } | null;
  unsigned_reason?: string | null;
};

export type Verdict = {
  valid: boolean; body_hash_ok: boolean; ed25519: boolean; ml_dsa_65: boolean;
  key_id: string | null; body_sha256: string; reason: string | null;
};

export type BrowserCheck =
  | { status: "checking" }
  | { status: "done"; verdict: Verdict; publishedKey: string | null }
  | { status: "malformed"; reason: string }
  | { status: "unavailable"; reason: string };

type Verifier = { verify: (doc: unknown, expectKey: string | null) => Verdict };

let loading: Promise<Verifier> | null = null;

function addScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-qlab-src="${src}"]`);
    if (existing?.dataset.loaded === "1") return resolve();
    const el = existing ?? document.createElement("script");
    el.addEventListener("load", () => { el.dataset.loaded = "1"; resolve(); });
    el.addEventListener("error", () => reject(new Error(`couldn't load ${src}`)));
    if (!existing) {
      el.src = src;
      el.async = true;
      el.dataset.qlabSrc = src;
      document.head.appendChild(el);
    }
  });
}

/** The vendored verifier, loaded once from this site. */
export function loadVerifier(): Promise<Verifier> {
  if (!loading) {
    loading = addScript("/vendor/qlab-pq-verify.js")
      .then(() => addScript("/certificate-verify.js"))
      .then(() => {
        const v = (globalThis as unknown as { QLabCertificate?: Verifier }).QLabCertificate;
        if (!v) throw new Error("the verifier did not start");
        return v;
      })
      .catch((e) => { loading = null; throw e; });
  }
  return loading;
}

/** The key id this server publishes (what the certificate's key should be). */
export async function publishedKeyId(): Promise<string | null> {
  try {
    const r = await fetch(qlabApiPath("/api/v1/certificates/public-key"), { cache: "no-store" });
    if (!r.ok) return null;
    const d = (await r.json()) as { public_key?: { key_id?: string } | null };
    return d.public_key?.key_id ?? null;
  } catch {
    return null;
  }
}

export async function checkInBrowser(doc: unknown, expectKey: string | null = null): Promise<BrowserCheck> {
  let v: Verifier;
  try {
    v = await loadVerifier();
  } catch (e) {
    return { status: "unavailable", reason: e instanceof Error ? e.message : "the verifier couldn't load" };
  }
  try {
    const verdict = v.verify(doc, expectKey);
    return { status: "done", verdict, publishedKey: null };
  } catch (e) {
    return { status: "malformed", reason: e instanceof Error ? e.message : "not a certificate" };
  }
}

/** One sentence for a check's outcome. */
export function checkSentence(c: BrowserCheck | null): string {
  if (!c || c.status === "checking") return "Checking the certificate in your browser…";
  if (c.status === "unavailable") return `The certificate couldn't be checked in this browser (${c.reason}).`;
  if (c.status === "malformed") return `This is not a valid certificate: ${c.reason}`;
  const v = c.verdict;
  if (!v.valid) return `The certificate did NOT verify: ${v.reason}`;
  if (c.publishedKey && c.publishedKey !== v.key_id) {
    return `The certificate's signatures are valid, but it was signed by ${v.key_id}, not by this server's key (${c.publishedKey}).`;
  }
  return "Certificate verified in your browser.";
}

export function certFileName(runId: string): string {
  return `qlab-certificate-${runId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16) || "run"}.json`;
}

/** Copyable snippets for a paper, a README or a web page. */
export function snippets(origin: string, token: string, state: CertState, badgeText: string) {
  const page = `${origin}/verified/${token}`;
  const svg = `${page}/badge.svg`;
  const words = state === "reproduced" ? "Reproduced on Q-Lab" : "Provenance on Q-Lab";
  const alt = `Q-Lab: ${badgeText}`;
  return {
    page, svg,
    markdown: `[![${alt}](${svg})](${page})`,
    html: `<a href="${page}"><img src="${svg}" alt="${alt.replace(/"/g, "&quot;")}" height="20"></a>`,
    latex: `\\href{${page}}{${words}}`,
    latexFootnote: `\\footnote{Provenance certificate and independent re-runs: \\url{${page}}}`,
  };
}

export function shareTokenOf(sharePageUrl: string | null | undefined): string | null {
  if (!sharePageUrl) return null;
  const m = /\/share\/([A-Za-z0-9_-]{8,64})\/?$/.exec(sharePageUrl);
  return m ? m[1] : null;
}

/** The badge's words for a reproduction summary (the same as the server's badge.svg). */
export function badgeTextFor(r: Pick<CertReproduction, "state" | "agreed" | "disagreed" | "all_exact">): string {
  if (r.state === "reproduced") return r.all_exact && r.agreed === 1 ? "reproduced exactly" : r.agreed > 1 ? `reproduced ×${r.agreed}` : "reproduced";
  if (r.state === "mixed") return `reproduced ${r.agreed}/${r.agreed + r.disagreed}`;
  if (r.state === "not_reproduced") return "didn't reproduce";
  return "not yet reproduced";
}
