console.log("[Hydrate Shim] gpt-3-encoder.ts shim loaded.");

export function encode(text: string): number[] {
	console.warn(
		"[Hydrate Shim] gpt-3-encoder SHIM encode called for text:",
		text.substring(0, 50)
	);
	// Return a very basic tokenization, like character codes
	return text.split("").map((char) => char.charCodeAt(0));
}

export function decode(tokens: number[]): string {
	console.warn(
		"[Hydrate Shim] gpt-3-encoder SHIM decode called for tokens:",
		tokens.slice(0, 10)
	);
	return tokens.map((token) => String.fromCharCode(token)).join("");
}
