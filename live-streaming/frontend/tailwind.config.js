/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: '#9147ff', // Twitch-style purple
      },
    },
  },
  plugins: [],
}
