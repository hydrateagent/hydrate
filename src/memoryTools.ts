import { type App, TFile, normalizePath } from "obsidian";

// Sibling of the existing hydrate-chats/views and hydrate-chats/images
// folders; created on first save (mirrors exportChatAsNote's
// createFolder-guarded-by-existence-check pattern).
export const MEMORIES_FOLDER = "hydrate-chats/memories";

// Mirrors the server-side clamp in prompts.py (build_system_prompt) — bytes
// past this would be shipped only to be truncated server-side.
export const MAX_MEMORY_INDEX_CHARS = 4_000;

const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;
type MemoryType = (typeof MEMORY_TYPES)[number];

const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Fallbacks used when a memory file's frontmatter is missing or malformed.
const DEFAULT_DESCRIPTION = "(no description)";
const DEFAULT_TYPE = "project";

export interface SaveMemoryParams {
	name: string;
	memory_type: string;
	description: string;
	content: string;
}

function isMemoryType(value: string): value is MemoryType {
	return (MEMORY_TYPES as readonly string[]).includes(value);
}

/**
 * Writes (or overwrites) a memory file under MEMORIES_FOLDER. This is a
 * model-facing tool: validation failures come back as instructive strings
 * for the model to read and correct — it never throws for bad input.
 */
export async function saveMemory(
	app: App,
	params: SaveMemoryParams,
): Promise<string> {
	const { name, memory_type, description, content } = params;

	if (!KEBAB_CASE_RE.test(name)) {
		return (
			`Invalid memory name '${name}': the name must be kebab-case — ` +
			`lowercase letters and digits, words separated by single hyphens ` +
			`(e.g. 'user-prefers-terse-replies'). No path separators, spaces, ` +
			`or uppercase letters. Choose a valid name and try again.`
		);
	}

	if (!isMemoryType(memory_type)) {
		return (
			`Invalid memory type '${memory_type}': type must be one of ` +
			`${MEMORY_TYPES.join(", ")}. Retry with a valid type.`
		);
	}

	const folder = app.vault.getAbstractFileByPath(MEMORIES_FOLDER);
	if (!folder) {
		await app.vault.createFolder(MEMORIES_FOLDER);
	}

	// A multi-line description would corrupt the one-line-per-memory index
	// contract (buildMemoryIndex renders each entry on a single line), so
	// collapse newlines/carriage returns before writing frontmatter.
	const sanitizedDescription = description.replace(/[\r\n]+/g, " ");

	const filePath = normalizePath(`${MEMORIES_FOLDER}/${name}.md`);
	const fileContent = `---\ndescription: ${sanitizedDescription}\ntype: ${memory_type}\n---\n\n${content}`;

	const existing = app.vault.getAbstractFileByPath(filePath);
	if (existing instanceof TFile) {
		await app.vault.modify(existing, fileContent);
		return `Updated memory '${name}'.`;
	}

	await app.vault.create(filePath, fileContent);
	return `Saved memory '${name}'.`;
}

// Dependency-free line parsing between the `---` fences — Obsidian's
// metadataCache isn't reliably available outside the live app, and this
// only needs two flat string fields. Tolerates missing/malformed
// frontmatter by leaving fields undefined for the caller to default.
function parseFrontmatter(text: string): {
	description: string;
	type: string;
} {
	let description: string | undefined;
	let type: string | undefined;

	const lines = text.split("\n");
	if (lines[0]?.trim() === "---") {
		for (let i = 1; i < lines.length; i++) {
			const line = lines[i];
			if (line.trim() === "---") {
				break;
			}
			const descMatch = /^description:\s*(.*)$/.exec(line);
			if (descMatch) {
				description = descMatch[1].trim();
				continue;
			}
			const typeMatch = /^type:\s*(.*)$/.exec(line);
			if (typeMatch) {
				type = typeMatch[1].trim();
			}
		}
	}

	return {
		description: description || DEFAULT_DESCRIPTION,
		type: type || DEFAULT_TYPE,
	};
}

interface MemoryEntry {
	path: string;
	line: string;
	sortKey: number;
}

/**
 * Lists memory files under MEMORIES_FOLDER and renders the compact index
 * sent with every /chat request. Entries are ordered most-recently-relevant
 * first (sort key = max(file mtime, lastUsed[path])); when the rendered
 * index would exceed MAX_MEMORY_INDEX_CHARS, the least-recently-relevant
 * entries are dropped one at a time — budget check included — until it
 * fits, with a trailing `- [N more memories not listed]` line accounting
 * for the drop count (also counted within the budget).
 *
 * Returns undefined when the folder is absent or has no memory files, so
 * the caller omits memory_index from the payload entirely.
 */
export async function buildMemoryIndex(
	app: App,
	lastUsed: Record<string, number>,
): Promise<{ index: string; prunedPaths: string[] } | undefined> {
	const prefix = `${MEMORIES_FOLDER}/`;
	const files = app.vault
		.getFiles()
		.filter((f) => f.path.startsWith(prefix) && f.path.endsWith(".md"));

	if (files.length === 0) {
		return undefined;
	}

	const existingPaths = new Set(files.map((f) => f.path));
	const prunedPaths = Object.keys(lastUsed).filter(
		(p) => !existingPaths.has(p),
	);

	const entries: MemoryEntry[] = await Promise.all(
		files.map(async (f) => {
			const text = await app.vault.read(f);
			const { description, type } = parseFrontmatter(text);
			const sortKey = Math.max(f.stat.mtime, lastUsed[f.path] ?? 0);
			return {
				path: f.path,
				line: `- ${f.path} — ${description} (${type})`,
				sortKey,
			};
		}),
	);

	// Most-recently-relevant first; ties broken by path for determinism.
	entries.sort(
		(a, b) => b.sortKey - a.sortKey || a.path.localeCompare(b.path),
	);

	let dropCount = 0;
	while (true) {
		const kept = entries.slice(0, entries.length - dropCount);
		const lines = kept.map((e) => e.line);
		if (dropCount > 0) {
			lines.push(`- [${dropCount} more memories not listed]`);
		}
		const index = lines.join("\n");
		if (index.length <= MAX_MEMORY_INDEX_CHARS || kept.length === 0) {
			return { index, prunedPaths };
		}
		dropCount++;
	}
}
