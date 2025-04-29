import { App, TFile, Notice } from "obsidian";
import HydratePlugin from "../../main";
import { Patch } from "../../types";
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
	instructions: string,
): Promise<string> {
	const normalizedPath = path.startsWith("./") ? path.substring(2) : path;
	console.log(
		`Tool: Applying content to ${normalizedPath} (Instructions: ${instructions})`,
	);
	const file = app.vault.getAbstractFileByPath(normalizedPath);

	// Check if file exists before deciding create vs modify
	if (!file) {
		// File does not exist, create it
		console.log(`Tool: File ${normalizedPath} not found. Creating...`);
		try {
			await app.vault.create(normalizedPath, final_content);
			const successMsg = `Successfully created file ${normalizedPath}`;
			new Notice(successMsg);
			return successMsg;
		} catch (error: any) {
			console.error(
				`Error during vault.create for ${normalizedPath}:`,
				error,
			);
			throw new Error(
				`Failed to create file ${normalizedPath}: ${error.message}`,
			);
		}
	} else if (file instanceof TFile) {
		// File exists, modify it
		console.log(`Tool: File ${normalizedPath} exists. Modifying...`);
		try {
			await app.vault.modify(file, final_content);
			const successMsg = `Successfully applied changes to ${normalizedPath}`;
			new Notice(successMsg);
			return successMsg;
		} catch (error: any) {
			console.error(
				`Error during vault.modify for ${normalizedPath}:`,
				error,
			);
			throw new Error(
				`Failed to write changes to ${normalizedPath}: ${error.message}`,
			);
		}
	} else {
		// Path exists but is not a file (e.g., a folder)
		throw new Error(`Path exists but is not a file: ${normalizedPath}`);
	}
}

/**
 * Replaces the first occurrence of a specific selection within a file.
 * @param app - The Obsidian App instance.
 * @param path - The vault path to the file.
 * @param original_selection - The exact text that was selected and should be replaced.
 * @param new_content - The new text to insert in place of the original selection.
 * @returns A success message string.
 * @throws Error if the file is not found, not a file, the selection is not found, or writing fails.
 */
export async function toolReplaceSelectionInFile(
	app: App,
	path: string,
	original_selection: string,
	new_content: string,
): Promise<string> {
	const normalizedPath = path.startsWith("./") ? path.substring(2) : path;
	console.log(
		`Tool: Replacing selection in ${normalizedPath} (Original Selection: '${original_selection.substring(
			0,
			50,
		)}...')`,
	);

	const file = app.vault.getAbstractFileByPath(normalizedPath);
	if (!file) {
		throw new Error(`File not found: ${normalizedPath}`);
	}
	if (!(file instanceof TFile)) {
		throw new Error(`Path is not a file: ${normalizedPath}`);
	}

	const originalContent = await app.vault.read(file);

	// Check if the exact selection exists in the file
	if (!originalContent.includes(original_selection)) {
		console.warn(
			`Original selection not found in ${normalizedPath}. Content may have changed.`,
		);
		// Consider if we should still attempt replacement or throw a more specific error.
		// For now, let's throw an error to prevent unexpected full-file replacement if the context is lost.
		throw new Error(
			`The exact original selection was not found in the file ${normalizedPath}. Cannot perform replacement.`,
		);
	}

	// Replace only the first occurrence
	const final_content = originalContent.replace(
		original_selection,
		new_content,
	);

	// Check if content actually changed (replacement might result in the same string)
	if (final_content === originalContent) {
		const noChangeMsg = `Replacement in ${normalizedPath} resulted in no change to the file content.`;
		console.log(noChangeMsg);
		// Return success, as the intended state (post-replacement) matches current state.
		return noChangeMsg;
	}

	try {
		await app.vault.modify(file, final_content);
		const successMsg = `Successfully replaced selection in ${normalizedPath}`;
		new Notice(successMsg);
		return successMsg;
	} catch (error: any) {
		console.error(
			`Error during vault.modify for selection replacement in ${normalizedPath}:`,
			error,
		);
		throw new Error(
			`Failed to write changes after replacing selection in ${normalizedPath}: ${error.message}`,
		);
	}
}

/**
 * Applies patches to a file within the Obsidian vault.
 * @param plugin - The HydratePlugin instance.
 * @param params - The parameters for applying patches.
 * @returns A success message string.
 * @throws Error if the file is not found, not a file, or applying patches fails.
 */
