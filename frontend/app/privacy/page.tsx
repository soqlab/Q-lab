import type { Metadata } from "next";
import Link from "next/link";
import s from "../trust/trust.module.css";

export const metadata: Metadata = {
  title: "Privacy · Q-Lab",
  description: "What the hosted Q-Lab keeps about you, where it goes, how long it stays, and how to have it removed.",
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

export default function PrivacyPage() {
  return (
    <div className={s.page}>
      <main className={s.wrap}>
        <div className={s.top}>
          <Link href="/" className={s.brand}>Q-LAB</Link>
          <Link href="/runs" className={s.back}>Back to your runs</Link>
        </div>
        <div>
          <div className={s.eyebrow}>Privacy</div>
          <h1 className={s.h1}>What Q-Lab keeps about you</h1>
        </div>
        <p className={s.muted}>Last updated {UPDATED}.</p>
        <p className={s.lead}>
          This page covers the hosted Q-Lab at qlab.soqlab.com, run by SOQLAB. If you use a Q-Lab that someone
          else runs on their own servers, they hold your data, not SOQLAB, and their own terms apply. Q-Lab&apos;s
          source code is public, so everything below can be checked against it.
        </p>

        <Section id="collect-h" eyebrow="Collected" title="What we collect">
          <ul className={s.list}>
            <li>
              <strong>Your account:</strong> the name you give, an email address if you add one (it is optional), an
              organisation name if you give one, and your role. For each passkey: its public key and ID, the name you
              give it, which kind of authenticator made it, whether it is backed up, and when it was added and last
              used. The private part of a passkey never leaves your device. Recovery codes and API keys are stored
              only as hashes. Accounts made before passkeys may still hold a password hash until their first passkey
              is created, when it is deleted.
            </li>
            <li>
              <strong>Sign-in and security records:</strong> when you last signed in and how many times. A log of
              account and run events (signing up, signing in, adding or removing a passkey, changing your email,
              creating, viewing or deleting a run) with the time, and for most of these the IP address and browser
              user agent of the request.
            </li>
            <li>
              <strong>Your experiments, as the Q-Lab SDK sends them:</strong> the circuit (OpenQASM and Qiskit&apos;s
              QPY format), measurement counts, backend and machine calibration, transpiler settings, seeds, shots and
              timings, and the environment it ran in: the Python version, the operating system and its version, the
              git commit and branch of the folder you ran from, and the versions of quantum packages. The full list of
              installed packages is sent only if you turn that on. The SDK does not send your computer&apos;s name,
              your username, environment variables, file paths or your scripts.
            </li>
            <li>
              <strong>What you add:</strong> run notes, a researcher profile, feedback you send (with your browser&apos;s
              user agent), keys for quantum and AI providers you save, and the settings of integrations you connect
              (Slack, Teams, GitHub, webhooks, notification channels). Provider keys, integration tokens, webhook
              signing secrets and Slack or Teams webhook addresses are stored encrypted, with a key kept apart from the
              database.
            </li>
            <li>
              <strong>An install ping from the SDK:</strong> when the SDK is pointed at the hosted Q-Lab it sends its
              own version and the Python version number, nothing else. Set <code className={s.mono}>QLAB_TELEMETRY=off</code> to
              stop it.
            </li>
          </ul>
        </Section>

        <Section id="not-h" eyebrow="Not collected" title="What we don't do">
          <p>
            Q-Lab has no analytics, no advertising and no tracking. Its pages load no scripts, fonts or images from
            other companies; the browser is told to refuse them (you can see this on the{" "}
            <Link className={s.link} href="/trust">Trust page</Link>). We do not sell your data, and we do not use it
            for advertising.
          </p>
        </Section>

        <Section id="use-h" eyebrow="Use" title="How we use it">
          <p>
            To run Q-Lab for you: store and show your runs, compare them, answer questions about them, sign you in,
            send the emails you need (confirming an address, account recovery, team invitations, notifications you set
            up), keep accounts secure, and find and fix problems.
          </p>
        </Section>

        <Section id="browser-h" eyebrow="Your browser" title="What Q-Lab stores in your browser">
          <ul className={s.list}>
            <li><code className={s.mono}>qlab_token</code> and <code className={s.mono}>qlab_user</code> (local storage): your session and your name, email and role, so you stay signed in. Signing out removes them.</li>
            <li><code className={s.mono}>qlab_theme</code>, <code className={s.mono}>qlab_detail</code>, <code className={s.mono}>qlab_labs</code>, <code className={s.mono}>qlab_onboarding_done</code> (local storage): display choices, and whether you finished the first-run guide.</li>
            <li><code className={s.mono}>qlab_recovery_prompt_later</code> (session storage, cleared when the tab closes): that you postponed the recovery-code reminder.</li>
            <li><code className={s.mono}>qlab_oauth</code> (a cookie, only while signing in with Google or GitHub, removed after at most 10 minutes): protects that sign-in from being hijacked.</li>
            <li>A cache of Q-Lab&apos;s own page code, so pages load faster.</li>
          </ul>
          <p className={s.muted}>None of these is used for tracking or shared with anyone.</p>
        </Section>

        <Section id="share-h" eyebrow="Sharing" title="Who else sees it">
          <ul className={s.list}>
            <li><strong>Render</strong> hosts Q-Lab and its database, and requests pass through <strong>Cloudflare</strong>&apos;s network on the way.</li>
            <li><strong>An email delivery service</strong> receives your address and the message when Q-Lab emails you.</li>
            <li>
              <strong>Quantum providers</strong> (IBM Quantum, IonQ): only when you save your own key with them and use
              a feature that sends them a circuit or asks for machine data. The hardware board uses SOQLAB&apos;s own
              IBM key and sends none of your data.
            </li>
            <li>
              <strong>AI providers</strong> (Anthropic, OpenAI, Groq, Mistral, Google Gemini, or an address you enter):
              only if you save your own key with one. Q-Lab then sends it what the feature needs, such as a run&apos;s
              circuit, calibration and results, or your question and a summary of your runs. That provider&apos;s terms
              apply to what it receives. Without a key of yours, nothing is sent to any AI provider.
            </li>
            <li>
              <strong>Google and GitHub</strong>: only if your account was made with one of them before passkeys and you
              use it once to create your passkey. Q-Lab receives your email address and name from them. New accounts
              can&apos;t be made this way.
            </li>
            <li>
              <strong>Services you connect or use</strong>: Slack, Teams, GitHub and webhooks you set up receive the
              events you chose; arXiv receives search terms when you search papers; Zenodo receives what you publish
              there.
            </li>
            <li>
              <strong>Everyone</strong>, for what you make public: a run you share can be opened by anyone with its link,
              is listed in the public gallery, and shows its recorded environment (such as git commit and branch,
              Python version and operating system). Researcher profiles are public unless you set them private.
            </li>
            <li>Authorities, when the law requires it.</li>
          </ul>
        </Section>

        <Section id="keep-h" eyebrow="Retention" title="How long it stays, and removing it">
          <ul className={s.list}>
            <li>Your runs and account data are kept until you delete them or ask us to.</li>
            <li>Deleting a run removes it straight away. Revoking an API key stops it working.</li>
            <li>
              <strong>Deleting your account</strong> (in Settings, or on the Data privacy page) locks it at once: it
              can&apos;t be used, its API keys stop working and its public share links are turned off. Seven days later
              Q-Lab erases it: your runs and everything attached to them, projects nobody else has runs in, API keys,
              passkeys, recovery codes, saved provider keys, webhooks, notification channels, integration settings,
              your profile and the other records listed above. If you were the last member of an organisation, the
              organisation and its data go too. Signing in with your passkey within the seven days cancels the
              deletion (share links stay off). We email you when the deletion is scheduled and when it is done, if
              you gave an address.
            </li>
            <li>
              The security log keeps its entries about an erased account, so that abuse and break-ins can still be
              investigated. In them the account is replaced by a code that does not lead back to you without the
              server&apos;s key, and browser details and other request details are removed; the action, the time and
              the IP address stay. The security log is not deleted on a schedule.
            </li>
            <li>
              You can download everything Q-Lab holds about your account as one JSON file on the Data privacy page
              (<Link className={s.link} href="/gdpr">/gdpr</Link>), and your runs as CSV or JSON Lines from the Runs
              and Analytics pages.
            </li>
            <li>
              To stop sharing a run, open it and choose Actions, then Stop sharing. The link stops working at once and
              the run leaves the public gallery.
            </li>
          </ul>
          <p>
            Depending on where you live, you may have the right to see, correct, export or delete your data, and to
            object to how it is used. Exporting and deleting are self-service, as above; email us for anything else.
          </p>
        </Section>

        <Section id="contact-h" eyebrow="Contact" title="Questions and requests">
          <p>
            Email <a className={s.link} href="mailto:contact@soqlab.com">contact@soqlab.com</a>. If this page changes,
            the date at the top changes with it.
          </p>
        </Section>
      </main>
    </div>
  );
}
