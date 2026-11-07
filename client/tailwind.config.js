/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class'],
  // outcome accent borders are derived from dot classes at runtime
  safelist: ['border-signal', 'border-signal/70', 'border-hot', 'border-cold', 'border-warm', 'border-muted', 'border-muted/60', 'border-danger', 'border-line'],
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        sunken: 'rgb(var(--sunken) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        signal: { DEFAULT: 'rgb(var(--signal) / <alpha-value>)', soft: 'rgb(var(--signal-soft) / <alpha-value>)', ink: 'rgb(var(--signal-ink) / <alpha-value>)' },
        hot: 'rgb(var(--hot) / <alpha-value>)',
        warm: 'rgb(var(--warm) / <alpha-value>)',
        cold: 'rgb(var(--cold) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        nav: 'rgb(var(--nav) / <alpha-value>)',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        sans: ['"Public Sans"', 'system-ui', 'sans-serif'],
      },
      borderRadius: { panel: '12px', control: '8px' },
    },
  },
  plugins: [],
};
