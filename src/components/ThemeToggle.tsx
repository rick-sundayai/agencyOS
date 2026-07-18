'use client';

import { useEffect, useState } from 'react';

export const THEME_STORAGE_KEY = 'agencyos-theme';

export type Theme = 'light' | 'dark';

/** The default when the operator has never chosen — the design's reference rendering (ADR 0002). */
export const DEFAULT_THEME: Theme = 'light';

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Owns the current theme: reads the persisted choice on mount, stamps `data-theme`
 * on the document root, and toggles/persists on click. The token layer keys off
 * `data-theme`, so flipping it swaps light↔dark without touching any component.
 *
 * A tiny inline script in the root layout applies the persisted theme before paint;
 * this component keeps it in sync once React is interactive.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    // Server renders DEFAULT_THEME; this reads the client's persisted choice
    // (an external system — localStorage) and corrects state after mount.
    const stored = readStoredTheme();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(stored);
    applyTheme(stored);
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort; a blocked localStorage shouldn't break theming.
    }
  };

  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      className="btn btn-icon btn-ghost"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
    </button>
  );
}
