export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "3rem 1.5rem", color: "#e2e8f0", fontFamily: "system-ui, sans-serif", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Privacy Policy</h1>
      <p style={{ color: "#64748b", fontSize: 13, marginBottom: 32 }}>Last updated: June 2026</p>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>1. What we collect</h2>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Account information</strong> — name, email address, organisation name, hashed password</li>
          <li><strong>Experiment data</strong> — quantum circuit QASM, run results, metadata you upload</li>
          <li><strong>Usage data</strong> — API call counts, AI feature usage, page visits (no third-party analytics)</li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>2. How we use it</h2>
        <ul style={{ paddingLeft: 20 }}>
          <li>To operate the platform and deliver features (experiment tracking, AI insights, Circuit Marketplace)</li>
          <li>To send transactional emails (account verification, password reset)</li>
          <li>To enforce fair-use limits and prevent abuse</li>
        </ul>
        <p style={{ marginTop: 10 }}>We do <strong>not</strong> sell your data, run advertising, or share your data with third parties except as described below.</p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>3. Third-party services</h2>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Anthropic (Claude API)</strong> — prompts and circuit data may be sent to Anthropic when you use AI features. Anthropic&apos;s <a href="https://www.anthropic.com/privacy" target="_blank" rel="noreferrer" style={{ color: "#38bdf8" }}>privacy policy</a> applies.</li>
          <li><strong>Render</strong> — our hosting provider stores data on its infrastructure.</li>
          <li><strong>Brevo / SMTP</strong> — used to send transactional emails.</li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>4. Data retention</h2>
        <p>We retain your account data and experiment records for as long as your account is active. You may request deletion by contacting us — we will remove your personal data within 30 days.</p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>5. Security</h2>
        <p>Passwords are hashed and never stored in plain text. API keys are generated with cryptographic randomness. All traffic is encrypted over HTTPS.</p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>6. Your rights</h2>
        <p>You may request access to, correction of, or deletion of your personal data at any time. Contact us at the address below.</p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>7. Cookies</h2>
        <p>Q-Lab uses only essential cookies and browser localStorage for session management (auth token, onboarding state). No tracking or advertising cookies are used.</p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>8. Contact</h2>
        <p>Email <a href="mailto:contact@soqlab.com" style={{ color: "#38bdf8" }}>contact@soqlab.com</a> for any privacy-related requests.</p>
      </section>

      <p style={{ color: "#475569", fontSize: 13, marginTop: 40, borderTop: "1px solid #1e293b", paddingTop: 16 }}>
        © {new Date().getFullYear()} Q-Lab (soqlab.com). All rights reserved.
      </p>
    </main>
  );
}
