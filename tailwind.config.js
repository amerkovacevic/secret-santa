import { tailwindColors, tailwindFonts } from '../shared-design-tokens.js';

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: tailwindColors,
      fontFamily: tailwindFonts,
    },
  },
  plugins: [],
};
