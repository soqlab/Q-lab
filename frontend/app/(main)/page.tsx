"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The run history has moved to /runs.
// This redirect handles any bookmarks or links to the old root path
// that land inside the (main) layout group.
export default function MainRootRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/runs");
  }, [router]);
  return null;
}
