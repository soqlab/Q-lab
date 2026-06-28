import Link from "next/link";
import { Atom } from "lucide-react";

export const metadata = { title: "Terms of Service — Q-Lab" };

export default function TermsPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px 80px", color: "#e2e8f0", fontFamily: "inherit" }}>
      <div style={{ marginBottom: 40 }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#6366f1", fontSize: 14, marginBottom: 32, textDecoration: "none" }}>
          <Atom size={16} /> Q-Lab
        </Link>
        <h1 style={{ margin: "0 0 8px", fontSize: 30, fontWeight: 800, color: "#f8fafc" }}>Terms of Service</h1>
        <p style={{ margin: 0, fontSize: 14, color: "#64748b" }}>Effective date: 1 June 2025 &nbsp;·&nbsp; Last updated: 28 June 2026</p>
      </div>

      <Section title="1. Acceptance">
        <p>By creating an account or using Q-Lab (the "Service") you agree to these Terms. If you are using Q-Lab on behalf of an organisation, you represent that you have authority to bind that organisation.</p>
      </Section>

      <Section title="2. Description of service">
        <p>Q-Lab is a quantum experiment tracking platform that allows researchers to log, compare, and analyse quantum circuit runs. The Service is provided "as is" and may change at any time.</p>
      </Section>

      <Section title="3. Accounts">
        <ul>
          <li>You must provide a valid email address and verify it before accessing the platform.</li>
          <li>You are responsible for all activity that occurs under your account.</li>
          <li>You must not share your credentials or API keys with others outside your team.</li>
          <li>We reserve the right to suspend accounts that violate these Terms.</li>
        </ul>
      </Section>

      <Section title="4. Acceptable use">
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service for any unlawful purpose.</li>
          <li>Upload malicious code, attempt to breach security, or probe the infrastructure.</li>
          <li>Resell or sublicense the Service without written permission.</li>
          <li>Abuse rate limits or otherwise interfere with the availability of the Service.</li>
        </ul>
      </Section>

      <Section title="5. Data and privacy">
        <p>Your use of data is governed by our <Link href="/privacy" style={{ color: "#6366f1" }}>Privacy Policy</Link>. You retain ownership of the experiment data you submit. By submitting data you grant us a licence to store and process it to provide the Service.</p>
      </Section>

      <Section title="6. Intellectual property">
        <p>The Q-Lab platform, its design, and underlying software are owned by Q-Lab and are protected by applicable intellectual property laws. The Python SDK is made available under the MIT licence.</p>
      </Section>

      <Section title="7. Limitation of liability">
        <p>To the maximum extent permitted by law, Q-Lab is not liable for any indirect, incidental, special, or consequential damages arising from your use of the Service, including loss of data or research results. Our total liability to you shall not exceed the amount you paid us in the twelve months preceding the claim, or £100, whichever is greater.</p>
      </Section>

      <Section title="8. Disclaimers">
        <p>The Service is provided "as is" without warranties of any kind. We do not warrant that the Service will be uninterrupted, error-free, or that results will be accurate.</p>
      </Section>

      <Section title="9. Termination">
        <p>You may delete your account at any time from Settings. We may terminate or suspend access without notice for violations of these Terms. On termination, your data will be deleted within 30 days.</p>
      </Section>

      <Section title="10. Changes to these terms">
        <p>We may update these Terms at any time. We will notify you by email or in-app notice at least 14 days before material changes take effect. Continued use after that date constitutes acceptance.</p>
      </Section>

      <Section title="11. Governing law">
        <p>These Terms are governed by the laws of England and Wales. Any disputes will be subject to the exclusive jurisdiction of the courts of England and Wales.</p>
      </Section>

      <Section title="12. Contact">
        <p>Questions? Email us at <a href="mailto:contact@soqlab.com" style={{ color: "#6366f1" }}>contact@soqlab.com</a>.</p>
      </Section>

      <div style={{ marginTop: 48, paddingTop: 24, borderTop: "1px solid #1e293b", display: "flex", gap: 20, fontSize: 13, color: "#475569" }}>
        <Link href="/privacy" style={{ color: "#6366f1" }}>Privacy Policy</Link>
        <Link href="/login" style={{ color: "#475569" }}>Sign in</Link>
        <Link href="/register" style={{ color: "#475569" }}>Create account</Link>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700, color: "#f1f5f9" }}>{title}</h2>
      <div style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.8 }}>{children}</div>
    </section>
  );
}
