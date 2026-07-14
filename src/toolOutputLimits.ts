// Pure helpers — no Obsidian imports, so they stay unit-testable.
// Caps mirror the backend's context-management design: the plugin cuts
// oversized tool output at the edge before it crosses the network.

import { isImageToolResult } from "./imageTools";

export const MAX_TOOL_RESULT_CHARS = 40_000;
export const MAX_ATTACHED_FILE_CHARS = 40_000;

// Headroom so a char-capped slice PLUS its notice stays under the
// dispatch-level cap — otherwise capToolResult re-truncates and destroys
// the paging notice.
const SLICE_NOTICE_HEADROOM = 200;

export function capToolResult(
	result: unknown,
	maxChars: number = MAX_TOOL_RESULT_CHARS,
): unknown {
	if (typeof result === "string") {
		// Existing string path — unchanged
		if (result.length <= maxChars) {
			return result;
		}
		return (
			result.slice(0, maxChars - SLICE_NOTICE_HEADROOM) +
			`\n[Truncated by Hydrate: result was ${result.length} chars; ` +
			`showing the first ${maxChars - SLICE_NOTICE_HEADROOM}.]`
		);
	}
	// Image results are size-bounded at source (MAX_IMAGE_BYTES) and must
	// survive intact — mirrors the backend's enforce_tool_result_cap exemption.
	if (isImageToolResult(result)) {
		return result;
	}
	let text: string;
	let hadError = false;
	try {
		text = JSON.stringify(result) ?? String(result);
	} catch {
		text = String(result);
		hadError = true;
	}
	if (text.length <= maxChars && !hadError) {
		return result; // small structured results keep object identity
	}
	// If the string is over the cap, or we fell back to String() due to an error,
	// return the string (possibly truncated).
	if (text.length <= maxChars) {
		return text;
	}
	return (
		text.slice(0, maxChars - SLICE_NOTICE_HEADROOM) +
		`\n[Truncated by Hydrate: structured tool result was ${text.length} chars; ` +
		`showing the first ${maxChars - SLICE_NOTICE_HEADROOM}.]`
	);
}

export function sliceFileContent(
	content: string,
	offset?: number,
	limit?: number,
): string {
	const lines = content.split("\n");
	const totalLines = lines.length;

	if (offset !== undefined && offset > totalLines) {
		return (
			`[File has ${totalLines} lines; offset ${offset} is past the ` +
			`end. Call readFile with a smaller offset.]`
		);
	}

	const start = Math.max(1, offset ?? 1);
	const count = limit ?? totalLines;
	const slice = lines.slice(start - 1, start - 1 + count);
	let text = slice.join("\n");
	let end = start + slice.length - 1;

	let charCapped = false;
	const sliceCap = MAX_TOOL_RESULT_CHARS - SLICE_NOTICE_HEADROOM;
	if (text.length > sliceCap) {
		text = text.slice(0, sliceCap);
		end = start + (text.split("\n").length - 1);
		charCapped = true;
	}

	const cut =
		charCapped || start > 1 || end < totalLines;
	if (!cut) {
		return text;
	}
	return (
		text +
		`\n[File has ${totalLines} lines; showing lines ${start}-${end}. ` +
		`Use readFile with offset/limit to read more.]`
	);
}

export function clampAttachedFile(content: string): string {
	if (content.length <= MAX_ATTACHED_FILE_CHARS) {
		return content;
	}
	const head = content.slice(0, MAX_ATTACHED_FILE_CHARS - SLICE_NOTICE_HEADROOM);
	return (
		head +
		`\n[Attached file truncated: showing ${head.length} of ${content.length} characters. Use the readFile tool with offset/limit to read the rest.]`
	);
}
