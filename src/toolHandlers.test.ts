import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";

vi.mock("./vectorIndex", () => ({
	searchIndexRemote: vi.fn(async () => [
		{ filePath: "notes/a.md", score: 0.91 },
	]),
}));

import { handleSearchProject } from "./toolHandlers";

function fakeApp(files: Record<string, string>) {
	return {
		vault: {
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
	};
}

const settings = {
	enableRemoteEmbeddings: true,
	remoteEmbeddingUrl: "https://example.test",
	remoteEmbeddingApiKey: "k",
	remoteEmbeddingModelName: "m",
};

describe("handleSearchProject", () => {
	it("attaches a snippet from the matched file", async () => {
		const app = fakeApp({
			"notes/a.md": "intro\nthe quarterly roadmap lives here\noutro",
		});
		const out = await handleSearchProject(
			{ id: "t1", tool: "search_project", params: { query: "roadmap" } } as never,
			app as never,
			settings as never,
		);
		expect(out.result).toContain("notes/a.md");
		expect(out.result).toContain("Snippet:");
		expect(out.result).toContain("quarterly roadmap");
	});

	it("degrades to path+score when the file is unreadable", async () => {
		const out = await handleSearchProject(
			{ id: "t1", tool: "search_project", params: { query: "roadmap" } } as never,
			fakeApp({}) as never,
			settings as never,
		);
		expect(out.result).toContain("notes/a.md");
		expect(out.result).not.toContain("Snippet:");
	});
});
