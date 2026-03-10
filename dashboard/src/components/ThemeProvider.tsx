'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'dark', toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    try {
      // 1. Explicit user preference always wins
      const saved = localStorage.getItem('theme') as Theme | null;
      if (saved) {
        setTheme(saved);
        return;
      }
      // 2. System preference
      if (window.matchMedia('(prefers-color-scheme: light)').matches) {
        setTheme('light');
        document.documentElement.setAttribute('data-theme', 'light');
        return;
      }
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        setTheme('dark');
        return;
      }
      // 3. Time-based fallback: light 06:00–19:00, dark otherwise
      const h = new Date().getHours();
      const auto: Theme = h >= 6 && h < 19 ? 'light' : 'dark';
      setTheme(auto);
      if (auto === 'light') document.documentElement.setAttribute('data-theme', 'light');
    } catch {
      // Fallback: keep dark theme if localStorage/matchMedia unavailable
    }
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
