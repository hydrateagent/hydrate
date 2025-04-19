// We don't need require with object syntax
// const tailwindcss = require('tailwindcss');
// const autoprefixer = require('autoprefixer');

// Revert to using @tailwindcss/postcss as required by v4
const tailwindcssPostcss = require("@tailwindcss/postcss");
const autoprefixer = require("autoprefixer");

module.exports = {
	plugins: [
		tailwindcssPostcss({ config: "./tailwind.config.js" }), // Use correct plugin, keep explicit config path
		autoprefixer,
	],
};
