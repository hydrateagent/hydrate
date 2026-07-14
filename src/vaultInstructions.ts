import { type App, TFile } from "obsidian";

export const VAULT_INSTRUCTIONS_FILE = "HYDRATE.md";

// Mirrors the server-side cap in prompts.py (build_system_prompt); bytes past
// this would be shipped only to be truncated server-side.
export const MAX_VAULT_INSTRUCTIONS_CHARS = 16_000;

// Best-effort read of the vault-root instructions file; undefined when
// missing, empty, or unreadable — the conversation proceeds without it.
export async function readVaultInstructions(
	app: App,
): Promise<string | undefined> {
	try {
		const file = app.vault.getAbstractFileByPath(VAULT_INSTRUCTIONS_FILE);
		if (file instanceof TFile) {
			const text = await app.vault.read(file);
			if (!text.trim()) {
				return undefined;
			}
			return text.slice(0, MAX_VAULT_INSTRUCTIONS_CHARS);
		}
	} catch {
		// fall through
	}
	return undefined;
}
