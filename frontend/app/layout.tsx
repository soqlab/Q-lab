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
    url: "https://www.soqlab.com",
    images: [{ url: "https://www.soqlab.com/og-image.png", width: 1200, height: 630, alt: "Q-Lab quantum experiment tracker" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Q-Lab — Quantum Experiment Observatory",
    description: "Automatically capture, compare, and reproduce every Qiskit circuit run.",
    images: ["https://www.soqlab.com/og-image.png"],
  },
  metadataBase: new URL("https://www.soqlab.com"),
  alternates: { canonical: "https://www.soqlab.com" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
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
              "url": "https://www.soqlab.com",
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
