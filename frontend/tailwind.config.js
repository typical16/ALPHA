/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        sand: {
          50: '#F7F5EE',
          100: '#F1EFE3',
          200: '#E6E2D1',
          300: '#D7D0B7',
          400: '#C8BDA0',
          500: '#B9A285',
          600: '#A78C6F',
          700: '#8E755B',
          800: '#6E5C49',
          900: '#56483A',
        },
        sage: {
          50: '#F3F6F4',
          100: '#E7EEEA',
          200: '#D3E0DA',
          300: '#B9CDC4',
          400: '#9BB3A9',
          500: '#7A8B84',
          600: '#66766F',
          700: '#515E59',
          800: '#3F4A46',
          900: '#323B38',
        },
        amber: {
          500: '#F59E0B',
          600: '#D97706',
        },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)',
      },
      borderRadius: {
        xl: '0.875rem',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}


