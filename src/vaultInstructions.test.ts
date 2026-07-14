import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import { readVaultInstructions, MAX_VAULT_INSTRUCTIONS_CHARS } from "./vaultInstructions";

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
			read: (f: TFile) => Promise.resolve(files[f.path]),
		},
	} as never;
}

describe("readVaultInstructions", () => {
	it("returns HYDRATE.md contents", async () => {
		const out = await readVaultInstructions(
			fakeApp({ "HYDRATE.md": "Always be terse." }),
		);
		expect(out).toBe("Always be terse.");
	});

	it("returns undefined when missing or blank", async () => {
		expect(await readVaultInstructions(fakeApp({}))).toBeUndefined();
		expect(
			await readVaultInstructions(fakeApp({ "HYDRATE.md": "   \n" })),
		).toBeUndefined();
	});

	it("returns undefined when the read throws", async () => {
		const app = fakeApp({ "HYDRATE.md": "x" });
		(app as { vault: { read: unknown } }).vault.read = () =>
			Promise.reject(new Error("boom"));
		expect(await readVaultInstructions(app)).toBeUndefined();
	});

	it("clamps content to MAX_VAULT_INSTRUCTIONS_CHARS", async () => {
		// Create content that exceeds MAX_VAULT_INSTRUCTIONS_CHARS
		const longContent = "a".repeat(20_000);
		const out = await readVaultInstructions(
			fakeApp({ "HYDRATE.md": longContent }),
		);
		expect(out).toBeDefined();
		expect(out!.length).toBe(MAX_VAULT_INSTRUCTIONS_CHARS);
	});
});
