"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

type Theme = "light" | "dark";

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "light",
  toggle: () => {},
});

const KEY = "qlab_theme";
const EVENT = "qlab-theme-change";

// The inline script in app/layout.tsx sets data-theme from the saved choice (or the OS preference)
// before the first paint, so the attribute is the current theme and there is no flash.
function read(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, read, () => "light" as Theme);

  function toggle() {
    const next: Theme = read() === "light" ? "dark" : "light";
    try { localStorage.setItem(KEY, next); } catch { /* private mode: this page only */ }
    document.documentElement.setAttribute("data-theme", next);
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
