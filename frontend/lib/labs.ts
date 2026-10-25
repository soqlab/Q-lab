"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Labs: Q-Lab's experimental tools are hidden until the user turns Labs on.
 * The core is what the product promises: capture, compare and reproduce quantum runs,
 * plus account and team settings. Everything else in the app is a Labs page.
 * To graduate a page, add its path here.
 */
const CORE_EXACT = [
  "/",
  "/runs", "/projects", "/timeline", "/analytics", "/compare", "/benchmarks", "/reproducibility",
  "/backends", "/calibration", "/intel", "/cost-oracle",
  "/assistant", "/onboarding",
  "/integrations", "/webhooks", "/offline-export",
  "/team",
  "/settings", "/settings/policy", "/settings/rbac", "/settings/audit", "/settings/alerts",
  "/settings/notifications", "/credentials", "/gdpr", "/feedback",
  "/profile", "/billing", "/admin",
];
// Paths whose sub-pages are core too (a run's detail page, a project's page, ...).
const CORE_PREFIX = ["/runs/", "/projects/", "/benchmarks/", "/backends/", "/profile/", "/admin/"];

export function isCorePath(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return CORE_EXACT.includes(p) || CORE_PREFIX.some((pre) => p.startsWith(pre));
}

const KEY = "qlab_labs";
const EVENT = "qlab-labs-change";

function read(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

/**
 * Whether Labs is on in this browser, a setter that updates every component using it, and whether
 * the saved choice has been read yet (it lives in localStorage, so not during the first render).
 */
export function useLabs(): [boolean, (on: boolean) => void, boolean] {
  const [on, setOn] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setOn(read());
    setReady(true);
    const sync = () => setOn(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  const set = useCallback((v: boolean) => {
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private mode: applies to this page only */ }
    setOn(v);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [on, set, ready];
}
