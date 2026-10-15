# Aura Design System — Visual & UI/UX Style Guide

This document establishes the official design guidelines for the **Aura Design System**, derived directly from the reference interface designs. It is engineered to allow seamless application to an existing frontend codebase without altering core component logic, routes, or business functionality.

---

## 1. Visual Identity & Design Philosophy

The visual theme of this interface can be described as **Warm Editorial Precision** — a synthesis of high-end clinical software and modern luxury editorial aesthetics.

### Core Visual Pillars
1. **Warm Dark Foundations**: Instead of cold, blue-toned charcoal or pure black (`#000000`), the dark theme relies on warm, dark espresso and stone tones (`#0D0B0A`, `#161311`, `#221C18`).
2. **Editorial Typography**: Pairing rich, modern Serif display fonts (for headings and expressive italicized emphasis) with clean, high-legibility Sans-Serif body copy and Monospaced technical metadata.
3. **Pill Geometry & Organic Softness**: Extensive use of fully rounded pill shapes (`border-radius: 9999px`) for CTA buttons, status tags, search bars, and active navigation indicators, balanced by soft `12px–16px` rounded container cards.
4. **Subtle Warm Luminescence**: Minimalist radial glows, warm copper accents (`#E0936E` / `#E5A886`), and soft borders instead of heavy drop shadows or bright saturated neon colors.
5. **Complementary Warm Light Theme**: A light theme built on warm ivory, linen, and soft cream tones (`#FAF8F5`, `#FFFFFF`, `#F2EDE4`) rather than harsh stark white or corporate blue-gray, maintaining identical luxury and visual warmth.

---

## 2. Design Tokens & Color Palettes

### 2.1 CSS Custom Properties (Theme Matrix)

Below is the dual-theme token specification. Copy these custom properties into your global stylesheet (`styles.css` / `globals.css`).

