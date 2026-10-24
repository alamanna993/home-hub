/** @type {import('tailwindcss').Config} */

// Colors live as RGB triplets in index.css (:root = light, .dark = dark) so one
// class works in both themes and still takes Tailwind's /alpha modifier.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: token('canvas'),
        ink: token('ink'),
        muted: token('muted'),
        line: token('line'),
        action: {
          DEFAULT: token('action'),
          hover: token('action-hover'),
          on: token('on-action'),
        },
        // Reserved for Emerald (the assistant, AI-filled fields, brain status) — nothing else.
        emerald: {
          DEFAULT: token('emerald'),
          on: token('on-emerald'),
        },
        warn: token('warn'),
        danger: {
          DEFAULT: token('danger'),
          hover: token('danger-hover'),
        },
        surface: token('surface'),
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
      },
      // Scale: 12 / 13 / 14 (body) / 16 / 20 / 24 / 30
      fontSize: {
        xs: ['12px', '16px'],
        ui: ['13px', '18px'],
        sm: ['14px', '20px'],
        base: ['16px', '24px'],
        lg: ['16px', '24px'],
        xl: ['20px', '28px'],
        '2xl': ['24px', { lineHeight: '32px', letterSpacing: '-0.01em' }],
        '3xl': ['30px', { lineHeight: '36px', letterSpacing: '-0.01em' }],
      },
      borderRadius: {
        control: '6px',
        panel: '10px',
      },
      // Shadows belong to overlays only (menus, dialogs, slide-overs).
      boxShadow: {
        overlay: '0 12px 32px -8px rgb(var(--shadow) / 0.28), 0 2px 6px rgb(var(--shadow) / 0.12)',
      },
    },
  },
  plugins: [],
}
