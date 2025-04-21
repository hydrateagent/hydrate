import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react"; // Although we use esbuild, Vitest benefits from Vite plugins for React

// https://vitest.dev/config/
export default defineConfig({
	root: ".", // Explicitly set the root directory
	plugins: [react()], // Add React plugin support for JSX/TSX
	test: {
		globals: true, // Use Vitest's global APIs (describe, it, expect) without importing
		environment: "jsdom", // Simulate a DOM environment for React components
		setupFiles: "./src/test-setup.ts", // Path to the setup file
		// Enable coverage reporting
		coverage: {
			provider: "v8", // or 'istanbul'
			reporter: ["text", "html", "lcov"], // 'text' for console summary, 'html' for detailed report, 'lcov' for integrations
			reportsDirectory: "./coverage", // Specify output directory
			include: ["src/**"], // <-- Add this to only include src files
			// Optionally exclude specific files (like test setup, types)
			exclude: [
				"node_modules/**",
				"src/test-setup.ts",
				"src/types.ts",
				"**/__mocks__/**",
				// Add other files/patterns to exclude if needed
			],
			all: true, // Report coverage for all files defined in include/exclude, not just tested ones
		},
		// Optional: Exclude node_modules and other build artifacts from test runs
		exclude: ["node_modules", "dist", ".idea", ".git", ".cache"],
	},
});
