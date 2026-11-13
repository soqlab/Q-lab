import type { Metadata } from "next";
import TrustView from "./TrustView";

export const metadata: Metadata = {
  title: "What Q-Lab runs, and what it loads · Q-Lab",
  description: "The exact code this Q-Lab is running, checkable against GitHub, every request this page makes, and the deploy log.",
};

export default function TrustPage() {
  return <TrustView />;
}
