/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx}",
    "./src/components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        parchment: "#f4e4bc",
        leather: "#2d1b0f",
        gold: "#ffd700",
      },
    },
  },
  plugins: [],
}