```css
:root {
  /* ==========================================
     DEFAULT: DARK THEME (Warm Charcoal/Espresso)
     ========================================== */
  --bg-base: #0D0B0A;          /* Main application background */
  --bg-surface: #161311;       /* Standard card & container background */
  --bg-surface-hover: #1F1A17; /* Card hover state / elevated surface */
  --bg-elevated: #26201C;      /* Dropdowns, tooltips, active nav pill */
  --bg-input: #1B1714;         /* Form inputs & search bar background */

  /* Borders */
  --border-subtle: rgba(255, 255, 255, 0.08); /* Card outer borders */
  --border-strong: rgba(255, 255, 255, 0.16); /* Interactive borders / active state */
  --border-accent: rgba(224, 147, 110, 0.35);  /* Subtle warm copper border highlight */

  /* Typography */
  --text-primary: #FAF6F0;     /* Primary text / main titles (warm cream) */
  --text-secondary: #BAAFA6;   /* Subtitles, secondary descriptions */
  --text-muted: #7A7067;       /* Metadata, disabled states, uppercase labels */
  --text-inverse: #120E0C;     /* Text on bright accent/cream backgrounds */

  /* Accent Colors */
  --accent-primary: #E0936E;   /* Terracotta / Warm Copper primary accent */
  --accent-light: #E5A886;     /* Light warm peach / italic display text tint */
  --accent-surface: rgba(224, 147, 110, 0.12); /* Subtle accent tint fills */
  
  /* Status & Indicator Colors */
  --status-online: #E58C5A;    /* Online dot / live indicator warm orange */
  --status-online-bg: rgba(229, 140, 90, 0.15);
  --status-success: #52B788;   /* Success / healthy metric */
  --status-warning: #E0A96E;   /* Warning / moderate status */
  --status-danger: #D96B6B;    /* Alert / allergy indicator */

  /* Interactive Elements */
  --btn-primary-bg: #FAF6F0;   /* Cream primary CTA button background */
  --btn-primary-text: #120E0C;
  --btn-primary-hover: #EBE4DA;

  --btn-accent-bg: #E0936E;    /* Warm copper CTA option */
  --btn-accent-text: #120E0C;
  --btn-accent-hover: #D4845E;

  /* Radial Ambient Glow */
  --glow-color: rgba(224, 147, 110, 0.08);
}

/* ==========================================
   LIGHT THEME (Warm Ivory / Soft Cream)
   ========================================== */
[data-theme="light"],
.light-theme {
  --bg-base: #F7F4EF;          /* Soft warm linen background */
  --bg-surface: #FFFFFF;       /* Pure white card surface */
  --bg-surface-hover: #F2EDE4; /* Subtle warm cream hover state */
  --bg-elevated: #EFE8DD;      /* Active items / dropdowns */
  --bg-input: #EFE8DD;         /* Form inputs & search bar background */

  /* Borders */
  --border-subtle: rgba(26, 20, 18, 0.08);  /* Clean warm dark border */
  --border-strong: rgba(26, 20, 18, 0.18);
  --border-accent: rgba(197, 107, 68, 0.4);

  /* Typography */
  --text-primary: #1F1915;     /* Dark espresso primary text */
  --text-secondary: #594F47;   /* Muted dark body text */
  --text-muted: #8C8075;       /* Metadata / small labels */
  --text-inverse: #FAF6F0;     /* Text on dark buttons */

  /* Accent Colors */
  --accent-primary: #C56B44;   /* Slightly deeper warm copper for light mode contrast */
  --accent-light: #B85C37;
  --accent-surface: rgba(197, 107, 68, 0.08);

  /* Status & Indicator Colors */
  --status-online: #D97036;
  --status-online-bg: rgba(217, 112, 54, 0.12);
  --status-success: #2A8A5D;
  --status-warning: #C88337;
  --status-danger: #C04242;

  /* Interactive Elements */
  --btn-primary-bg: #1F1915;   /* Espresso dark button in light mode */
  --btn-primary-text: #FAF6F0;
  --btn-primary-hover: #332B25;

  --btn-accent-bg: #C56B44;
  --btn-accent-text: #FFFFFF;
  --btn-accent-hover: #B35C36;

  /* Radial Ambient Glow */
  --glow-color: rgba(197, 107, 68, 0.06);
}
```

---

## 3. Typography Rules & Hierarchy

The typography structure combines **Serif**, **Sans-Serif**, and **Monospace** fonts to create a refined editorial aesthetic.

### 3.1 Font Families
*   **Display / Headings Font**: `'Instrument Serif'`, `'Playfair Display'`, or `'Georgia'`, serif.
*   **Body & Standard UI Font**: `'Plus Jakarta Sans'`, `'Inter'`, or system sans-serif.
*   **Technical / Data Font**: `'JetBrains Mono'`, `'SF Mono'`, or monospace.

```css
.font-serif {
  font-family: 'Instrument Serif', Georgia, serif;
}
.font-sans {
  font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.font-mono {
  font-family: 'JetBrains Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
```

### 3.2 Key Typography Techniques from Reference Images

1. **Serif Title + Italic Accent Rule**:
   Main feature headings match normal serif weight, with key brand or emotional words set in *Serif Italic* and highlighted in `--accent-light` / `--accent-primary`.
   *   *Example*: `Your face, <span class="italic text-accent">your vitals.</span> In sixty seconds.`
2. **Uppercase Category / Eyebrow Headers**:
   Small section markers (`BIOMETRIC`, `PRE-CONSULTATION`, `CARE`, `INTELLIGENCE`) should be uppercase, rendered in `font-sans` or `font-mono`, with extended letter spacing (`letter-spacing: 0.12em` / `tracking-widest`) and size `11px–12px`.
3. **Data Values**:
   Metrics and quantitative figures (e.g., `86`, `68 bpm`, `98%`, `2.4M`) use large bold serif display sizes or clean high-contrast sans numbers.

### 3.3 Typography Hierarchy Reference Table

