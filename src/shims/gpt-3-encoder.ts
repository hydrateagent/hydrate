import { devLog } from "../utils/logger";

export function encode(text: string): number[] {
	// Return a very basic tokenization, like character codes
	return text.split("").map((char) => char.charCodeAt(0));
}

export function decode(tokens: number[]): string {
	devLog.warn(
		"[Hydrate Shim] gpt-3-encoder SHIM decode called for tokens:",
		tokens.slice(0, 10),
	);
	return tokens.map((token) => String.fromCharCode(token)).join("");
}
