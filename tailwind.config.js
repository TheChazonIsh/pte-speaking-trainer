/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,html,css}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Pretendard', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        pte: {
          navy: '#0f2942',
          blue: '#0066b2',
          sky: '#e6f2fa',
          teal: '#0d9488',
        },
      },
    },
  },
  plugins: [],
};