| Type | Font Family | Size | Weight | Line Height | Letter Spacing | Styling / Usage |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Hero Title** | Serif | 48px – 60px | Regular (400) | 1.1 | -0.02em | Main landing/hero headings |
| **Page Title (H1)** | Serif | 32px – 40px | Regular (400) | 1.2 | normal | Primary view titles (e.g., *AI face scan analysis*) |
| **Section Header (H2)** | Serif | 22px – 28px | Regular (400) | 1.3 | normal | Sub-section headers (e.g., *Wellness trajectory*) |
| **Card Title (H3)** | Sans / Serif | 16px – 18px | Medium (500) | 1.4 | normal | Widget card titles, Doctor names |
| **Eyebrow Label** | Mono / Sans | 10px – 12px | Medium (500) | 1.2 | +0.12em | Uppercase section markers |
| **Body Text** | Sans | 14px – 15px | Regular (400) | 1.5 | normal | General descriptions, paragraph text |
| **Small Caption** | Sans | 12px – 13px | Regular (400) | 1.4 | normal | Subtitles, meta info, helper hints |
| **Biometric Value** | Serif / Sans | 24px – 36px | Medium/Bold | 1.1 | normal | Large KPI metrics (`68 bpm`, `98%`) |

---

## 4. Layout, Spacing & Container Architecture

### 4.1 Grid & Layout Structure
*   **Sidebar Navigation**: Fixed left-hand panel, width `240px–260px`, transparent background or subtle dark surface.
*   **Top Navigation / Bar**: Height `64px`, fixed at top, houses global search bar (`⌘K`), theme switcher toggle, notifications, and secondary actions.
*   **Main Workspace**: Fluid grid container with max-width limits (`max-w-7xl` or `1400px`), centered padding of `24px–32px` (`p-6` or `p-8`).

### 4.2 Spacing & Border Radius Guidelines
*   **Spacing Base Unit**: 4px grid system (`4px`, `8px`, `12px`, `16px`, `24px`, `32px`, `48px`).
*   **Card Corner Radius**: `12px` to `16px` (`rounded-xl` or `rounded-2xl`).
*   **Input / Secondary Element Radius**: `8px` to `12px` (`rounded-lg`).
*   **Pill Element Radius**: `9999px` (`rounded-full`) for CTA buttons, search inputs, tags, badges, and user profiles.

---

## 5. Component Design Specifications

### 5.1 Buttons & Action Controls

#### Primary CTA Button (High Contrast Pill)
*   **Shape**: Fully rounded pill (`border-radius: 9999px`).
*   **Padding**: `10px 24px` (`py-2.5 px-6`).
*   **Typography**: Sans-Serif, 14px, Semi-bold (600).
*   **Dark Theme**: Background `--btn-primary-bg` (`#FAF6F0`), Text `--btn-primary-text` (`#120E0C`).
*   **Light Theme**: Background `--btn-primary-bg` (`#1F1915`), Text `--btn-primary-text` (`#FAF6F0`).
*   **Icon**: Inline right arrow (`→`) or leading action icon with subtle motion on hover.

#### Accent Primary Button (Warm Copper Pill)
*   **Background**: `--accent-primary` (`#E0936E`).
*   **Text**: `#120E0C` (Dark espresso text for strong legibility).
*   **Hover State**: `--btn-accent-hover` with subtle scale transition (`transform: scale(1.02)`).

#### Secondary / Ghost Button
*   **Background**: `transparent` or `--bg-surface`.
*   **Border**: `1px solid var(--border-subtle)`.
*   **Text**: `--text-primary`.
*   **Hover**: Background `--bg-surface-hover`, border `--border-strong`.

