"use client";

import { useState } from "react";
import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import { submitAdviceFeedback } from "../../../../lib/api";

export default function FeedbackButtons({
  runId,
  feature,
  itemId,
}: {
  runId: string;
  feature: "mitigation" | "rca" | "bug_database";
  itemId?: string;
}) {
  const [sent, setSent] = useState<string | null>(null);

  async function send(rating: "up" | "down" | "accepted") {
    setSent(rating);
    try {
      await submitAdviceFeedback({ run_id: runId, feature, item_id: itemId, rating });
    } catch {
      setSent(null);
    }
  }

  const button = (rating: "up" | "down" | "accepted", label: string, Icon: typeof ThumbsUp) => (
    <button
      type="button"
      className="button secondary"
      onClick={() => void send(rating)}
      style={{ height: 26, fontSize: 11, padding: "0 8px" }}
      title={label}
    >
      <Icon size={12} aria-hidden="true" /> {sent === rating ? "Sent" : label}
    </button>
  );

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
      {button("up", "Useful", ThumbsUp)}
      {button("down", "Not useful", ThumbsDown)}
      {button("accepted", "Accepted", Check)}
    </div>
  );
}
