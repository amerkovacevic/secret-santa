import { tailwindColors, tailwindFonts } from '../shared-design-tokens.js';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    fontFamily: tailwindFonts,
    extend: {
      colors: tailwindColors,
    },
  },
  plugins: [],
};
