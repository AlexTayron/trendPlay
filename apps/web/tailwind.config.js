/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: '#0f131c',
        'surface-dim': '#0f131c',
        'surface-container-lowest': '#0a0e16',
        'surface-container-low': '#181c24',
        'surface-container': '#1c2028',
        'surface-container-high': '#262a33',
        'surface-container-highest': '#31353e',
        'surface-bright': '#353942',
        primary: '#adc6ff',
        'primary-container': '#4d8eff',
        'on-primary-container': '#00285d',
        secondary: '#4cd7f6',
        'secondary-container': '#03b5d3',
        tertiary: '#ffb786',
        'tertiary-container': '#df7412',
        outline: '#8c909f',
        'outline-variant': '#424754',
        'on-surface': '#dfe2ee',
        'on-surface-variant': '#c2c6d6',
        error: '#ffb4ab',
      },
      borderRadius: {
        DEFAULT: '0.25rem',
        lg: '0.5rem',
        xl: '0.75rem',
        '2xl': '1rem',
        full: '9999px',
      },
      fontFamily: {
        sans: ['Inter', 'Geist', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

