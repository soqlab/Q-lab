"use client";

import { useCallback, useEffect, useState } from "react";

// Board view state lives in the query string (?circuit=ghz5&metric=success), so every view is a
// link someone can share. Written with replaceState: changing a filter is not a new history entry.

function read(key: string): string | null {
  try { return new URLSearchParams(window.location.search).get(key); } catch { return null; }
}

function write(key: string, value: string | null) {
  const u = new URL(window.location.href);
  if (value === null || value === "") u.searchParams.delete(key);
  else u.searchParams.set(key, value);
  const next = u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : "") + u.hash;
  if (next !== window.location.pathname + window.location.search + window.location.hash) {
    window.history.replaceState(window.history.state, "", next);
  }
}

/** A query parameter limited to `allowed` values; `fallback` is used, and left out of the URL, when absent. */
export function useQueryParam<T extends string>(key: string, fallback: T, allowed?: readonly string[]): [T, (v: T) => void] {
  const [v, setV] = useState<T>(fallback);
  useEffect(() => {
    const sync = () => {
      const raw = read(key);
      setV((raw !== null && (!allowed || allowed.includes(raw)) ? raw : fallback) as T);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [key, fallback, allowed]);
  const set = useCallback((nv: T) => { setV(nv); write(key, nv === fallback ? null : nv); }, [key, fallback]);
  return [v, set];
}
