export default function TermsPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "3rem 1.5rem", color: "#e2e8f0", fontFamily: "system-ui, sans-serif", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Terms of Service</h1>
      <p style={{ color: "#64748b", fontSize: 13, marginBottom: 32 }}>Last updated: June 2026</p>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>1. Acceptance</h2>
        <p>By creating an account on Q-Lab (soqlab.com) you agree to these Terms. If you do not agree, do not use the platform.</p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>2. What Q-Lab is</h2>
        <p>Q-Lab is a quantum experiment tracking and analysis platform. It lets researchers log, compare, and share quantum circuit runs from providers such as IBM Quantum, IonQ, and Rigetti.</p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>3. Your account</h2>
        <p>You are responsible for keeping your API key and password secure. Do not share credentials. You must provide accurate registration information. We may suspend accounts that violate these Terms.</p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>4. Your data</h2>
        <p>Experiment data, circuits, and results you upload remain yours. By uploading them you grant Q-Lab a limited licence to store and display that data to you and, where you choose to share it, to other users.</p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>5. Acceptable use</h2>
        <p>You may not use Q-Lab to:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li>Violate any applicable law or regulation</li>
          <li>Attempt to gain unauthorised access to other users&apos; data</li>
          <li>Reverse-engineer or scrape the platform at scale</li>
          <li>Upload malicious code or content</li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>6. AI features</h2>
        <p>Q-Lab uses Claude (Anthropic) to provide experiment insights and the Lab Assistant. AI-generated content may contain errors. Do not rely on it as sole scientific evidence. Usage is subject to a fair-use daily limit.</p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>7. Service availability</h2>
        <p>Q-Lab is provided &quot;as is&quot;. We do not guarantee uninterrupted uptime. We may change, suspend, or discontinue features at any time.</p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>8. Limitation of liability</h2>
        <p>To the fullest extent permitted by law, Q-Lab and its operators are not liable for any indirect, incidental, or consequential damages arising from your use of the platform.</p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>9. Changes to these Terms</h2>
        <p>We may update these Terms. Continued use after changes are posted constitutes acceptance. We will notify users of material changes by email where possible.</p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>10. Contact</h2>
        <p>Questions? Email <a href="mailto:stateofquantumlab@gmail.com" style={{ color: "#38bdf8" }}>stateofquantumlab@gmail.com</a> or use the contact form on soqlab.com.</p>
      </section>

      <p style={{ color: "#475569", fontSize: 13, marginTop: 40, borderTop: "1px solid #1e293b", paddingTop: 16 }}>
        © {new Date().getFullYear()} Q-Lab (soqlab.com). All rights reserved.
      </p>
    </main>
  );
}
