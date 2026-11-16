/*
 * Carrying a circuit from /try to Rewind in the address: ?circuit=<base64url of the UTF-8 text>.
 * A circuit too long for an address goes through sessionStorage instead (?circuit=session), which
 * only works in the same tab, which is where the link opens.
 */

export const URL_MAX = 6000;
const KEY = "qlab_try_circuit";

export function encodeCircuit(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCircuit(v: string): string | null {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(v)) return null;
    const bin = atob(v.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The Rewind address that opens with this circuit in its box; `viaSession` needs storeHandoff() on click. */
export function rewindLink(text: string): { href: string; viaSession: boolean } {
  const enc = encodeCircuit(text);
  return enc.length <= URL_MAX ? { href: `/rewind?circuit=${enc}`, viaSession: false } : { href: "/rewind?circuit=session", viaSession: true };
}

export function storeHandoff(text: string): void {
  try { sessionStorage.setItem(KEY, text); } catch { /* private mode: Rewind opens with its own example */ }
}

/** What Rewind's ?circuit= stands for, or null. Capped at Rewind's own 400 kB. */
export function readHandoff(param: string | null): string | null {
  if (!param) return null;
  let text: string | null = null;
  if (param === "session") {
    try { text = sessionStorage.getItem(KEY); } catch { text = null; }
  } else {
    text = decodeCircuit(param);
  }
  return text && text.length <= 400_000 ? text : null;
}
