import Link from "next/link";
import { Atom } from "lucide-react";

export const metadata = { title: "Privacy Policy — Q-Lab" };

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px 80px", color: "#e2e8f0", fontFamily: "inherit" }}>
      <div style={{ marginBottom: 40 }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#6366f1", fontSize: 14, marginBottom: 32, textDecoration: "none" }}>
          <Atom size={16} /> Q-Lab
        </Link>
        <h1 style={{ margin: "0 0 8px", fontSize: 30, fontWeight: 800, color: "#f8fafc" }}>Privacy Policy</h1>
        <p style={{ margin: 0, fontSize: 14, color: "#64748b" }}>Effective date: 1 June 2025 &nbsp;·&nbsp; Last updated: 28 June 2026</p>
      </div>

      <Section title="1. Who we are">
        <p>Q-Lab ("we", "us") is a quantum experiment tracking service operated by Yasseen Nandally. Our contact email is <a href="mailto:yasseennandally@gmail.com" style={{ color: "#6366f1" }}>yasseennandally@gmail.com</a>.</p>
      </Section>

      <Section title="2. What data we collect">
        <p><strong style={{ color: "#e2e8f0" }}>Account data:</strong> your name, email address, and hashed password when you register.</p>
        <p><strong style={{ color: "#e2e8f0" }}>Experiment data:</strong> quantum circuit QASM, run parameters, results, and metadata that you submit via the SDK or API.</p>
        <p><strong style={{ color: "#e2e8f0" }}>Usage data:</strong> API request logs, timestamps, and error events for debugging and service health monitoring.</p>
        <p><strong style={{ color: "#e2e8f0" }}>API keys:</strong> stored as irreversible hashes — we cannot recover your plaintext key.</p>
      </Section>

      <Section title="3. How we use your data">
        <ul>
          <li>To provide and operate the Service.</li>
          <li>To send transactional emails (email verification, password reset). We do not send marketing emails without your consent.</li>
          <li>To monitor service health and debug issues.</li>
          <li>To comply with legal obligations.</li>
        </ul>
        <p>We do not sell your data to third parties. We do not use your experiment data to train machine learning models.</p>
      </Section>

      <Section title="4. Legal basis (GDPR)">
        <p>For users in the UK and EU, our legal bases are:</p>
        <ul>
          <li><strong style={{ color: "#e2e8f0" }}>Contract</strong> — processing your account data to provide the Service you signed up for.</li>
          <li><strong style={{ color: "#e2e8f0" }}>Legitimate interest</strong> — service monitoring and fraud prevention.</li>
          <li><strong style={{ color: "#e2e8f0" }}>Legal obligation</strong> — where required by law.</li>
        </ul>
      </Section>

      <Section title="5. Data storage and security">
        <p>Data is stored on <a href="https://neon.tech" target="_blank" rel="noreferrer" style={{ color: "#6366f1" }}>Neon</a> PostgreSQL (EU West 2 region) and hosted on <a href="https://render.com" target="_blank" rel="noreferrer" style={{ color: "#6366f1" }}>Render</a>. Transactional email is sent via <a href="https://resend.com" target="_blank" rel="noreferrer" style={{ color: "#6366f1" }}>Resend</a>.</p>
        <p>We use HTTPS for all data in transit. Passwords are hashed with bcrypt. API keys are stored as SHA-256 hashes.</p>
      </Section>

      <Section title="6. Data retention">
        <p>We retain your account and experiment data for as long as your account is active. If you delete your account, your personal data (name, email) is removed within 30 days. Experiment data (runs, circuits) may be retained in anonymised form for research integrity.</p>
      </Section>

      <Section title="7. Your rights">
        <p>Under UK GDPR and EU GDPR you have the right to:</p>
        <ul>
          <li><strong style={{ color: "#e2e8f0" }}>Access</strong> your personal data.</li>
          <li><strong style={{ color: "#e2e8f0" }}>Rectify</strong> inaccurate data.</li>
          <li><strong style={{ color: "#e2e8f0" }}>Erase</strong> your data ("right to be forgotten") — use Settings → Delete account, or email us.</li>
          <li><strong style={{ color: "#e2e8f0" }}>Portability</strong> — export your run data via the API.</li>
          <li><strong style={{ color: "#e2e8f0" }}>Object</strong> to processing based on legitimate interest.</li>
        </ul>
        <p>To exercise any right, email <a href="mailto:yasseennandally@gmail.com" style={{ color: "#6366f1" }}>yasseennandally@gmail.com</a>. We will respond within 30 days.</p>
      </Section>

      <Section title="8. Cookies">
        <p>Q-Lab does not use tracking or advertising cookies. We store your authentication token in browser <code style={{ background: "#1e293b", padding: "2px 5px", borderRadius: 4 }}>localStorage</code> solely to keep you signed in.</p>
      </Section>

      <Section title="9. Third-party services">
        <p>We use the following sub-processors:</p>
        <ul>
          <li><strong style={{ color: "#e2e8f0" }}>Neon</strong> — database hosting (EU)</li>
          <li><strong style={{ color: "#e2e8f0" }}>Render</strong> — application hosting (US/EU)</li>
          <li><strong style={{ color: "#e2e8f0" }}>Resend</strong> — transactional email</li>
        </ul>
      </Section>

      <Section title="10. Changes to this policy">
        <p>We may update this policy. We will notify you by email at least 14 days before material changes take effect. The "Last updated" date at the top of this page always reflects the current version.</p>
      </Section>

      <Section title="11. Contact">
        <p>For privacy questions or to exercise your rights: <a href="mailto:yasseennandally@gmail.com" style={{ color: "#6366f1" }}>yasseennandally@gmail.com</a>.</p>
      </Section>

      <div style={{ marginTop: 48, paddingTop: 24, borderTop: "1px solid #1e293b", display: "flex", gap: 20, fontSize: 13, color: "#475569" }}>
        <Link href="/terms" style={{ color: "#6366f1" }}>Terms of Service</Link>
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
