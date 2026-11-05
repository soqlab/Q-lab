"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Tells people when the numbers on a page aren't measurements. The API marks such responses with
 * `X-QLab-Data: illustrative` (backend/app/illustrative.py), so no page has to remember to say so.
 *
 * fetch is wrapped when this module loads, not in an effect: child pages start fetching in their own
 * effects, which run before a parent's.
 */
let notify: (() => void) | null = null;
let pending = false;

if (typeof window !== "undefined") {
  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await original(...args);
    if (response.headers.get("x-qlab-data") === "illustrative") {
      if (notify) notify();
      else pending = true;
    }
    return response;
  };
}

export default function IllustrativeNotice() {
  const pathname = usePathname();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    notify = () => setShown(true);
    if (pending) { pending = false; setShown(true); }
    return () => { notify = null; };
  }, []);

  // A new page earns its own notice.
  useEffect(() => { setShown(false); }, [pathname]);

  if (!shown) return null;
  return (
    <div
      role="status"
      style={{
        margin: "12px 24px 0", padding: "10px 14px", fontSize: 13, lineHeight: 1.5,
        color: "var(--warn)", border: "1px solid var(--warn)", borderRadius: 6,
      }}
    >
      <strong>Illustrative data.</strong> Some or all numbers on this page are simulated or sample values,
      not measurements from your runs or real hardware. Don&apos;t cite them or base decisions on them.
    </div>
  );
}
