/**
 * Development logging utilities
 * Only logs in development environment
 */

// Use the same development mode detection as the rest of the plugin
const isDevelopment = process.env.NODE_ENV === "development";

export const devLog = {
	info: (message: string, ...args: any[]) => {
		if (isDevelopment) {
			console.log(`[Hydrate] ${message}`, ...args);
		}
	},

	warn: (message: string, ...args: any[]) => {
		if (isDevelopment) {
			console.warn(`[Hydrate] ${message}`, ...args);
		}
	},

	error: (message: string, ...args: any[]) => {
		if (isDevelopment) {
			console.error(`[Hydrate] ${message}`, ...args);
		}
	},

	debug: (message: string, ...args: any[]) => {
		if (isDevelopment) {
			console.debug(`[Hydrate] ${message}`, ...args);
		}
	},
};

// For backwards compatibility with existing console.warn calls
export const conditionalWarn = (message: string, ...args: any[]) => {
	if (isDevelopment) {
		console.warn(`[Hydrate] ${message}`, ...args);
	}
};
