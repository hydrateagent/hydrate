// Export a dummy object or function as expected by Vectra if it tries to use it.
// Based on typical usage, it might expect a constructor or a function.
export default function WinkBM25TextSearch() {
	console.warn(
		"[Hydrate Shim] WinkBM25TextSearch SHIM constructor/function called."
	);
	return {
		// Dummy methods if Vectra tries to call anything on the instance
		defineConfig: () => {
			console.warn(
				"[Hydrate Shim] WinkBM25TextSearch SHIM defineConfig called"
			);
		},
		learn: () => {
			console.warn("[Hydrate Shim] WinkBM25TextSearch SHIM learn called");
		},
		search: () => {
			console.warn(
				"[Hydrate Shim] WinkBM25TextSearch SHIM search called"
			);
			return []; // Return empty array for search results
		},
		// Add other methods Vectra might expect if errors occur
	};
}
