import type { Metadata, Viewport } from "next";
import WallView from "./WallView";

// Wall mode for an office display. The display link's token lives in the URL fragment (#), which
// the browser never sends to a server or in a Referer header; the page sends it only to the wall API.
export const metadata: Metadata = {
  title: "Q-Lab wall",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export const viewport: Viewport = { themeColor: "#05080c" };

export default function WallPage() {
  return <WallView />;
}
