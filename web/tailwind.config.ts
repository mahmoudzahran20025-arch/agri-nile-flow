import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Cairo', 'sans-serif'],
      },
      colors: {
        brand: {
          50:  '#f0f7ff',
          100: '#e0effe',
          200: '#badffd',
          300: '#7cc2fc',
          400: '#38a1f8',
          500: '#0e82e5',
          600: '#0265c0',
          700: '#03519c',
          800: '#084580',
          900: '#0c3a6b',
          950: '#0F2D5C',
        },
        agri: {
          50:  '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#1D9E75',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
          950: '#052e16',
        }
      },
      screens: { xs: '480px' },
      keyframes: {
        slideIn: { from: { transform: 'translateX(-100%)', opacity: '0' }, to: { transform: 'translateX(0)', opacity: '1' } },
      },
      animation: {
        slideIn: 'slideIn 0.2s ease',
      },
    },
  },
  plugins: [],
} satisfies Config
