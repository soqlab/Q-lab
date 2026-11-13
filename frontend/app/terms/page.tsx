import type { Metadata } from "next";
import Link from "next/link";
import s from "../trust/trust.module.css";

export const metadata: Metadata = {
  title: "Terms · Q-Lab",
  description: "The terms for using the hosted Q-Lab at qlab.soqlab.com.",
};

// Change this date whenever the page changes.
const UPDATED = "2026-11-13";

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className={s.panel} aria-labelledby={id}>
      <div className={s.eyebrow}>{eyebrow}</div>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className={s.page}>
      <main className={s.wrap}>
        <div className={s.top}>
          <Link href="/" className={s.brand}>Q-LAB</Link>
          <Link href="/runs" className={s.back}>Back to your runs</Link>
        </div>
        <div>
          <div className={s.eyebrow}>Terms</div>
          <h1 className={s.h1}>Terms of use</h1>
        </div>
        <p className={s.muted}>Last updated {UPDATED}.</p>
        <p className={s.lead}>
          These terms cover the hosted Q-Lab at qlab.soqlab.com, run by SOQLAB. By making an account or using the
          service you agree to them. If you run Q-Lab on your own servers, its open-source licence applies instead,
          not these terms.
        </p>

        <Section id="service-h" eyebrow="Service" title="What Q-Lab is">
          <p>
            Q-Lab records the quantum experiments you send it with the Q-Lab SDK and lets you look at, compare and share
            them. The hosted service is free. What it collects and how it is used is set out in the{" "}
            <Link className={s.link} href="/privacy">privacy notice</Link>.
          </p>
        </Section>

        <Section id="account-h" eyebrow="Account" title="Your account">
          <ul className={s.list}>
            <li>You sign in with a passkey. Keep your devices, passkeys, recovery codes and API keys safe: anyone holding them can act as you.</li>
            <li>You are responsible for what is done with your account and your API keys. Revoke a key you think has leaked.</li>
            <li>You can delete your account at any time in Settings. It is locked straight away and erased 7 days later, as the privacy notice describes.</li>
          </ul>
        </Section>

        <Section id="use-h" eyebrow="Acceptable use" title="What you may not do">
          <ul className={s.list}>
            <li>Upload data you have no right to, including other people&apos;s personal data or results you were given in confidence.</li>
            <li>Try to see or change other people&apos;s data, get around sign-in or sharing settings, or test the service&apos;s security without our agreement (see SECURITY.md in the source repository for how to report a problem).</li>
            <li>Use Q-Lab to misuse quantum hardware or provider accounts: for example running jobs on keys that are not yours, or sending traffic meant to overload a provider or Q-Lab.</li>
            <li>Overload the service, scrape it in bulk, or use it to send spam or harmful content through its webhooks, emails or integrations.</li>
            <li>Break the law, or other people&apos;s rights, in using it.</li>
          </ul>
          <p>We may remove content or suspend an account that breaks these rules, and will say why when we can.</p>
        </Section>

        <Section id="yours-h" eyebrow="Your data" title="What you upload stays yours">
          <p>
            Your circuits, results and notes remain yours. You let SOQLAB store and process them only to run Q-Lab for
            you, and to show them to the people you share them with. A run you share can be opened by anyone with its
            link until you turn sharing off on the run&apos;s page.
          </p>
        </Section>

        <Section id="warranty-h" eyebrow="No warranty" title="As it is">
          <p>
            Q-Lab is provided as it is, without any warranty. It may be wrong, slow or unavailable, and data may be
            lost: keep your own copies of anything important (you can export your runs and your whole account). To the
            extent the law allows, SOQLAB is not liable for losses arising from using or not being able to use the
            service.
          </p>
        </Section>

        <Section id="change-h" eyebrow="Changes" title="The service and these terms may change">
          <p>
            We may change, limit or stop features, or the service as a whole. If we change these terms, the date at the
            top changes. If you don&apos;t agree with a change, you can export your data and delete your account.
          </p>
        </Section>

        <Section id="contact-h" eyebrow="Contact" title="Questions">
          <p>
            Email <a className={s.link} href="mailto:contact@soqlab.com">contact@soqlab.com</a>.
          </p>
        </Section>
      </main>
    </div>
  );
}
