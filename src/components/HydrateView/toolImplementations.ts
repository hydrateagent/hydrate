import { App, TFile, Notice, normalizePath } from "obsidian";
import HydratePlugin from "../../main";
import { Patch } from "../../types";
import { devLog } from "../../utils/logger";
/**
 * Reads the content of a file within the Obsidian vault.
 * @param app - The Obsidian App instance.
 * @param path - The vault path to the file.
 * @returns The content of the file as a string.
 * @throws Error if the file is not found or is not a file.
 */
export async function toolReadFile(app: App, path: string): Promise<string> {
	const initialNormalizedPath = path.startsWith("./")
		? path.substring(2)
		: path;
	const finalNormalizedPath = normalizePath(initialNormalizedPath);

	const adapterExists = await app.vault.adapter.exists(finalNormalizedPath);

	const file = app.vault.getAbstractFileByPath(finalNormalizedPath);
	if (!file) {
		// Add more context to the error
		const activeFilePath = app.workspace.getActiveFile()?.path;
		devLog.error(
			`toolReadFile: File not found. Path='${finalNormalizedPath}', ActiveFile='${activeFilePath}'. Adapter says exists: ${adapterExists}`,
		);
		throw new Error(`File not found: ${finalNormalizedPath}`);
	}
	if (!(file instanceof TFile)) {
		throw new Error(`Path is not a file: ${finalNormalizedPath}`);
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
	const initialNormalizedPath = path.startsWith("./")
		? path.substring(2)
		: path;
	const finalNormalizedPath = normalizePath(initialNormalizedPath);
	const file = app.vault.getAbstractFileByPath(finalNormalizedPath);

	// Check if file exists before deciding create vs modify
	if (!file) {
		// File does not exist, create it
		try {
			await app.vault.create(finalNormalizedPath, final_content);
			const successMsg = `Successfully created file ${finalNormalizedPath}`;
			new Notice(successMsg);
			return successMsg;
		} catch (error: unknown) {
			devLog.error(
				`Error during vault.create for ${finalNormalizedPath}:`,
				error,
			);
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			throw new Error(
				`Failed to create file ${finalNormalizedPath}: ${errorMessage}`,
			);
		}
	} else if (file instanceof TFile) {
		// File exists, modify it
		try {
			// Here we are overwriting the file's full contents regardless of its previous
			// contents.  This is necessary for the Agent to make fixes in certain cases.
			await app.vault.modify(file, final_content);
			const successMsg = `Successfully overwrote file content of ${finalNormalizedPath}`;
			new Notice(successMsg);
			return successMsg;
		} catch (error: unknown) {
			devLog.error(
				`Error during vault.modify for ${finalNormalizedPath}:`,
				error,
			);
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			throw new Error(
				`Failed to write new content to ${finalNormalizedPath}: ${errorMessage}`,
			);
		}
	} else {
		// Path exists but is not a file (e.g., a folder)
		throw new Error(
			`Path exists but is not a file: ${finalNormalizedPath}`,
		);
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
	const initialNormalizedPath = path.startsWith("./")
		? path.substring(2)
		: path;
	const finalNormalizedPath = normalizePath(initialNormalizedPath);
	const file = app.vault.getAbstractFileByPath(finalNormalizedPath);
	if (!file) {
		throw new Error(`File not found: ${finalNormalizedPath}`);
	}
	if (!(file instanceof TFile)) {
		throw new Error(`Path is not a file: ${finalNormalizedPath}`);
	}

	let statusMessage = "";

	// Here we are reading and replacing and so the process API is used
	await app.vault.process(file, (originalContent) => {
		// Check if the exact selection exists in the file
		if (!originalContent.includes(original_selection)) {
			devLog.warn(
				`Original selection not found in ${finalNormalizedPath}. Content may have changed.`,
			);
			// Consider if we should still attempt replacement or throw a more specific error.
			// For now, let's throw an error to prevent unexpected full-file replacement if the context is lost.
			throw new Error(
				`The exact original selection was not found in the file ${finalNormalizedPath}. Cannot perform replacement.`,
			);
		}
		// Replace only the first occurrence
		const final_content = originalContent.replace(
			original_selection,
			new_content,
		);
		// Check if content actually changed (replacement might result in the same string)
		if (final_content === originalContent) {
			statusMessage = `Replacement in ${finalNormalizedPath} resulted in no change to the file content.`;
			return originalContent;
		}

		statusMessage = `Successfully replaced selection in ${finalNormalizedPath}`;
		new Notice(statusMessage);
		return final_content;
	});

	return statusMessage;
}

interface ApplyPatchesParams {
	path: string;
	patches: Patch[];
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
	params: ApplyPatchesParams,
): Promise<string> {
	const path = params.path;
	const patches = params.patches;

	if (!path) {
		return "Error: 'path' parameter is missing.";
	}
	if (!Array.isArray(patches)) {
		return "Error: 'patches' parameter must be an array.";
	}
	if (patches.length === 0) {
		return "No patches provided, no changes made.";
	}
	// Also apply normalizePath here for consistency, though it's not the primary source of the bug
	const normalizedPathForPatches = normalizePath(
		path.startsWith("./") ? path.substring(2) : path,
	);

	const file = plugin.app.vault.getAbstractFileByPath(
		normalizedPathForPatches,
	);
	if (!file || !(file instanceof TFile)) {
		return `Error: File not found or is not a markdown file: ${normalizedPathForPatches}`;
	}

	let statusMessage = "";

	// Here we are reding the file and making changes, so process api is definitely correct
	await plugin.app.vault.process(file, (currentContent) => {
		let contentChanged = false;
		const errors: string[] = [];

		// Apply patches sequentially
		for (let i = 0; i < patches.length; i++) {
			const patch = patches[i];

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
				devLog.error(`Patch ${i + 1} invalid:`, patch);
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
				devLog.error(
					`Patch ${i + 1} invalid due to empty context:`,
					patch,
				);
				continue;
			}

			// Find the context in the *current* state of the content
			const contextIndex = currentContent.indexOf(contextString);

			if (contextIndex === -1) {
				// Provide more detailed debugging information
				const contentPreview =
					currentContent.length > 200
						? currentContent.substring(0, 200) + "..."
						: currentContent;
				const errorMsg = `Patch ${
					i + 1
				} failed: Could not find context in ${normalizedPathForPatches}.\n\nContext Searched For:\n\`\`\`\n${contextString}\n\`\`\`\n\nFile Content Preview:\n\`\`\`\n${contentPreview}\n\`\`\`\n\nPatch Details:\n${JSON.stringify(
					patch,
					null,
					2,
				)}\n\nThis often happens when:\n1. The text was modified since the patch was created\n2. The 'before' or 'after' context doesn't match exactly\n3. The 'old' text is no longer present in the file`;
				errors.push(errorMsg);
				devLog.error(errorMsg);
				continue;
			}

			// Check for ambiguity (multiple occurrences of the context) - only if context is not empty
			const secondContextIndex = contextString
				? currentContent.indexOf(contextString, contextIndex + 1)
				: -1;
			if (secondContextIndex !== -1) {
				const errorMsg = `Patch ${
					i + 1
				} failed: Ambiguous context found in ${normalizedPathForPatches}. Multiple matches for:\n\`\`\`\n${contextString}\n\`\`\`\nPlease provide more specific 'before' or 'after' context.\nPatch Details:\n${JSON.stringify(
					patch,
				)}`;
				errors.push(errorMsg);
				devLog.error(errorMsg);
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

			contentChanged = true;
		}

		// If any errors occurred, report them and don't save
		if (errors.length > 0) {
			const errorSummary = `Errors applying patches to ${
				file.basename
			}:\n- ${errors.join("\n- ")}`;
			new Notice(errorSummary, 10000);
			devLog.error("Patch application failed with errors:", errors);
			statusMessage = `Failed to apply all patches:\n${errors.join("\n")}`;
		}

		// Save the content, make appropriate status message
		if (contentChanged) {
			new Notice(`File '${file.basename}' updated with patches.`);
			statusMessage = `Successfully applied ${patches.length} patches to file: ${path}`;
		} else {
			statusMessage =
				"No changes applied (patches might have been invalid or context not found).";
		}
		return currentContent;
	});

	return statusMessage;
}
