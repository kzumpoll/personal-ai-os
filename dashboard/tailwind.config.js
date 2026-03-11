/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', '"Cascadia Code"', '"Source Code Pro"', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        surface: {
          0: '#0f0f0f',
          1: '#1a1a1a',
          2: '#242424',
          3: '#2e2e2e',
        },
        accent: {
          DEFAULT: '#6366f1',
          muted: '#4f46e5',
        },
      },
    },
  },
  plugins: [],
};
