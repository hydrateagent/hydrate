const path = require("path"); // Use require for CJS config file

/** @type {import('tailwindcss').Config} */
module.exports = {
	// Restore content path for scanning
	content: [path.resolve(__dirname, "./src/components/**/*.{ts,tsx}")],
	theme: {
		extend: {},
	},
	// Restore PostCSS plugin
	plugins: [require("@tailwindcss/postcss")],
	corePlugins: {
		// Disable preflight to avoid conflicts with Obsidian base styles.
		preflight: false,
	},
};
