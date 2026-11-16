"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { FlaskConical, LogIn, LogOut, Moon, Sun } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useTheme } from "../../lib/theme";
import { DETAILS, DETAIL_LABEL, useDetail, withDetail } from "../../lib/dial";
import { useLabs } from "../../lib/labs";

const DETAIL_HINT = {
  plain: "Plain words: the answer and little else",
  standard: "The usual view",
  expert: "Everything, including raw records",
} as const;

/**
 * The account menu: who you are, how much detail pages show, the theme, settings and sign out.
 * A <details> element, so it opens with Enter or Space; Escape and a click outside close it.
 */
export default function UserMenu() {
  const { user, clearSession } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const [d, setD] = useDetail();
  const [labs, setLabs, labsReady] = useLabs();
  const box = useRef<HTMLDetailsElement>(null);

  // A page change closes it.
  useEffect(() => { if (box.current) box.current.open = false; }, [pathname]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onDown = (e: MouseEvent) => { if (el.open && !el.contains(e.target as Node)) el.open = false; };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && el.open) { el.open = false; el.querySelector("summary")?.focus(); }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, []);

  function logout() {
    clearSession();
    // The hosted app returns to the company site; self-hosted installs stay on their own login page.
    if (window.location.hostname.endsWith("soqlab.com")) window.location.replace("https://soqlab.com");
    else router.push("/login");
  }

  return (
    <div className="user-menu" style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {!user && (
        <Link className="button" href="/login" style={{ fontSize: 14 }}>
          <LogIn size={16} aria-hidden="true" /> Sign in
        </Link>
      )}
      <details ref={box} className="actions-menu user-menu-box">
        <summary aria-label={user ? `Menu for ${user.name}: detail, theme, settings, sign out` : "Menu: detail and theme"}>
          {user ? (
            <>
              <span className="user-menu-avatar" aria-hidden="true">{user.name.charAt(0).toUpperCase()}</span>
              <span className="user-menu-name">{user.name}</span>
            </>
          ) : <span>Menu</span>}
          <span aria-hidden="true">▾</span>
        </summary>
        <div className="actions-panel">
          <div className="actions-group" id="user-menu-detail">Detail</div>
          <div className="actions-item detail-pick" role="group" aria-labelledby="user-menu-detail">
            {DETAILS.map((x) => (
              <button key={x} type="button" aria-pressed={d === x} onClick={() => setD(x)}>
                {DETAIL_LABEL[x]}
              </button>
            ))}
          </div>
          <p className="detail-hint" aria-live="polite">{DETAIL_HINT[d]}. Links you copy keep this level.</p>
          <hr />
          <button type="button" onClick={toggle}>
            {theme === "dark" ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>
          {labsReady && (
            <button type="button" onClick={() => setLabs(!labs)} aria-pressed={labs}>
              <FlaskConical size={14} aria-hidden="true" />
              Show all Labs tools: {labs ? "on" : "off"}
            </button>
          )}
          {user && (
            <>
              <Link href={withDetail("/settings", d)}>Settings</Link>
              <Link href={withDetail("/labs", d)}>Labs</Link>
              <hr />
              <button type="button" onClick={logout}>
                <LogOut size={14} aria-hidden="true" /> Sign out
              </button>
            </>
          )}
        </div>
      </details>
    </div>
  );
}
