"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export function usePageTracker(token: string | null) {
  const pathname = usePathname();
  const prevPath = useRef<string | null>(null);

  useEffect(() => {
    if (!token || pathname === prevPath.current) return;
    prevPath.current = pathname;

    fetch("/qlab-api/api/v1/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ event: "page.view", page: pathname }),
    }).catch(() => {});
  }, [pathname, token]);
}
