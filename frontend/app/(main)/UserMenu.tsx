"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn, LogOut, Moon, Sun } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useTheme } from "../../lib/theme";

export default function UserMenu() {
  const { user, clearSession } = useAuth();
  const router = useRouter();
  const { theme, toggle } = useTheme();

  function logout() {
    clearSession();
    router.push("/login");
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {/* Theme toggle */}
      <button
        onClick={toggle}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        style={{
          width: 34, height: 34, border: "1px solid var(--line)",
          background: "var(--input-bg)", color: "var(--muted)",
          borderRadius: 7, display: "grid", placeItems: "center", cursor: "pointer",
          transition: "color 0.15s, border-color 0.15s",
        }}
      >
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      {!user ? (
        <Link className="button" href="/login" style={{ fontSize: 14 }}>
          <LogIn size={16} aria-hidden="true" /> Sign in
        </Link>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
          <div
            style={{
              width: 30, height: 30, borderRadius: "50%",
              background: "var(--strong)", color: "#fff",
              display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13,
            }}
            aria-hidden="true"
          >
            {user.name.charAt(0).toUpperCase()}
          </div>
          <span style={{ color: "var(--text)", fontWeight: 500 }}>{user.name}</span>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>({user.role})</span>
          <button
            className="button secondary"
            onClick={logout}
            style={{ fontSize: 13, height: 32, padding: "0 10px" }}
          >
            <LogOut size={14} aria-hidden="true" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