export async function applyPatchesToFile(
	plugin: HydratePlugin,
	params: any,
): Promise<string> {
	console.log("Applying patches with params:", params);

	const path = params.path as string;
	const patches = params.patches as Patch[];

	if (!path) {
		return "Error: 'path' parameter is missing.";
	}
	if (!Array.isArray(patches)) {
		return "Error: 'patches' parameter must be an array.";
	}
	if (patches.length === 0) {
		return "No patches provided, no changes made.";
	}

	const file = plugin.app.vault.getAbstractFileByPath(path);
	if (!file || !(file instanceof TFile)) {
		return `Error: File not found or is not a markdown file: ${path}`;
	}

	try {
		let currentContent = await plugin.app.vault.read(file);
		let contentChanged = false;
		const errors: string[] = [];

		// Apply patches sequentially
		for (let i = 0; i < patches.length; i++) {
			const patch = patches[i];
			console.log(`Processing patch ${i + 1}:`, patch);

			// Validate patch structure
			if (
				patch.old === undefined ||
				patch.old === null ||
				patch.new === undefined ||
				patch.new === null
			) {
				errors.push(
					`Patch ${i + 1} is invalid: missing 'old' or 'new' field.`,
				);
				console.error(`Patch ${i + 1} invalid:`, patch);
				continue;
			}

			const before = patch.before ?? "";
			const oldText = patch.old;
			const after = patch.after ?? "";
			const newText = patch.new;

			// Construct the search context string
			// Be cautious: If oldText is empty (insertion), context relies solely on before/after.
			const contextString = before + oldText + after;

			if (!contextString) {
				errors.push(
					`Patch ${
						i + 1
					} is invalid: cannot apply patch with empty context (before, old, and after are all effectively empty).`,
				);
				console.error(
					`Patch ${i + 1} invalid due to empty context:`,
					patch,
				);
				continue;
			}

			// Find the context in the *current* state of the content
			const contextIndex = currentContent.indexOf(contextString);

			if (contextIndex === -1) {
				const errorMsg = `Patch ${
					i + 1
				} failed: Could not find context in ${path}.\nContext Searched:\n\`\`\`\n${contextString}\n\`\`\`\nPatch Details:\n${JSON.stringify(
					patch,
				)}`;
				errors.push(errorMsg);
				console.error(errorMsg);
				continue;
			}

			// Check for ambiguity (multiple occurrences of the context)
			const secondContextIndex = currentContent.indexOf(
				contextString,
				contextIndex + 1,
			);
			if (secondContextIndex !== -1) {
				const errorMsg = `Patch ${
					i + 1
				} failed: Ambiguous context found in ${path}. Multiple matches for:\n\`\`\`\n${contextString}\n\`\`\`\nPlease provide more specific 'before' or 'after' context.\nPatch Details:\n${JSON.stringify(
					patch,
				)}`;
				errors.push(errorMsg);
				console.error(errorMsg);
				continue;
			}

			// Calculate start and end indices for the replacement
			const startIndex = contextIndex + before.length;
			const endIndex = startIndex + oldText.length;

			// Perform the replacement
			currentContent =
				currentContent.substring(0, startIndex) +
				newText +
				currentContent.substring(endIndex);

			console.log(`Patch ${i + 1} applied successfully.`);
			contentChanged = true;
		}

		// If any errors occurred, report them and don't save
		if (errors.length > 0) {
			const errorSummary = `Errors applying patches to ${
				file.basename
			}:\n- ${errors.join("\n- ")}`;
			new Notice(errorSummary, 10000);
			console.error("Patch application failed with errors:", errors);
			return `Failed to apply all patches:\n${errors.join("\n")}`;
		}

		// Save the modified content if changes were made
		if (contentChanged) {
			await plugin.app.vault.modify(file, currentContent);
			new Notice(`File '${file.basename}' updated with patches.`);
			return `Successfully applied ${patches.length} patches to file: ${path}`;
		} else {
			return "No changes applied (patches might have been invalid or context not found).";
		}
	} catch (error) {
		console.error(`Error applying patches to file ${path}:`, error);
		new Notice(
			`Error applying patches to file ${file.basename}: ${error.message}`,
		);
		return `Error applying patches to file: ${error.message}`;
	}
}
