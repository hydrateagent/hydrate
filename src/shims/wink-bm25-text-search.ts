// Export a dummy object or function as expected by Vectra if it tries to use it.
// Based on typical usage, it might expect a constructor or a function.
import { devLog } from "../utils/logger";

export default function WinkBM25TextSearch() {
	devLog.warn(
		"[Hydrate Shim] WinkBM25TextSearch SHIM constructor/function called.",
	);
	return {
		// Dummy methods if Vectra tries to call anything on the instance
		defineConfig: () => {
			devLog.warn(
				"[Hydrate Shim] WinkBM25TextSearch SHIM defineConfig called",
			);
		},
		learn: () => {
			devLog.warn("[Hydrate Shim] WinkBM25TextSearch SHIM learn called");
		},
		search: () => {
			devLog.warn("[Hydrate Shim] WinkBM25TextSearch SHIM search called");
			return []; // Return empty array for search results
		},
		// Add other methods Vectra might expect if errors occur
	};
}
