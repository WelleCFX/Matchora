import type { Config } from 'tailwindcss';
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: { colors: { navy: '#0F1B33', teal: { DEFAULT: '#0B8F9C', soft: '#DDF3F5' } }, fontFamily: { display: ['Unbounded', 'system-ui', 'sans-serif'], body: ['Onest', 'system-ui', 'sans-serif'] } } },
  plugins: [],
} satisfies Config;
