// Shared contract with the backend's image_results.py — keep in sync.
export interface ImageToolResult {
	type: "image";
	mime_type: string;
	data: string; // base64, no data: prefix
	source: string; // vault path or URL
}

export const MAX_IMAGE_BYTES = 1_500_000;

const MIME_BY_EXT: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
};

export function mimeTypeForPath(path: string): string | null {
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	return MIME_BY_EXT[ext] ?? null;
}

const SUPPORTED_MIMES = new Set(Object.values(MIME_BY_EXT));

// Must stay aligned with the backend's _SUPPORTED_MEDIA_TYPES: anything
// outside this set would cross the wire only to be rejected server-side.
export function isSupportedMime(mime: string): boolean {
	return SUPPORTED_MIMES.has(mime);
}

export function validateImageUrl(url: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return `Not a valid URL: ${url}`;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return `Only http/https image URLs are supported (got ${parsed.protocol})`;
	}
	return null;
}
