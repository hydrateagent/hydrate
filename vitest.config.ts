import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react"; // Although we use esbuild, Vitest benefits from Vite plugins for React

// https://vitest.dev/config/
export default defineConfig({
	plugins: [react()], // Add React plugin support for JSX/TSX
	test: {
		globals: true, // Use Vitest's global APIs (describe, it, expect) without importing
		environment: "jsdom", // Simulate a DOM environment for React components
		setupFiles: "./src/test-setup.ts", // Path to the setup file
		// Optional: Configure coverage reporting
		// coverage: {
		//   provider: 'v8', // or 'istanbul'
		//   reporter: ['text', 'json', 'html'],
		// },
		// Optional: Exclude node_modules and other build artifacts
		exclude: ["node_modules", "dist", ".idea", ".git", ".cache"],
	},
});
