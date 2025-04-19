import { App, TFile, Notice } from "obsidian";

/**
 * Reads the content of a file within the Obsidian vault.
 * @param app - The Obsidian App instance.
 * @param path - The vault path to the file.
 * @returns The content of the file as a string.
 * @throws Error if the file is not found or is not a file.
 */
export async function toolReadFile(app: App, path: string): Promise<string> {
	const normalizedPath = path.startsWith("./") ? path.substring(2) : path;
	console.log(`Tool: Reading file ${normalizedPath} (Original: ${path})`);
	const file = app.vault.getAbstractFileByPath(normalizedPath);
	if (!file) {
		throw new Error(`File not found: ${normalizedPath}`);
	}
	if (!(file instanceof TFile)) {
		throw new Error(`Path is not a file: ${normalizedPath}`);
	}
	return await app.vault.read(file);
}

/**
 * Applies the final content to a file within the Obsidian vault.
 * @param app - The Obsidian App instance.
 * @param path - The vault path to the file.
 * @param final_content - The complete new content for the file.
 * @param instructions - Description of the change (for logging).
 * @returns A success message string.
 * @throws Error if the file is not found, not a file, or writing fails.
 */
export async function toolEditFile(
	app: App,
	path: string,
	final_content: string,
	instructions: string
): Promise<string> {
	const normalizedPath = path.startsWith("./") ? path.substring(2) : path;
	console.log(
		`Tool: Applying final content to ${normalizedPath} (Instructions: ${instructions})`
	);
	const file = app.vault.getAbstractFileByPath(normalizedPath);
	if (!file) {
		throw new Error(
			`File not found during edit application: ${normalizedPath}`
		);
	}
	if (!(file instanceof TFile)) {
		throw new Error(
			`Path is not a file during edit application: ${normalizedPath}`
		);
	}

	try {
		await app.vault.modify(file, final_content);
		const successMsg = `Successfully applied changes to ${normalizedPath}`;
		new Notice(successMsg);
		return successMsg;
	} catch (error: any) {
		console.error(
			`Error during vault.modify for ${normalizedPath}:`,
			error
		);
		throw new Error(
			`Failed to write changes to ${normalizedPath}: ${error.message}`
		);
	}
}
