import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { toolReadFile } from "./toolImplementations";

function fakeApp(files: Record<string, string>): App {
	return {
		vault: {
			adapter: { exists: async (p: string) => p in files },
			getAbstractFileByPath: (p: string) => {
				if (!(p in files)) {
					return null;
				}
				const f = new TFile();
				f.path = p;
				return f;
			},
			read: async (f: TFile) => files[f.path],
		},
		workspace: { getActiveFile: () => null },
	} as unknown as App;
}

describe("toolReadFile", () => {
	const content = Array.from(
		{ length: 50 },
		(_, i) => `row ${i + 1}`,
	).join("\n");

	it("reads whole small files", async () => {
		const out = await toolReadFile(fakeApp({ "a.md": content }), "a.md");
		expect(out).toBe(content);
	});

	it("pages with offset/limit and notices", async () => {
		const out = await toolReadFile(
			fakeApp({ "a.md": content }),
			"a.md",
			10,
			2,
		);
		expect(out).toContain("row 10");
		expect(out).toContain("row 11");
		expect(out).not.toContain("row 12");
		expect(out).toContain("lines 10-11");
	});

	it("still throws on missing files", async () => {
		await expect(
			toolReadFile(fakeApp({}), "missing.md"),
		).rejects.toThrow("File not found");
	});
});