```css
/* Button CSS Blueprint */
.btn-primary {
  background-color: var(--btn-primary-bg);
  color: var(--btn-primary-text);
  border-radius: 9999px;
  padding: 0.625rem 1.5rem;
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 600;
  border: none;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease-in-out;
}

.btn-primary:hover {
  background-color: var(--btn-primary-hover);
  transform: translateY(-1px);
}

.btn-secondary {
  background-color: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
  border-radius: 9999px;
  padding: 0.625rem 1.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease-in-out;
}

.btn-secondary:hover {
  background-color: var(--bg-surface-hover);
  border-color: var(--border-strong);
}
```

---

### 5.2 Cards & Surface Containers

Cards serve as the primary structural unit.
*   **Background**: `var(--bg-surface)`
*   **Border**: `1px solid var(--border-subtle)`
*   **Shadow**: None or extremely soft ambient drop shadow (`shadow-sm`).
*   **Inner Padding**: `20px` to `24px` (`p-5` or `p-6`).

```css
.card-container {
  background-color: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 1rem; /* 16px */
  padding: 1.5rem;
  position: relative;
  overflow: hidden;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

/* Optional subtle radial accent background glow */
.card-container.has-glow::before {
  content: '';
  position: absolute;
  top: -20%;
  left: 50%;
  transform: translateX(-50%);
  width: 80%;
  height: 60%;
  background: radial-gradient(circle, var(--glow-color) 0%, transparent 70%);
  pointer-events: none;
}
```

---

### 5.3 Badges, Status Dots & Indicators

1. **Status Pill Badges** (`• ONLINE`, `• LIVE`, `• CAMERA READY`):
   *   Border Radius: `9999px`
   *   Font Size: `11px`, Uppercase, Semi-bold.
   *   Background: `--status-online-bg`
   *   Text Color: `--status-online`
   *   Includes a small glowing dot (`width: 6px, height: 6px, border-radius: 50%`) preceding the text.

2. **Condition / Tag Pills** (`Hypertension`, `Sleep apnea`, `Penicillin allergy`):
   *   Background: Subdued fill `rgba(255, 255, 255, 0.04)` in Dark mode, `rgba(0, 0, 0, 0.04)` in Light mode.
   *   Border: `1px solid var(--border-subtle)`.
   *   Alert tags (e.g., Allergy): Soft amber/red tinted border and text (`--status-danger`).

```css
.badge-status-online {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.625rem;
  border-radius: 9999px;
  background-color: var(--status-online-bg);
  color: var(--status-online);
  font-size: 0.6875rem; /* 11px */
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: currentColor;
  box-shadow: 0 0 8px currentColor;
}
```

---

### 5.4 Form Controls & Input Elements

#### Global Search Bar (with `⌘K` Badge)
*   **Shape**: Fully rounded pill (`border-radius: 9999px`).
*   **Background**: `var(--bg-input)`.
*   **Border**: `1px solid var(--border-subtle)`.
*   **Shortcut Badge**: Small rounded keypress box (`kbd`) displaying `⌘K` on the right side.

#### Toggle Switches
*   **Track**: Oval pill (`width: 44px, height: 24px, border-radius: 9999px`).
*   **Active Fill**: `var(--accent-primary)`.
*   **Inactive Fill**: `var(--bg-elevated)` with `var(--border-subtle)`.
*   **Thumb**: Smooth white circle sliding horizontally.

```css
/* Search Input Styling */
.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  background-color: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: 9999px;
  padding: 0.5rem 1rem 0.5rem 2.5rem;
  width: 100%;
  max-width: 380px;
}

.search-input-wrapper input {
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 0.875rem;
  width: 100%;
}

.kbd-badge {
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--text-muted);
}
```

---

### 5.5 Navigation & Sidebar Elements

1. **Category Headers**: Monospaced/sans uppercase tags with `11px` sizing and muted opacity (`CARE`, `INTELLIGENCE`, `RECORDS`, `SYSTEM`).
2. **Navigation Item (Inactive)**: Muted text `--text-secondary`, subtle icon, padding `8px 12px`, rounded `8px`.
3. **Navigation Item (Active)**: Surface highlight background `var(--bg-elevated)`, crisp text `--text-primary`, subtle accent indicator dot or icon highlight.
4. **Bottom User Profile Bar**: Rounded container housing user avatar, name, account ID, and logout icon action.

