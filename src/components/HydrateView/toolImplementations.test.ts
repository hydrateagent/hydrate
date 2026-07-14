import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { toolReadFile, toolReadImage, toolFetchImage } from "./toolImplementations";

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

describe("toolReadImage", () => {
	function fakeBinaryApp(files: Record<string, ArrayBuffer>) {
		return {
			vault: {
				adapter: { exists: () => Promise.resolve(true) },
				getAbstractFileByPath: (p: string) => {
					if (!(p in files)) {
						return null;
					}
					const f = new TFile();
					f.path = p;
					return f;
				},
				readBinary: (f: TFile) => Promise.resolve(files[f.path]),
			},
			workspace: { getActiveFile: () => null },
		} as unknown as App;
	}

	it("returns the structured image result", async () => {
		const bytes = new Uint8Array([1, 2, 3]).buffer;
		const out = await toolReadImage(
			fakeBinaryApp({ "a.png": bytes }),
			"a.png",
		);
		expect(out.type).toBe("image");
		expect(out.mime_type).toBe("image/png");
		expect(out.data).toBe("AQID"); // base64 of [1,2,3]
		expect(out.source).toBe("a.png");
	});

	it("throws on unsupported extensions and missing files", async () => {
		const bytes = new Uint8Array([1]).buffer;
		await expect(
			toolReadImage(fakeBinaryApp({ "a.svg": bytes }), "a.svg"),
		).rejects.toThrow(/supported/i);
		await expect(
			toolReadImage(fakeBinaryApp({}), "missing.png"),
		).rejects.toThrow(/not found/i);
	});
});

describe("toolFetchImage", () => {
	it("fetches via the injected requester", async () => {
		const bytes = new Uint8Array([1, 2, 3]).buffer;
		const requester = (() =>
			Promise.resolve({
				status: 200,
				headers: { "content-type": "image/png" },
				arrayBuffer: bytes,
			})) as never;
		const out = await toolFetchImage(
			"https://example.com/a.png",
			requester,
		);
		expect(out.mime_type).toBe("image/png");
		expect(out.data).toBe("AQID");
		expect(out.source).toBe("https://example.com/a.png");
	});

	it("rejects non-image responses and bad status", async () => {
		const html = (() =>
			Promise.resolve({
				status: 200,
				headers: { "content-type": "text/html" },
				arrayBuffer: new Uint8Array([1]).buffer,
			})) as never;
		await expect(
			toolFetchImage("https://example.com/page", html),
		).rejects.toThrow(/did not return an image/i);
		const err404 = (() =>
			Promise.resolve({
				status: 404,
				headers: {},
				arrayBuffer: new Uint8Array().buffer,
			})) as never;
		await expect(
			toolFetchImage("https://example.com/a.png", err404),
		).rejects.toThrow(/404/);
	});
});
