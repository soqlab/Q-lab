"""
Q-Lab Email Service
-------------------
Priority order:
  1. RESEND_API_KEY set  → Resend REST API via httpx
  2. SMTP_HOST set       → smtplib SMTP
  3. Neither             → log-only mode (prints to stdout, returns True)
"""
from __future__ import annotations

import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Configuration helpers
# ---------------------------------------------------------------------------

def is_email_configured() -> bool:
    """Return True if any email transport is configured."""
    return bool(os.getenv("RESEND_API_KEY") or os.getenv("SMTP_HOST"))

# ---------------------------------------------------------------------------
# Shared HTML helpers
# ---------------------------------------------------------------------------

_BASE_STYLE = """
  body { margin:0; padding:0; background:#0f0e17; font-family:'Segoe UI',Arial,sans-serif; }
  table { border-collapse:collapse; }
  a { color:#818cf8; text-decoration:none; }
  a:hover { text-decoration:underline; }
"""

_LOGO_HTML = """
  <tr>
    <td align="center" style="padding:40px 0 24px;">
      <span style="font-size:26px;font-weight:700;letter-spacing:-0.5px;color:#a5b4fc;">
        &#9654;&#9654; Q-Lab
      </span>
    </td>
  </tr>
"""


def _wrap_email(title: str, body_html: str) -> str:
    """Wraps body HTML in a complete, professional Q-Lab branded email template."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{title}</title>
  <style>{_BASE_STYLE}</style>
</head>
<body>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0e17;min-height:100vh;">
    <tr>
      <td align="center" style="padding:20px 16px 40px;">
        <table width="600" cellpadding="0" cellspacing="0"
               style="max-width:600px;width:100%;background:#1a1829;border-radius:12px;
                      border:1px solid #312e5e;overflow:hidden;">
          {_LOGO_HTML}
          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <div style="height:1px;background:linear-gradient(90deg,transparent,#4f46e5,transparent);"></div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 28px;">
              {body_html}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:0 40px 36px;">
              <div style="height:1px;background:#1e1c35;margin-bottom:24px;"></div>
              <p style="margin:0;font-size:12px;color:#4b4870;text-align:center;line-height:1.6;">
                Q-Lab &mdash; Quantum Experiment Tracker<br>
                You received this email because an action was taken on your account.<br>
                If you did not expect this, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Core send_email
# ---------------------------------------------------------------------------

def send_email(
    to: str,
    subject: str,
    html: str,
    from_addr: str = "Q-Lab <noreply@qlab.app>",
) -> bool:
    """
    Send an HTML email using whichever transport is configured.

    Returns True on success, False on failure.
    Never raises — all exceptions are caught and logged.
    """
    resend_key = os.getenv("RESEND_API_KEY")
    smtp_host = os.getenv("SMTP_HOST")

    if resend_key:
        return _send_via_resend(to, subject, html, from_addr, resend_key)
    elif smtp_host:
        return _send_via_smtp(to, subject, html, from_addr, smtp_host)
    else:
        _send_log_only(to, subject)
        return True


def _send_via_resend(
    to: str,
    subject: str,
    html: str,
    from_addr: str,
    api_key: str,
) -> bool:
    try:
        import httpx  # already in requirements.txt

        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "from": from_addr,
                "to": [to],
                "subject": subject,
                "html": html,
            },
            timeout=10,
        )
        if resp.status_code in (200, 201):
            logger.info("Email sent via Resend to %s (subject=%r)", to, subject)
            return True
        logger.error(
            "Resend returned %s for %s: %s", resp.status_code, to, resp.text[:200]
        )
        return False
    except Exception as exc:
        logger.exception("Resend email failed for %s: %s", to, exc)
        return False


def _send_via_smtp(
    to: str,
    subject: str,
    html: str,
    from_addr: str,
    smtp_host: str,
) -> bool:
    try:
        port = int(os.getenv("SMTP_PORT", "587"))
        smtp_user = os.getenv("SMTP_USER", "")
        smtp_pass = os.getenv("SMTP_PASS", "")

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = from_addr
        msg["To"] = to
        msg.attach(MIMEText(html, "html", "utf-8"))

        with smtplib.SMTP(smtp_host, port, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            if smtp_user:
                server.login(smtp_user, smtp_pass)
            server.sendmail(from_addr, [to], msg.as_string())

        logger.info("Email sent via SMTP to %s (subject=%r)", to, subject)
        return True
    except Exception as exc:
        logger.exception("SMTP email failed for %s: %s", to, exc)
        return False


def _send_log_only(to: str, subject: str) -> None:
    print(f"[Q-Lab Email — log-only mode]  to={to!r}  subject={subject!r}")
    logger.info("[log-only] Email to %s | subject=%r", to, subject)


# ---------------------------------------------------------------------------
# send_invite_email
# ---------------------------------------------------------------------------

def send_invite_email(
    to_email: str,
    invite_url: str,
    org_name: str,
    invited_by: str,
) -> bool:
    """Send a team invitation email."""
    subject = f"You've been invited to join {org_name} on Q-Lab"

    body = f"""
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#e0e7ff;">
        You've been invited!
      </h2>
      <p style="margin:0 0 20px;font-size:15px;color:#9ca3c4;line-height:1.6;">
        <strong style="color:#c7d2fe;">{invited_by}</strong>
        has invited you to collaborate on
        <strong style="color:#c7d2fe;">{org_name}</strong> on Q-Lab,
        the quantum experiment tracker.
      </p>

      <!-- CTA button -->
      <table cellpadding="0" cellspacing="0" style="margin:28px 0;">
        <tr>
          <td align="center"
              style="background:linear-gradient(135deg,#4f46e5,#7c3aed);
                     border-radius:8px;padding:14px 32px;">
            <a href="{invite_url}"
               style="font-size:15px;font-weight:600;color:#ffffff;
                      text-decoration:none;letter-spacing:0.3px;">
              Accept Invitation &rarr;
            </a>
          </td>
        </tr>
      </table>

      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;line-height:1.6;">
        Or copy this link into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:12px;word-break:break-all;
                color:#818cf8;background:#111827;border-radius:6px;
                padding:10px 14px;font-family:monospace;">
        {invite_url}
      </p>

      <p style="margin:0;font-size:13px;color:#4b4870;line-height:1.6;">
        This invitation expires in 7 days. If you were not expecting this,
        you can safely ignore this email.
      </p>
    """

    return send_email(
        to=to_email,
        subject=subject,
        html=_wrap_email(subject, body),
    )


# ---------------------------------------------------------------------------
# send_alert_email
# ---------------------------------------------------------------------------

def send_alert_email(
    to_email: str,
    alert_type: str,
    details: dict,
) -> bool:
    """Send a system alert email (budget, decoherence, etc.)."""
    subject = f"Q-Lab Alert: {alert_type}"

    rows_html = "".join(
        f"""
        <tr>
          <td style="padding:8px 12px;font-size:13px;color:#9ca3c4;
                     border-bottom:1px solid #1e1c35;width:40%;">
            {key}
          </td>
          <td style="padding:8px 12px;font-size:13px;color:#e0e7ff;
                     border-bottom:1px solid #1e1c35;font-family:monospace;">
            {value}
          </td>
        </tr>"""
        for key, value in details.items()
    )

    body = f"""
      <div style="display:inline-block;background:#7c2d12;border-radius:6px;
                  padding:4px 12px;margin-bottom:20px;">
        <span style="font-size:12px;font-weight:600;color:#fca5a5;
                     text-transform:uppercase;letter-spacing:0.5px;">
          Alert
        </span>
      </div>

      <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#e0e7ff;">
        {alert_type}
      </h2>
      <p style="margin:0 0 24px;font-size:14px;color:#9ca3c4;line-height:1.6;">
        A system alert has been triggered in your Q-Lab workspace.
        Review the details below and take appropriate action.
      </p>

      <!-- Details table -->
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:#111827;border-radius:8px;overflow:hidden;
                    border:1px solid #1e1c35;margin-bottom:28px;">
        {rows_html if rows_html else '<tr><td style="padding:16px;color:#6b7280;font-size:13px;">No additional details.</td></tr>'}
      </table>

      <p style="margin:0;font-size:13px;color:#4b4870;line-height:1.6;">
        Log in to Q-Lab to manage your alerts and thresholds.
      </p>
    """

    return send_email(
        to=to_email,
        subject=subject,
        html=_wrap_email(subject, body),
    )


# ---------------------------------------------------------------------------
# send_password_reset_email
# ---------------------------------------------------------------------------

def send_password_reset_email(
    to_email: str,
    reset_url: str,
) -> bool:
    """Send a password reset link email."""
    subject = "Reset your Q-Lab password"

    body = f"""
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#e0e7ff;">
        Reset your password
      </h2>
      <p style="margin:0 0 20px;font-size:15px;color:#9ca3c4;line-height:1.6;">
        We received a request to reset the password for your Q-Lab account.
        Click the button below to choose a new password.
        This link expires in <strong style="color:#c7d2fe;">15 minutes</strong>.
      </p>

      <!-- CTA button -->
      <table cellpadding="0" cellspacing="0" style="margin:28px 0;">
        <tr>
          <td align="center"
              style="background:linear-gradient(135deg,#4f46e5,#7c3aed);
                     border-radius:8px;padding:14px 32px;">
            <a href="{reset_url}"
               style="font-size:15px;font-weight:600;color:#ffffff;
                      text-decoration:none;letter-spacing:0.3px;">
              Reset Password &rarr;
            </a>
          </td>
        </tr>
      </table>

      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;line-height:1.6;">
        Or copy this link into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:12px;word-break:break-all;
                color:#818cf8;background:#111827;border-radius:6px;
                padding:10px 14px;font-family:monospace;">
        {reset_url}
      </p>

      <p style="margin:0;font-size:13px;color:#4b4870;line-height:1.6;">
        If you did not request a password reset, you can safely ignore this email.
        Your password will not change.
      </p>
    """

    return send_email(
        to=to_email,
        subject=subject,
        html=_wrap_email(subject, body),
    )


# ---------------------------------------------------------------------------
# send_welcome_email
# ---------------------------------------------------------------------------

def send_welcome_email(
    to_email: str,
    user_name: str,
) -> bool:
    """Send a welcome email to a newly registered user."""
    subject = "Welcome to Q-Lab"

    body = f"""
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#e0e7ff;">
        Welcome to Q-Lab, {user_name}!
      </h2>
      <p style="margin:0 0 20px;font-size:15px;color:#9ca3c4;line-height:1.6;">
        Your account is ready. Q-Lab is your passive experiment tracker for Qiskit
        circuits &mdash; track runs, compare backends, and collaborate with your team,
        all without changing your existing workflow.
      </p>

      <!-- Feature highlights -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
        <tr>
          <td style="padding:12px 16px;background:#111827;border-radius:8px 8px 0 0;
                     border:1px solid #1e1c35;border-bottom:none;">
            <span style="font-size:18px;">&#9654;</span>
            <span style="font-size:14px;font-weight:600;color:#c7d2fe;margin-left:8px;">
              Automatic Run Capture
            </span>
            <p style="margin:4px 0 0 26px;font-size:13px;color:#6b7280;">
              Decorate any Qiskit circuit and results are logged automatically.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 16px;background:#111827;
                     border:1px solid #1e1c35;border-bottom:none;">
            <span style="font-size:18px;">&#128200;</span>
            <span style="font-size:14px;font-weight:600;color:#c7d2fe;margin-left:8px;">
              Backend Benchmarking
            </span>
            <p style="margin:4px 0 0 26px;font-size:13px;color:#6b7280;">
              Compare fidelity and performance across IBM, IonQ, and Braket.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 16px;background:#111827;border-radius:0 0 8px 8px;
                     border:1px solid #1e1c35;">
            <span style="font-size:18px;">&#128101;</span>
            <span style="font-size:14px;font-weight:600;color:#c7d2fe;margin-left:8px;">
              Team Collaboration
            </span>
            <p style="margin:4px 0 0 26px;font-size:13px;color:#6b7280;">
              Invite teammates, share results, and set up alerts together.
            </p>
          </td>
        </tr>
      </table>

      <!-- CTA button -->
      <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
        <tr>
          <td align="center"
              style="background:linear-gradient(135deg,#4f46e5,#7c3aed);
                     border-radius:8px;padding:14px 32px;">
            <a href="http://localhost:3000"
               style="font-size:15px;font-weight:600;color:#ffffff;
                      text-decoration:none;letter-spacing:0.3px;">
              Open Q-Lab &rarr;
            </a>
          </td>
        </tr>
      </table>

      <p style="margin:0;font-size:13px;color:#4b4870;line-height:1.6;">
        Questions? Reply to this email or check our documentation.<br>
        Happy experimenting!
      </p>
    """

    return send_email(
        to=to_email,
        subject=subject,
        html=_wrap_email(subject, body),
    )


# ---------------------------------------------------------------------------
# Experiment event email templates
# ---------------------------------------------------------------------------

def _stat_row(label: str, value: str) -> str:
    return (
        f'<tr>'
        f'<td style="padding:9px 14px;font-size:13px;color:#9ca3c4;border-bottom:1px solid #1e1c35;width:45%;">{label}</td>'
        f'<td style="padding:9px 14px;font-size:13px;color:#e0e7ff;border-bottom:1px solid #1e1c35;font-family:monospace;">{value}</td>'
        f'</tr>'
    )


def _health_badge(score: float | int) -> str:
    if score >= 70:
        color, bg = "#86efac", "#14532d"
    elif score >= 40:
        color, bg = "#fcd34d", "#78350f"
    else:
        color, bg = "#fca5a5", "#7f1d1d"
    return (
        f'<span style="display:inline-block;background:{bg};color:{color};'
        f'font-weight:700;font-size:20px;padding:6px 18px;border-radius:8px;'
        f'font-family:monospace;">{score}</span>'
    )


def run_complete_email(
    run_id: str,
    run_name: str,
    health_score: float | int,
    backend: str,
    duration_s: float,
) -> str:
    """Return HTML for a run-complete notification email."""
    subject = f"Run complete: {run_name}"
    rows = (
        _stat_row("Run ID", run_id)
        + _stat_row("Backend", backend)
        + _stat_row("Duration", f"{duration_s:.1f} s")
        + _stat_row("Status", "Completed")
    )
    body = f"""
      <div style="display:inline-block;background:#134e26;border-radius:6px;
                  padding:4px 12px;margin-bottom:20px;">
        <span style="font-size:12px;font-weight:600;color:#86efac;
                     text-transform:uppercase;letter-spacing:0.5px;">Run Complete</span>
      </div>
      <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#e0e7ff;">
        {run_name}
      </h2>
      <p style="margin:0 0 22px;font-size:14px;color:#9ca3c4;">
        Your quantum experiment finished successfully.
      </p>
      <div style="margin-bottom:22px;">
        <p style="margin:0 0 8px;font-size:12px;color:#6b7280;text-transform:uppercase;
                  letter-spacing:0.5px;">Health Score</p>
        {_health_badge(health_score)}
      </div>
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:#111827;border-radius:8px;overflow:hidden;
                    border:1px solid #1e1c35;margin-bottom:28px;">
        {rows}
      </table>
      <p style="margin:0;font-size:13px;color:#4b4870;line-height:1.6;">
        Open Q-Lab to view full results, circuit details, and calibration data.
      </p>
    """
    return _wrap_email(subject, body)


def run_failed_email(
    run_id: str,
    run_name: str,
    error_message: str,
    backend: str,
) -> str:
    """Return HTML for a run-failed notification email."""
    subject = f"Run failed: {run_name}"
    rows = (
        _stat_row("Run ID", run_id)
        + _stat_row("Backend", backend)
        + _stat_row("Status", "Failed")
    )
    body = f"""
      <div style="display:inline-block;background:#7c2d12;border-radius:6px;
                  padding:4px 12px;margin-bottom:20px;">
        <span style="font-size:12px;font-weight:600;color:#fca5a5;
                     text-transform:uppercase;letter-spacing:0.5px;">Run Failed</span>
      </div>
      <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#e0e7ff;">
        {run_name}
      </h2>
      <p style="margin:0 0 22px;font-size:14px;color:#9ca3c4;">
        Your experiment encountered an error and could not complete.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:#111827;border-radius:8px;overflow:hidden;
                    border:1px solid #1e1c35;margin-bottom:20px;">
        {rows}
      </table>
      <div style="background:#1a0a0a;border-left:3px solid #ef4444;border-radius:4px;
                  padding:12px 16px;margin-bottom:28px;">
        <p style="margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase;
                  letter-spacing:0.5px;">Error</p>
        <p style="margin:0;font-size:13px;color:#fca5a5;font-family:monospace;
                  word-break:break-all;">{error_message}</p>
      </div>
      <p style="margin:0;font-size:13px;color:#4b4870;line-height:1.6;">
        Open Q-Lab to inspect logs and retry the run.
      </p>
    """
    return _wrap_email(subject, body)


def alert_triggered_email(
    alert_name: str,
    metric: str,
    value: float | int,
    threshold: float | int,
    run_id: str,
) -> str:
    """Return HTML for an alert-triggered notification email."""
    subject = f"Alert triggered: {alert_name}"
    rows = (
        _stat_row("Alert", alert_name)
        + _stat_row("Metric", metric)
        + _stat_row("Observed value", str(value))
        + _stat_row("Threshold", str(threshold))
        + _stat_row("Run ID", run_id)
    )
    body = f"""
      <div style="display:inline-block;background:#451a03;border-radius:6px;
                  padding:4px 12px;margin-bottom:20px;">
        <span style="font-size:12px;font-weight:600;color:#fcd34d;
                     text-transform:uppercase;letter-spacing:0.5px;">Alert Triggered</span>
      </div>
      <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#e0e7ff;">
        {alert_name}
      </h2>
      <p style="margin:0 0 22px;font-size:14px;color:#9ca3c4;">
        A monitoring threshold was crossed in your Q-Lab workspace.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:#111827;border-radius:8px;overflow:hidden;
                    border:1px solid #1e1c35;margin-bottom:28px;">
        {rows}
      </table>
      <p style="margin:0;font-size:13px;color:#4b4870;line-height:1.6;">
        Log in to Q-Lab to manage alert rules and view the full run details.
      </p>
    """
    return _wrap_email(subject, body)


def weekly_digest_email(
    user_name: str,
    total_runs: int,
    avg_health: float | None,
    top_backend: str,
    week_label: str,
) -> str:
    """Return HTML for a weekly digest notification email."""
    subject = f"Q-Lab Weekly Digest — {week_label}"
    health_str = f"{avg_health:.1f}" if avg_health is not None else "—"
    body = f"""
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#e0e7ff;">
        Your week in Q-Lab
      </h2>
      <p style="margin:0 0 24px;font-size:14px;color:#9ca3c4;line-height:1.6;">
        Hi {user_name}, here's a summary of your quantum experiments for
        <strong style="color:#c7d2fe;">{week_label}</strong>.
      </p>

      <!-- KPI strip -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr>
          <td width="33%" style="padding:0 6px 0 0;">
            <div style="background:#111827;border-radius:10px;border:1px solid #1e1c35;
                        padding:18px;text-align:center;">
              <div style="font-size:30px;font-weight:700;color:#a5b4fc;">{total_runs}</div>
              <div style="font-size:11px;color:#6b7280;text-transform:uppercase;
                          letter-spacing:0.5px;margin-top:4px;">Total Runs</div>
            </div>
          </td>
          <td width="33%" style="padding:0 3px;">
            <div style="background:#111827;border-radius:10px;border:1px solid #1e1c35;
                        padding:18px;text-align:center;">
              <div style="font-size:30px;font-weight:700;color:#86efac;">{health_str}</div>
              <div style="font-size:11px;color:#6b7280;text-transform:uppercase;
                          letter-spacing:0.5px;margin-top:4px;">Avg Health</div>
            </div>
          </td>
          <td width="33%" style="padding:0 0 0 6px;">
            <div style="background:#111827;border-radius:10px;border:1px solid #1e1c35;
                        padding:18px;text-align:center;">
              <div style="font-size:16px;font-weight:700;color:#fcd34d;
                          word-break:break-all;">{top_backend}</div>
              <div style="font-size:11px;color:#6b7280;text-transform:uppercase;
                          letter-spacing:0.5px;margin-top:4px;">Top Backend</div>
            </div>
          </td>
        </tr>
      </table>

      <p style="margin:0;font-size:13px;color:#4b4870;line-height:1.6;">
        Open Q-Lab to explore detailed analytics and backend benchmarks for this period.<br>
        To stop receiving weekly digests, update your notification preferences.
      </p>
    """
    return _wrap_email(subject, body)


def new_peer_review_email(
    reviewer_name: str,
    run_name: str,
    review_link: str,
) -> str:
    """Return HTML for a new peer review request notification email."""
    subject = f"Peer review requested: {run_name}"
    body = f"""
      <div style="display:inline-block;background:#1e1b4b;border-radius:6px;
                  padding:4px 12px;margin-bottom:20px;">
        <span style="font-size:12px;font-weight:600;color:#a5b4fc;
                     text-transform:uppercase;letter-spacing:0.5px;">Peer Review</span>
      </div>
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#e0e7ff;">
        Review requested for {run_name}
      </h2>
      <p style="margin:0 0 22px;font-size:14px;color:#9ca3c4;line-height:1.6;">
        <strong style="color:#c7d2fe;">{reviewer_name}</strong> has requested your review
        of this quantum experiment. Your expertise helps the team maintain high
        scientific standards.
      </p>

      <!-- CTA button -->
      <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
        <tr>
          <td align="center"
              style="background:linear-gradient(135deg,#4f46e5,#7c3aed);
                     border-radius:8px;padding:14px 32px;">
            <a href="{review_link}"
               style="font-size:15px;font-weight:600;color:#ffffff;
                      text-decoration:none;letter-spacing:0.3px;">
              Open Review &rarr;
            </a>
          </td>
        </tr>
      </table>

      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;line-height:1.6;">
        Or copy this link into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:12px;word-break:break-all;
                color:#818cf8;background:#111827;border-radius:6px;
                padding:10px 14px;font-family:monospace;">
        {review_link}
      </p>
      <p style="margin:0;font-size:13px;color:#4b4870;line-height:1.6;">
        If you were not expecting this request, you can safely ignore this email.
      </p>
    """
    return _wrap_email(subject, body)


# ---------------------------------------------------------------------------
# Background notification hook (Task 3)
# ---------------------------------------------------------------------------

def notify_run_event(
    run_id: str,
    event: str,
    user_email: str,
    extra: dict[str, Any],
) -> bool:
    """
    High-level hook called by other parts of the app when a run event occurs.

    Steps:
      1. Look up user notification preferences from the GenericRecord store.
      2. Check whether this event type is enabled.
      3. Send the appropriate email template.
      4. Log the notification to history.

    Returns True if an email was sent, False otherwise.
    Uses user_email as the store key (since user_id may not always be available).
    Never raises — failures are caught and logged.
    """
    # Import here to avoid circular imports (store => models => database all OK,
    # but keeping deps lazy avoids any startup ordering issues).
    try:
        from .database import SessionLocal
        from .store import store_get, store_put

        db = SessionLocal()
        try:
            # 1. Load preferences
            prefs_key = f"user_{user_email}"
            prefs: dict[str, Any] = store_get(db, "notifications_prefs", prefs_key) or {}

            # Determine notification email (may differ from login email)
            notify_email: str = prefs.get("email") or user_email

            # 2. Check event gate
            event_gate_map = {
                "run_complete": "on_run_complete",
                "run_failed": "on_run_failed",
                "alert_triggered": "on_alert_triggered",
                "weekly_digest": "weekly_digest",
                "peer_review": "on_peer_review_request",
            }
            gate_key = event_gate_map.get(event)
            if gate_key and not prefs.get(gate_key, True):
                logger.debug(
                    "notify_run_event: event %r suppressed by prefs for %s", event, user_email
                )
                return False

            # For run_complete, also respect min_health_score_to_notify
            if event == "run_complete":
                min_health: int = int(prefs.get("min_health_score_to_notify", 0))
                health_score = extra.get("health_score", 100)
                if min_health > 0 and health_score >= min_health:
                    logger.debug(
                        "notify_run_event: health %s >= min %s, suppressed", health_score, min_health
                    )
                    return False

            # 3. Build and send email
            sent = False
            subject = f"[Q-Lab] {event}"
            html_body = ""

            if event == "run_complete":
                html_body = run_complete_email(
                    run_id=run_id,
                    run_name=extra.get("run_name", run_id),
                    health_score=extra.get("health_score", 0),
                    backend=extra.get("backend", "unknown"),
                    duration_s=float(extra.get("duration_s", 0)),
                )
                subject = f"Run complete: {extra.get('run_name', run_id)}"

            elif event == "run_failed":
                html_body = run_failed_email(
                    run_id=run_id,
                    run_name=extra.get("run_name", run_id),
                    error_message=extra.get("error_message", "Unknown error"),
                    backend=extra.get("backend", "unknown"),
                )
                subject = f"Run failed: {extra.get('run_name', run_id)}"

            elif event == "alert_triggered":
                html_body = alert_triggered_email(
                    alert_name=extra.get("alert_name", "Alert"),
                    metric=extra.get("metric", "unknown"),
                    value=extra.get("value", 0),
                    threshold=extra.get("threshold", 0),
                    run_id=run_id,
                )
                subject = f"Alert triggered: {extra.get('alert_name', 'Alert')}"

            elif event == "weekly_digest":
                html_body = weekly_digest_email(
                    user_name=extra.get("user_name", user_email),
                    total_runs=int(extra.get("total_runs", 0)),
                    avg_health=extra.get("avg_health"),
                    top_backend=extra.get("top_backend", "—"),
                    week_label=extra.get("week_label", "this week"),
                )
                subject = f"Q-Lab Weekly Digest — {extra.get('week_label', 'this week')}"

            elif event == "peer_review":
                html_body = new_peer_review_email(
                    reviewer_name=extra.get("reviewer_name", "A colleague"),
                    run_name=extra.get("run_name", run_id),
                    review_link=extra.get("review_link", ""),
                )
                subject = f"Peer review requested: {extra.get('run_name', run_id)}"

            if html_body:
                sent = send_email(to=notify_email, subject=subject, html=html_body)
            else:
                logger.warning("notify_run_event: no template for event %r", event)

            # 4. Log to history
            import datetime as _dt
            ts = _dt.datetime.now(_dt.timezone.utc).isoformat()
            history_key = f"{user_email}_{ts}"
            store_put(db, "notifications_history", history_key, {
                "user_email": user_email,
                "event": event,
                "run_id": run_id,
                "subject": subject,
                "status": "sent" if sent else "failed",
                "timestamp": ts,
                "extra": {k: str(v) for k, v in extra.items()},
            })

            return sent

        finally:
            db.close()

    except Exception as exc:
        logger.exception("notify_run_event failed for %s / %s: %s", user_email, event, exc)
        return False


def send_verification_email(to_email: str, verify_url: str) -> bool:
    """Send an email address verification link."""
    subject = "Verify your Q-Lab email address"
    body = f"""
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#e0e7ff;">
        Confirm your email
      </h2>
      <p style="margin:0 0 20px;font-size:15px;color:#9ca3c4;line-height:1.6;">
        Thanks for signing up for Q-Lab. Click the button below to verify your
        email address and activate your account.
        This link expires in <strong style="color:#c7d2fe;">24 hours</strong>.
      </p>

      <table cellpadding="0" cellspacing="0" style="margin:28px 0;">
        <tr>
          <td align="center"
              style="background:linear-gradient(135deg,#4f46e5,#7c3aed);
                     border-radius:8px;padding:14px 32px;">
            <a href="{verify_url}"
               style="font-size:15px;font-weight:600;color:#ffffff;
                      text-decoration:none;letter-spacing:0.3px;">
              Verify Email Address &rarr;
            </a>
          </td>
        </tr>
      </table>

      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;line-height:1.6;">
        Or copy this link into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:12px;word-break:break-all;
                color:#818cf8;background:#111827;border-radius:6px;
                padding:10px 14px;font-family:monospace;">
        {verify_url}
      </p>

      <p style="margin:0;font-size:13px;color:#4b4870;line-height:1.6;">
        If you did not create a Q-Lab account, you can safely ignore this email.
      </p>
    """
    return send_email(to=to_email, subject=subject, html=_wrap_email(subject, body))


def send_account_deleted_email(to_email: str, user_name: str) -> bool:
    """Notify a user that their account has been deleted."""
    subject = "Your Q-Lab account has been deleted"
    body = f"""
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#e0e7ff;">
        Account deleted
      </h2>
      <p style="margin:0 0 20px;font-size:15px;color:#9ca3c4;line-height:1.6;">
        Hi {user_name}, your Q-Lab account and associated data have been permanently deleted
        as requested. You will no longer be able to log in with this email address.
      </p>
      <p style="margin:0;font-size:13px;color:#4b4870;line-height:1.6;">
        If you did not request this, please contact us immediately at
        <a href="mailto:stateofquantumlab@gmail.com">stateofquantumlab@gmail.com</a>.
      </p>
    """
    return send_email(to=to_email, subject=subject, html=_wrap_email(subject, body))


def send_contact_email(name: str, from_email: str, message: str) -> bool:
    """Forward a contact-form submission to the platform owner."""
    owner = os.getenv("CONTACT_RECIPIENT_EMAIL", "stateofquantumlab@gmail.com")
    subject = f"Q-Lab contact from {name}"
    html = f"""
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;
                background:#111827;border-radius:12px;padding:32px;color:#e5e7eb;">
      <h2 style="margin:0 0 16px;font-size:20px;color:#c7d2fe;">New contact message</h2>
      <p style="margin:0 0 8px;font-size:14px;color:#9ca3af;"><strong style="color:#e5e7eb;">From:</strong> {name} &lt;{from_email}&gt;</p>
      <div style="margin:16px 0;padding:16px;background:#1f2937;border-radius:8px;
                  font-size:14px;color:#d1d5db;line-height:1.6;white-space:pre-wrap;">{message}</div>
      <p style="margin:0;font-size:12px;color:#6b7280;">Sent via Q-Lab contact form</p>
    </div>
    """
    return send_email(to=owner, subject=subject, html=html, from_addr=f"Q-Lab Contact <noreply@qlab.app>")
