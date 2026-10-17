import type { Metadata } from "next";
import { AuthProvider } from "../lib/auth";
import { ThemeProvider } from "../lib/theme";
import { ToastProvider } from "../lib/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "Q-Lab — Quantum Experiment Observatory",
  description: "Automatically capture, compare, and reproduce every Qiskit circuit run. Track calibration, health scores, AI insights, and QPU cost across IBM, IonQ, Rigetti, and more.",
  keywords: ["quantum computing", "Qiskit", "experiment tracking", "quantum observability", "QPU", "IBM Quantum", "IonQ", "circuit analysis"],
  authors: [{ name: "Q-Lab" }],
  openGraph: {
    type: "website",
    siteName: "Q-Lab",
    title: "Q-Lab — Quantum Experiment Observatory",
    description: "Automatically capture, compare, and reproduce every Qiskit circuit run. The missing observability layer for quantum computing research.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Q-Lab — Quantum Experiment Observatory",
    description: "Automatically capture, compare, and reproduce every Qiskit circuit run.",
  },
};

// When the site is served by a host that limits proxied requests (Netlify cuts them at ~25 s),
// the browser calls the backend directly instead of through /qlab-api. Unset on Render: no change.
const API_BASE = (process.env.NEXT_PUBLIC_QLAB_API_BASE || "").replace(/\/+$/, "");
const API_SHIM = `(function(){
  var base = ${JSON.stringify(API_BASE)};
  if (!base) return;
  var P = "/qlab-api/";
  function fix(u) {
    try {
      var p = new URL(String(u), location.href);
      if (p.origin === location.origin && p.pathname.indexOf(P) === 0) return base + p.pathname.slice(P.length - 1) + p.search;
    } catch (e) {}
    return u;
  }
  var f = window.fetch;
  window.fetch = function(input, init) {
    if (input && typeof input === "object" && "url" in input) {
      var nu = fix(input.url);
      return f.call(this, nu === input.url ? input : new Request(nu, input), init);
    }
    return f.call(this, fix(input), init);
  };
  var ES = window.EventSource;
  if (ES) {
    var Shim = function(u, c) { return new ES(fix(u), c); };
    Shim.prototype = ES.prototype;
    Shim.CONNECTING = 0; Shim.OPEN = 1; Shim.CLOSED = 2;
    window.EventSource = Shim;
  }
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {API_BASE && <script dangerouslySetInnerHTML={{ __html: API_SHIM }} />}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#6366f1" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Q-Lab" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              "name": "Q-Lab",
              "description": "Quantum experiment tracking and observability platform for Qiskit research teams.",
              "applicationCategory": "DeveloperApplication",
              "operatingSystem": "Web",
              "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
              "featureList": [
                "Automatic Qiskit experiment capture",
                "AI-powered circuit insights",
                "Multi-backend cost comparison",
                "Health scoring and calibration tracking",
                "Public shareable experiment links"
              ],
            }),
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
  (function(){
    try {
      var s = localStorage.getItem('qlab_theme');
      var t = s || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', t);
    } catch(e){}
  })();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'SW_UPDATED') window.location.reload();
    });
  }
`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>{children}</AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
