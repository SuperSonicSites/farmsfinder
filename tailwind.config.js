/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./themes/farmfinders/layouts/**/*.html",
    "./content/**/*.md",
    "./themes/farmfinders/assets/js/**/*.js"
  ],
  theme: {
    extend: {},
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('@tailwindcss/forms'),
  ],
}
