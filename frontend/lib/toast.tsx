"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type ToastKind = "success" | "error" | "info";

type Toast = {
  id: number;
  message: string;
  kind: ToastKind;
};

type ToastCtx = {
  toast: (message: string, kind?: ToastKind) => void;
};

const Ctx = createContext<ToastCtx>({ toast: () => {} });

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
  }, []);

  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = nextId++;
    setToasts(prev => [...prev.slice(-4), { id, message, kind }]);
    const t = setTimeout(() => dismiss(id), 4000);
    timers.current.set(id, t);
  }, [dismiss]);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach(t => clearTimeout(t));
  }, []);

  const colors: Record<ToastKind, { bg: string; border: string; icon: string }> = {
    success: { bg: "var(--ok-bg)", border: "var(--ok)", icon: "✓" },
    error:   { bg: "var(--danger-bg)", border: "var(--danger)", icon: "✕" },
    info:    { bg: "var(--info-bg)", border: "var(--strong)", icon: "i" },
  };

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      {toasts.length > 0 && (
        <div
          style={{
            position: "fixed", bottom: 24, right: 24,
            display: "flex", flexDirection: "column", gap: 10,
            zIndex: 9999, pointerEvents: "none",
          }}
          aria-live="polite"
          aria-label="Notifications"
        >
          {toasts.map(t => {
            const c = colors[t.kind];
            return (
              <div
                key={t.id}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  background: "var(--panel)", border: `1px solid ${c.border}`,
                  borderLeft: `4px solid ${c.border}`,
                  borderRadius: 8, padding: "10px 14px",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                  maxWidth: 380, fontSize: 14, color: "var(--text)",
                  pointerEvents: "all",
                  animation: "slide-in 0.2s ease",
                }}
              >
                <span style={{ fontWeight: 700, color: c.border, flexShrink: 0, width: 18, textAlign: "center" }}>
                  {c.icon}
                </span>
                <span style={{ flex: 1 }}>{t.message}</span>
                <button
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--muted)", fontSize: 16, lineHeight: 1, padding: 2,
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
      <style>{`
        @keyframes slide-in {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
