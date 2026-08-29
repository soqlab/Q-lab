"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { fetchMe, refreshToken, type AuthUser } from "./api";

type AuthCtx = {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  setSession: (token: string, user: AuthUser) => void;
  clearSession: () => void;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthCtx>({
  token: null,
  user: null,
  loading: true,
  setSession: () => {},
  clearSession: () => {},
  refreshUser: async () => {},
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

  const refreshUser = useCallback(async () => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) return;
    try {
      const u = await fetchMe(t);
      localStorage.setItem(USER_KEY, JSON.stringify(u));
      setUser(u);
    } catch {}
  }, []);

  // Intercept all fetch calls — auto sign-out on any 401
  useEffect(() => {
    const origFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const res = await origFetch(...args);
      if (res.status === 401) {
        const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
        // Don't intercept the login/register endpoints themselves
        if (!url.includes("/auth/login") && !url.includes("/auth/register")) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          setToken(null);
          setUser(null);
          window.location.href = "/login";
        }
      }
      return res;
    };
    return () => { window.fetch = origFetch; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) {
      // Verify token is still valid by hitting /auth/me
      fetchMe(t)
        .then((u) => setSession(t, u))
        .catch((err) => {
          // Only clear the session on a definitive 401 — not on network/server errors
          if (err instanceof Error && err.message === "401") {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USER_KEY);
          } else {
            // Network error or server down: keep the stored token and let the user in
            const stored = localStorage.getItem(USER_KEY);
            const u = stored ? JSON.parse(stored) as AuthUser : null;
            if (u) setSession(t, u);
          }
        })
        .finally(() => setLoading(false));
      return;
    }
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider value={{ token, user, loading, setSession, clearSession, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
