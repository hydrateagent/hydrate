import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import {
	MEMORIES_FOLDER,
	MAX_MEMORY_INDEX_CHARS,
	saveMemory,
	buildMemoryIndex,
	type SaveMemoryParams,
} from "./memoryTools";

interface FakeFile {
	content: string;
	mtime: number;
}

// Minimal in-memory vault fake covering exactly what memoryTools.ts touches:
// getAbstractFileByPath, createFolder, create, modify, read, getFiles, and
// TFile.stat.mtime. createFolder throws on an already-existing folder (like
// real Obsidian) so tests can catch a redundant create.
function makeFakeVault(seed: Record<string, FakeFile> = {}) {
	const files = new Map<string, FakeFile>(Object.entries(seed));
	const folders = new Set<string>();
	let clock = 1_000_000;

	function toTFile(path: string): TFile {
		const f = new TFile();
		f.path = path;
		f.name = path.split("/").pop() ?? path;
		f.basename = f.name.replace(/\.md$/, "");
		const rec = files.get(path);
		f.stat = { ctime: rec?.mtime ?? 0, mtime: rec?.mtime ?? 0, size: 0 };
		return f;
	}

	const vault = {
		getAbstractFileByPath: (path: string) => {
			if (files.has(path)) {
				return toTFile(path);
			}
			if (folders.has(path)) {
				return new TFolder();
			}
			return null;
		},
		createFolder: async (path: string) => {
			if (folders.has(path)) {
				throw new Error(`Folder already exists: ${path}`);
			}
			folders.add(path);
			return new TFolder();
		},
		create: async (path: string, content: string) => {
			files.set(path, { content, mtime: ++clock });
			return toTFile(path);
		},
		modify: async (file: TFile, content: string) => {
			files.set(file.path, { content, mtime: ++clock });
		},
		read: async (file: TFile) => files.get(file.path)?.content ?? "",
		getFiles: () =>
			Array.from(files.keys())
				.filter((p) => p.endsWith(".md"))
				.map(toTFile),
	};

	return { app: { vault } as unknown as App, files, folders };
}

describe("saveMemory", () => {
	const baseParams: SaveMemoryParams = {
		name: "user-prefers-terse-replies",
		memory_type: "user",
		description: "User prefers terse replies.",
		content: "Keep responses short by default.",
	};

	it("creates a new memory file with exact frontmatter and returns confirmation", async () => {
		const { app, files } = makeFakeVault();
		const result = await saveMemory(app, baseParams);
		expect(result).toBe("Saved memory 'user-prefers-terse-replies'.");
		const path = `${MEMORIES_FOLDER}/user-prefers-terse-replies.md`;
		expect(files.get(path)?.content).toBe(
			"---\ndescription: User prefers terse replies.\ntype: user\n---\n\nKeep responses short by default.",
		);
	});

	it("creates the memories folder on first save only", async () => {
		const { app, folders } = makeFakeVault();
		expect(folders.has(MEMORIES_FOLDER)).toBe(false);
		await saveMemory(app, baseParams);
		expect(folders.has(MEMORIES_FOLDER)).toBe(true);
		// Second save must not attempt to recreate an existing folder — the
		// fake throws if createFolder is called redundantly.
		await expect(
			saveMemory(app, { ...baseParams, name: "second-memory" }),
		).resolves.toBe("Saved memory 'second-memory'.");
	});

	it("overwrites an existing memory (update path) and bumps mtime", async () => {
		const { app, files } = makeFakeVault();
		await saveMemory(app, baseParams);
		const path = `${MEMORIES_FOLDER}/user-prefers-terse-replies.md`;
		const firstMtime = files.get(path)!.mtime;

		const result = await saveMemory(app, {
			...baseParams,
			description: "Updated description.",
			content: "Updated content.",
		});
		expect(result).toBe("Updated memory 'user-prefers-terse-replies'.");
		expect(files.get(path)?.content).toBe(
			"---\ndescription: Updated description.\ntype: user\n---\n\nUpdated content.",
		);
		expect(files.get(path)!.mtime).toBeGreaterThan(firstMtime);
		// Still exactly one file — overwrite, not a duplicate.
		expect(files.size).toBe(1);
	});

	it("allows empty content", async () => {
		const { app, files } = makeFakeVault();
		const result = await saveMemory(app, {
			...baseParams,
			name: "empty-one",
			content: "",
		});
		expect(result).toBe("Saved memory 'empty-one'.");
		expect(files.get(`${MEMORIES_FOLDER}/empty-one.md`)?.content).toBe(
			"---\ndescription: User prefers terse replies.\ntype: user\n---\n\n",
		);
	});

	it("rejects non-kebab-case names with an instructive string, without writing", async () => {
		const { app, files } = makeFakeVault();
		const badNames = [
			"User-Prefs",
			"has_underscore",
			"trailing-",
			"-leading",
			"with space",
			"a/b",
			"UPPER",
			"double--hyphen",
			"",
		];
		for (const name of badNames) {
			const result = await saveMemory(app, { ...baseParams, name });
			expect(result).toContain("kebab-case");
			expect(result).toContain(name);
		}
		expect(files.size).toBe(0);
	});

	it("rejects invalid memory types with an instructive string, without writing", async () => {
		const { app, files } = makeFakeVault();
		const result = await saveMemory(app, {
			...baseParams,
			memory_type: "notes",
		});
		expect(result).toContain("notes");
		expect(result).toContain("user, feedback, project, reference");
		expect(files.size).toBe(0);
	});
});

