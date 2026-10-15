/**
 * Theme service — Aura Design System dual-theme controller.
 *
 * The active theme is expressed as a `data-theme` attribute on the root
 * `<html>` element, which is what the token sheets in `styles/theme.css`
 * switch on. The choice is persisted in localStorage and falls back to the
 * visitor's operating system preference on a first visit.
 *
 * A tiny subscriber list lets React components re-render when the theme
 * changes without pulling in extra state management.
 */

const THEME_STORAGE_KEY = 'aura_theme';

const listeners = new Set();

/**
 * The stored theme, or null when nothing valid is persisted.
 * @returns {'dark'|'light'|null}
 */
export function getStoredTheme() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : null;
  } catch {
    // Storage can throw in private/embedded contexts. A failed read is the
    // same as no preference: fall back to the system.
    return null;
  }
}

/**
 * The theme to use if the visitor has no stored preference.
 * @returns {'dark'|'light'}
 */
export function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

/**
 * The theme currently applied to the document.
 * @returns {'dark'|'light'}
 */
export function getTheme() {
  if (typeof document === 'undefined') return 'dark';
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'light' ? 'light' : 'dark';
}

/**
 * Apply a theme to the document and persist the choice.
 * @param {'dark'|'light'} theme
 */
export function setTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';

  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', next);
    // The `.light-theme` class mirrors the attribute for any stylesheet that
    // keys off a class rather than the attribute.
    document.documentElement.classList.toggle('light-theme', next === 'light');
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persistence is best effort; the attribute above still applies.
    }
  }

  listeners.forEach((listener) => {
    try {
      listener(next);
    } catch {
      // A broken subscriber must not stop the others from being notified.
    }
  });
}

/** Flip between dark and light. */
export function toggleTheme() {
  setTheme(getTheme() === 'light' ? 'dark' : 'light');
}

/**
 * Subscribe to theme changes. Returns an unsubscribe function.
 * @param {(theme: 'dark'|'light') => void} listener
 * @returns {() => void}
 */
export function subscribeTheme(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Resolve and apply the initial theme. Called once from the app entry so the
 * first paint already carries the right tokens.
 * @returns {'dark'|'light'}
 */
export function initTheme() {
  const resolved = getStoredTheme() || getSystemTheme();
  setTheme(resolved);
  return resolved;
}
