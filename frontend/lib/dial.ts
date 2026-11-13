"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * The "how technical" dial: plain, standard or expert. It lives in the address (?detail=), so a
 * link shows the other person the same depth, and the last choice is remembered in this browser
 * so it follows you from page to page.
 *
 * Pages mark detail with CSS classes: `d-standard` (hidden on plain) and `d-expert` (shown only on
 * expert). The current level is also on <html data-detail>, which globals.css reads. Wording that
 * changes with the level (the run's answer sentence) asks the backend for that level.
 */
export type Detail = "plain" | "standard" | "expert";
export const DETAILS: Detail[] = ["plain", "standard", "expert"];
export const DETAIL_LABEL: Record<Detail, string> = { plain: "Plain", standard: "Standard", expert: "Expert" };

const KEY = "qlab_detail";
const EVENT = "qlab-detail-change";
const isDetail = (v: unknown): v is Detail => v === "plain" || v === "standard" || v === "expert";

function fromUrl(): Detail | null {
  try {
    const v = new URLSearchParams(window.location.search).get("detail");
    return isDetail(v) ? v : null;
  } catch {
    return null;
  }
}

function stored(): Detail | null {
  try {
    const v = localStorage.getItem(KEY);
    return isDetail(v) ? v : null;
  } catch {
    return null;
  }
}

function read(): Detail {
  return fromUrl() ?? stored() ?? "standard";
}

/** Put ?detail= in the current address without a navigation (standard is the default and is left out). */
export function writeDetailToUrl(d: Detail) {
  const u = new URL(window.location.href);
  if (d === "standard") u.searchParams.delete("detail");
  else u.searchParams.set("detail", d);
  const next = u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : "") + u.hash;
  if (next !== window.location.pathname + window.location.search + window.location.hash) {
    window.history.replaceState(window.history.state, "", next);
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("popstate", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("popstate", cb);
    window.removeEventListener("storage", cb);
  };
}

export function useDetail(): [Detail, (d: Detail) => void] {
  const d = useSyncExternalStore(subscribe, read, () => "standard" as Detail);
  const set = useCallback((v: Detail) => {
    try { localStorage.setItem(KEY, v); } catch { /* private mode: the URL still carries it */ }
    writeDetailToUrl(v);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [d, set];
}

/**
 * Mounted once in the app shell: keeps <html data-detail> and the address in step with the dial
 * on every page, so a copied link always carries the level being looked at.
 */
export function useDetailSync(pathname: string) {
  const [d] = useDetail();
  useEffect(() => {
    document.documentElement.dataset.detail = d;
    // A link that names a level wins; otherwise the remembered level is written into the address.
    const url = fromUrl();
    if (url && url !== stored()) {
      try { localStorage.setItem(KEY, url); } catch { /* ignore */ }
    } else if (!url && d !== "standard") {
      writeDetailToUrl(d);
    }
  }, [d, pathname]);
}

/** A link to `href` that keeps the current level. */
export function withDetail(href: string, d: Detail): string {
  if (d === "standard" || /^https?:/.test(href)) return href;
  const [path, hash = ""] = href.split("#");
  return `${path}${path.includes("?") ? "&" : "?"}detail=${d}${hash ? `#${hash}` : ""}`;
}
