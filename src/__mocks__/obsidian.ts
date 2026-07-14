// Minimal Obsidian API stub for vitest. Extend as tests need more —
// keep every member trivially simple; behavior belongs in fakes built
// inside each test file.
export class TAbstractFile {
	path = "";
	name = "";
}

export class TFile extends TAbstractFile {
	extension = "md";
}

export class TFolder extends TAbstractFile {}

export class Notice {
	constructor(_message?: string, _timeout?: number) {}
}

export function normalizePath(p: string): string {
	return p
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/^\//, "");
}

// Type-only consumers (App, Vault, WorkspaceLeaf, ...) are erased at
// runtime; add runtime members here only when a test actually executes
// them.
export type App = unknown;

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	return Buffer.from(buffer).toString("base64");
}

export function requestUrl(): never {
	throw new Error(
		"requestUrl is not available under vitest — inject a fake requester",
	);
}
