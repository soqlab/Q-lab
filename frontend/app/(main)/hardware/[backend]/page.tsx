"use client";

import { use } from "react";
import BackendView from "../../../../components/board/BackendView";

export default function BoardBackendPage({ params }: { params: Promise<{ backend: string }> }) {
  const { backend } = use(params);
  return <BackendView name={decodeURIComponent(backend)} />;
}
