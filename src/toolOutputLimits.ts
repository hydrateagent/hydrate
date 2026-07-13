// Pure helpers — no Obsidian imports, so they stay unit-testable.
// Caps mirror the backend's context-management design: the plugin cuts
// oversized tool output at the edge before it crosses the network.

export const MAX_TOOL_RESULT_CHARS = 40_000;

// Headroom so a char-capped slice PLUS its notice stays under the
// dispatch-level cap — otherwise capToolResult re-truncates and destroys
// the paging notice.
const SLICE_NOTICE_HEADROOM = 200;

export function capToolResult(
	result: unknown,
	maxChars: number = MAX_TOOL_RESULT_CHARS,
): unknown {
	if (typeof result !== "string" || result.length <= maxChars) {
		return result;
	}
	return (
		result.slice(0, maxChars) +
		`\n[Truncated by Hydrate: result was ${result.length} chars; ` +
		`showing the first ${maxChars}.]`
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
