/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        wattar: {
          50: '#F1F0FF',
          100: '#E8E5FF',
          200: '#D5CEFF',
          300: '#BBAEFF',
          400: '#A38FFF',
          500: '#9A85FF',
          600: '#7057E8',
          700: '#5D45D0',
          800: '#4937A8',
          900: '#332979',
          950: '#201A49',
        },
        gold: {
          500: '#D99A25',
          600: '#B97D14',
          700: '#95600C',
        },
        lagoon: {
          300: '#8AE3DD',
          400: '#50D3C5',
          500: '#159C9C',
          600: '#117F83',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Tajawal', 'system-ui', 'sans-serif'],
        arabic: ['Tajawal', 'Cairo', 'sans-serif'],
      },
      backgroundColor: {
        dark: '#111426',
        'dark-surface': '#1A1E33',
        'dark-elevated': '#252A42',
      },
    },
  },
  plugins: [],
};
