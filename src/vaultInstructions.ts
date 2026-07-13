import { type App, TFile } from "obsidian";

export const VAULT_INSTRUCTIONS_FILE = "HYDRATE.md";

// Best-effort read of the vault-root instructions file; undefined when
// missing, empty, or unreadable — the conversation proceeds without it.
export async function readVaultInstructions(
	app: App,
): Promise<string | undefined> {
	try {
		const file = app.vault.getAbstractFileByPath(VAULT_INSTRUCTIONS_FILE);
		if (file instanceof TFile) {
			const text = await app.vault.read(file);
			return text.trim() ? text : undefined;
		}
	} catch {
		// fall through
	}
	return undefined;
}
