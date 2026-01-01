/**
 * HTTP client utility using native fetch.
 * CORS is properly configured on the backend for app://obsidian.md origin.
 */

interface HttpRequestOptions {
	method?: "GET" | "POST" | "PUT" | "DELETE";
	headers?: Record<string, string>;
	body?: string;
	signal?: AbortSignal;
}

interface HttpResponse {
	ok: boolean;
	status: number;
	json: () => Promise<unknown>;
	text: () => Promise<string>;
}

export async function httpRequest(
	url: string,
	options: HttpRequestOptions = {}
): Promise<HttpResponse> {
	const { method = "GET", headers = {}, body, signal } = options;

	try {
		const response = await fetch(url, {
			method,
			headers,
			body,
			mode: "cors",
			signal,
		});

		return {
			ok: response.ok,
			status: response.status,
			json: () => response.json(),
			text: () => response.text(),
		};
	} catch (error) {
		// Re-throw AbortError so callers can handle cancellation
		if (error instanceof Error && error.name === "AbortError") {
			throw error;
		}
		console.error("[Hydrate] HTTP request failed:", url, error);
		return {
			ok: false,
			status: 0,
			json: async () => ({ error: String(error) }),
			text: async () => String(error),
		};
	}
}
