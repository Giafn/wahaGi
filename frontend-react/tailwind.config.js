/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"IBM Plex Mono"', 'monospace'],
        sans: ['"IBM Plex Sans"', 'sans-serif'],
      },
      colors: {
        bg: '#0a0a0a',
        surface: '#111111',
        card: '#161616',
        border: '#222222',
        'border-active': '#3a8f5a',
        green: { DEFAULT: '#2ecc71', dim: '#1a7a42', glow: 'rgba(46,204,113,0.15)' },
        amber: { DEFAULT: '#f39c12' },
        red: { DEFAULT: '#e74c3c' },
        blue: { DEFAULT: '#3498db' },
        muted: '#555555',
        subtle: '#333333',
      },
      animation: {
        'pulse-green': 'pulseGreen 2s ease-in-out infinite',
        'fade-in': 'fadeIn 0.3s ease',
        'slide-up': 'slideUp 0.3s ease',
      },
      keyframes: {
        pulseGreen: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.4 },
        },
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
      }
    }
  },
  plugins: []
};