describe("buildMemoryIndex", () => {
	it("returns undefined when the memories folder is absent", async () => {
		const { app } = makeFakeVault();
		expect(await buildMemoryIndex(app, {})).toBeUndefined();
	});

	it("returns undefined when the memories folder has no memory files", async () => {
		const { app, folders } = makeFakeVault();
		folders.add(MEMORIES_FOLDER);
		expect(await buildMemoryIndex(app, {})).toBeUndefined();
	});

	it("renders the exact index line format, sorted most-relevant first", async () => {
		const { app } = makeFakeVault({
			[`${MEMORIES_FOLDER}/a.md`]: {
				content: "---\ndescription: First memory\ntype: user\n---\n\nbody",
				mtime: 2000,
			},
			[`${MEMORIES_FOLDER}/b.md`]: {
				content:
					"---\ndescription: Second memory\ntype: feedback\n---\n\nbody",
				mtime: 3000,
			},
		});
		const result = await buildMemoryIndex(app, {});
		expect(result).toBeDefined();
		expect(result!.index).toBe(
			[
				`- ${MEMORIES_FOLDER}/b.md — Second memory (feedback)`,
				`- ${MEMORIES_FOLDER}/a.md — First memory (user)`,
			].join("\n"),
		);
		expect(result!.prunedPaths).toEqual([]);
	});

	it("falls back to defaults for missing or malformed frontmatter", async () => {
		const { app } = makeFakeVault({
			[`${MEMORIES_FOLDER}/no-frontmatter.md`]: {
				content: "just a plain note, no frontmatter",
				mtime: 1000,
			},
			[`${MEMORIES_FOLDER}/partial.md`]: {
				content: "---\ntype: reference\n---\n\nbody",
				mtime: 1000,
			},
		});
		const result = await buildMemoryIndex(app, {});
		expect(result!.index).toContain(
			`- ${MEMORIES_FOLDER}/no-frontmatter.md — (no description) (project)`,
		);
		expect(result!.index).toContain(
			`- ${MEMORIES_FOLDER}/partial.md — (no description) (reference)`,
		);
	});

	it("uses max(mtime, lastUsed) as the relevance sort key", async () => {
		const pathOld = `${MEMORIES_FOLDER}/old-mtime-recently-used.md`;
		const pathNew = `${MEMORIES_FOLDER}/new-mtime-never-used.md`;
		const { app } = makeFakeVault({
			[pathOld]: {
				content: "---\ndescription: old\ntype: user\n---\n\nx",
				mtime: 100,
			},
			[pathNew]: {
				content: "---\ndescription: new\ntype: user\n---\n\nx",
				mtime: 200,
			},
		});
		const result = await buildMemoryIndex(app, { [pathOld]: 9_999 });
		const lines = result!.index.split("\n");
		expect(lines[0]).toContain(pathOld);
		expect(lines[1]).toContain(pathNew);
	});

	it("reports lastUsed entries whose files no longer exist as prunedPaths", async () => {
		const { app } = makeFakeVault({
			[`${MEMORIES_FOLDER}/still-here.md`]: {
				content: "---\ndescription: d\ntype: user\n---\n\nx",
				mtime: 1000,
			},
		});
		const lastUsed = {
			[`${MEMORIES_FOLDER}/still-here.md`]: 500,
			[`${MEMORIES_FOLDER}/deleted-one.md`]: 999,
		};
		const result = await buildMemoryIndex(app, lastUsed);
		expect(result!.prunedPaths).toEqual([
			`${MEMORIES_FOLDER}/deleted-one.md`,
		]);
	});

	it("keeps everything at the exact byte budget; one char over evicts the least-recently-relevant entry", async () => {
		const pathA = `${MEMORIES_FOLDER}/a.md`;
		const pathB = `${MEMORIES_FOLDER}/b.md`;
		const lineFor = (path: string, description: string, type: string) =>
			`- ${path} — ${description} (${type})`;

		// Size B's description so [lineA, lineB] joined by "\n" lands exactly
		// on MAX_MEMORY_INDEX_CHARS.
		const lineA = lineFor(pathA, "d", "user");
		const fillerLen =
			MAX_MEMORY_INDEX_CHARS -
			lineA.length -
			1 /* \n */ -
			lineFor(pathB, "", "project").length;
		const descB = "d".repeat(fillerLen);
		const lineB = lineFor(pathB, descB, "project");
		expect(lineA.length + 1 + lineB.length).toBe(MAX_MEMORY_INDEX_CHARS);

		const { app: atBudgetApp } = makeFakeVault({
			[pathA]: {
				content: "---\ndescription: d\ntype: user\n---\n\nx",
				mtime: 2000, // more recent — survives eviction
			},
			[pathB]: {
				content: `---\ndescription: ${descB}\ntype: project\n---\n\nx`,
				mtime: 1000, // older — least-recently-relevant
			},
		});
		const atBudget = await buildMemoryIndex(atBudgetApp, {});
		expect(atBudget!.index).toBe([lineA, lineB].join("\n"));
		expect(atBudget!.index.length).toBe(MAX_MEMORY_INDEX_CHARS);

		// One character over: must evict B (older) and append the tail line,
		// which stays within budget.
		const descB2 = descB + "d";
		const { app: overBudgetApp } = makeFakeVault({
			[pathA]: {
				content: "---\ndescription: d\ntype: user\n---\n\nx",
				mtime: 2000,
			},
			[pathB]: {
				content: `---\ndescription: ${descB2}\ntype: project\n---\n\nx`,
				mtime: 1000,
			},
		});
		const overBudget = await buildMemoryIndex(overBudgetApp, {});
		expect(overBudget!.index).toBe(
			[lineA, "- [1 more memories not listed]"].join("\n"),
		);
		expect(overBudget!.index.length).toBeLessThanOrEqual(
			MAX_MEMORY_INDEX_CHARS,
		);
	});
});