---

## 6. Light Theme Switcher Implementation Guide

To implement the light theme alongside the existing dark theme seamlessly without breaking application state, follow this strategy:

### 6.1 Theme Switcher Logic (JavaScript / React Example)

Set a `data-theme` attribute on the root `<html>` element. Store the preferred theme in `localStorage` or read system user preferences (`prefers-color-scheme`).

```javascript
// Theme Toggle Utility Script
function setTheme(themeName) {
  document.documentElement.setAttribute('data-theme', themeName);
  localStorage.setItem('aura_theme', themeName);
}

function initTheme() {
  const savedTheme = localStorage.getItem('aura_theme');
  if (savedTheme) {
    setTheme(savedTheme);
  } else {
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    setTheme(prefersLight ? 'light' : 'dark');
  }
}

// Call on app initialization
initTheme();
```

### 6.2 Theme Toggle UI Button Spec
Add a theme toggle icon button in the header (sun/moon icon switch):

```html
<button 
  onclick="toggleTheme()" 
  class="theme-toggle-btn" 
  aria-label="Toggle dark/light mode"
>
  <!-- Sun Icon for Light Mode / Moon Icon for Dark Mode -->
  <svg class="w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
          d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
</button>
```

---

## 7. Tailwind CSS Config Extension

If your existing application relies on **Tailwind CSS**, update your `tailwind.config.js` to map these dynamic CSS variables into Tailwind utilities without rewriting existing classes:

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        base: 'var(--bg-base)',
        surface: {
          DEFAULT: 'var(--bg-surface)',
          hover: 'var(--bg-surface-hover)',
          elevated: 'var(--bg-elevated)',
        },
        input: 'var(--bg-input)',
        accent: {
          DEFAULT: 'var(--accent-primary)',
          light: 'var(--accent-light)',
          surface: 'var(--accent-surface)',
        },
        status: {
          online: 'var(--status-online)',
          'online-bg': 'var(--status-online-bg)',
          success: 'var(--status-success)',
          warning: 'var(--status-warning)',
          danger: 'var(--status-danger)',
        }
      },
      textColor: {
        primary: 'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        muted: 'var(--text-muted)',
        inverse: 'var(--text-inverse)',
      },
      borderColor: {
        subtle: 'var(--border-subtle)',
        strong: 'var(--border-strong)',
        accent: 'var(--border-accent)',
      },
      fontFamily: {
        serif: ['Instrument Serif', 'Georgia', 'serif'],
        sans: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        'pill': '9999px',
      }
    },
  },
  plugins: [],
}
```

---

## 8. Migration Rules & Do's / Don'ts

To re-skin your existing frontend seamlessly without breaking functional logic:

### Do's
*   ✅ **DO** replace static hex colors (`bg-gray-900`, `bg-black`, `text-white`) with dynamic CSS token classes (`bg-base`, `bg-surface`, `text-primary`).
*   ✅ **DO** apply serif font styling selectively to top-level page headings and hero banners.
*   ✅ **DO** italicize target emotional accent words within major headings.
*   ✅ **DO** wrap key actions and badges in `rounded-full` pill containers.
*   ✅ **DO** test both Dark and Light modes using the `data-theme` root attribute to verify contrast ratios.

### Don'ts
*   ❌ **DON'T** modify existing React/Vue component props, event handlers, API hooks, or state logic.
*   ❌ **DON'T** use harsh stark white (`#FFFFFF`) backgrounds in the light theme — always use warm linen/cream tones (`#FAF8F5`).
*   ❌ **DON'T** use saturated primary blue or pure cyan colors; maintain the warm terracotta/copper and amber aesthetic.
*   ❌ **DON'T** remove monospace styling from technical identifiers, timestamps, or quantitative micro-copy.