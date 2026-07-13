// Pure snippet extraction for search results — no Obsidian imports.

export function extractSnippet(
	content: string,
	query: string,
	contextLines = 2,
	maxChars = 300,
): string {
	const words = query
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length >= 3);
	const lines = content.split("\n");

	let hit = -1;
	if (words.length > 0) {
		hit = lines.findIndex((line) => {
			const lower = line.toLowerCase();
			return words.some((w) => lower.includes(w));
		});
	}

	const center = hit >= 0 ? hit : 0;
	const start = Math.max(0, center - contextLines);
	const end = Math.min(lines.length, center + contextLines + 1);
	const snippet = lines
		.slice(start, end)
		.join(" ⏎ ")
		.replace(/\s+/g, " ")
		.trim();
	return snippet.slice(0, maxChars);
}
