"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { fetchMe, refreshToken, type AuthUser } from "./api";

type AuthCtx = {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  setSession: (token: string, user: AuthUser) => void;
  clearSession: () => void;
};

const AuthContext = createContext<AuthCtx>({
  token: null,
  user: null,
  loading: true,
  setSession: () => {},
  clearSession: () => {},
});

const TOKEN_KEY = "qlab_token";
const USER_KEY = "qlab_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSession = useCallback((t: string, u: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setToken(t);
    setUser(u);
    // Refresh token 5 min before 24h expiry
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(async () => {
      try {
        const resp = await refreshToken(t);
        setSession(resp.access_token, u);
      } catch {
        clearSession();
      }
    }, (24 * 60 - 5) * 60 * 1000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) {
      // Verify token is still valid by hitting /auth/me
      fetchMe(t)
        .then((u) => setSession(t, u))
        .catch(() => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); })
        .finally(() => setLoading(false));
      return;
    }
    if (process.env.NODE_ENV === "development") {
      // Dev-only: auto-login with demo account so the dashboard is immediately accessible
      fetch("/qlab-api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@qlab.app", password: "admin123" }),
      })
        .then((r) => r.ok ? r.json() : Promise.reject(r))
        .then((data) => {
          if (data.access_token && data.user) setSession(data.access_token, data.user);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider value={{ token, user, loading, setSession, clearSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
