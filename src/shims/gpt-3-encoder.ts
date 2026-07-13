// DELIBERATE BUNDLE-SIZE GUARD — DO NOT DELETE.
// vectra transitively require()s gpt-3-encoder, whose real package ships
// ~1.5 MB of BPE assets (encoder.json + vocab.bpe). The esbuild alias in
// esbuild.config.mjs redirects that require here so main.js stays ~1 MB.
// Removing this shim (or the alias) roughly doubles the bundle.

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
