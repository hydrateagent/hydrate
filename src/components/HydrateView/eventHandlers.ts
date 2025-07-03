import { Notice, TFile, requestUrl, MarkdownView } from "obsidian";
import { TFolder } from "obsidian";
import { ManifestFile, DirectoryManifest } from "../../manifestUtils";
import * as path from "path";
import type { HydrateView } from "./hydrateView";
import { RegistryEntry } from "../../types"; // Added import
import {
	addMessageToChat,
	renderFilePills as renderDomFilePills,
	setLoadingState as setDomLoadingState,
	setSuggestions as setDomSuggestions,
	setTextContent as setDomTextContent,
	renderSuggestions as renderDomSuggestions,
	setNoteSearchResults,
	selectNoteSearchResult,
	renderNoteSearchSuggestions,
} from "./domUtils";
import { NoteSearchModal } from "./NoteSearchModal";
import { SlashCommandModal } from "./SlashCommandModal";

// Define types for clarity if needed, e.g., for state or complex parameters

/**
 * Clears the chat input and attached files.
 */
export const handleClear = (view: HydrateView): void => {
	setDomTextContent(view, "");
	view.attachedFiles = [];
	view.initialFilePathFromState = null;
	view.wasInitiallyAttached = false;
	view.capturedSelections = [];
	renderDomFilePills(view);
	view.conversationId = null;
	view.sentFileContentRegistry.clear();
	view.appliedRuleIds.clear();
	view.chatContainer.innerHTML = "";
	addMessageToChat(view, "system", "Chat cleared. New conversation started.");
	view.textInput.style.height = "auto";
	view.textInput.dispatchEvent(new Event("input"));
	view.textInput.focus();
};

/**
 * Handles file drops into the input area.
 */
export const handleDrop = (view: HydrateView, event: DragEvent): void => {
	event.preventDefault();
	event.stopPropagation();
	const containerEl = view.containerEl;
	const inputAreaContainer = containerEl.querySelector(
		".hydrate-input-area-container"
	);
	if (!inputAreaContainer) return;
	inputAreaContainer.classList.remove("hydrate-drag-over");

	let pathData = "";
	if (event.dataTransfer?.types.includes("text/uri-list")) {
		pathData = event.dataTransfer.getData("text/uri-list");
	} else if (event.dataTransfer?.types.includes("text/plain")) {
		pathData = event.dataTransfer.getData("text/plain");
	}

	if (!pathData) {
		console.warn("Hydrate drop: Could not extract path data.");
		return;
	}

	const potentialPaths = pathData
		.split(/\r?\n/)
		.map((p) => p.trim())
		.filter((p) => p);
	const allVaultFiles = view.app.vault.getFiles();
	let filesAdded = 0;
	let failedPaths: string[] = [];

	potentialPaths.forEach((potentialPath) => {
		let vaultPath: string | null = null;
		let foundVaultFile: TFile | null = null;
		let normalizedPathForComparison: string | null = null;

		// ... (rest of path resolution logic from HydrateView.handleDrop) ...
		if (
			potentialPath.startsWith("obsidian://open?vault=") ||
			potentialPath.startsWith("obsidian://vault/")
		) {
			try {
				const url = new URL(potentialPath);
				const filePathParam = url.searchParams.get("file");
				if (filePathParam) {
					normalizedPathForComparison =
						decodeURIComponent(filePathParam);
				} else {
					console.warn(
						`Hydrate drop: No 'file' param in URI: ${potentialPath}`
					);
				}
			} catch (e) {
				console.error(
					`Hydrate drop: Error parsing URI: ${potentialPath}`,
					e
				);
			}
		} else if (potentialPath.startsWith("file://")) {
			try {
				let osPath = decodeURIComponent(potentialPath.substring(7));
				if (/^\/[a-zA-Z]:/.test(osPath)) {
					osPath = osPath.substring(1);
				}
				normalizedPathForComparison = osPath.replace(/\\/g, "/");
			} catch (e) {
				console.error(
					`Hydrate drop: Error decoding file URI: ${potentialPath}`,
					e
				);
			}
		} else {
			normalizedPathForComparison = potentialPath.replace(/\\/g, "/");
		}

		if (normalizedPathForComparison) {
			const directMatch = view.app.vault.getAbstractFileByPath(
				normalizedPathForComparison
			);
			if (directMatch instanceof TFile) {
				foundVaultFile = directMatch;
			}
			if (!foundVaultFile) {
				const lowerCaseNormalized =
					normalizedPathForComparison.toLowerCase();
				foundVaultFile =
					allVaultFiles.find(
						(vf: TFile) =>
							lowerCaseNormalized.endsWith(
								"/" + vf.path.toLowerCase()
							) || lowerCaseNormalized === vf.path.toLowerCase()
					) || null;
			}
			if (!foundVaultFile) {
				const possibleMatches = allVaultFiles.filter((vf: TFile) =>
					vf.path
						.toLowerCase()
						.startsWith(
							normalizedPathForComparison!.toLowerCase() + "."
						)
				);
				if (possibleMatches.length === 1) {
					foundVaultFile = possibleMatches[0];
				} else if (possibleMatches.length > 1) {
					console.warn(
						`Hydrate drop: Ambiguous match for ${normalizedPathForComparison}: Found ${possibleMatches
							.map((f: TFile) => f.path)
							.join(", ")}`
					);
				}
			}
		}

		if (foundVaultFile) {
			vaultPath = foundVaultFile.path;
		}

		if (vaultPath) {
			if (!view.attachedFiles.includes(vaultPath)) {
				view.attachedFiles.push(vaultPath);
				view.wasInitiallyAttached = false;
				filesAdded++;
			} else {
				// Optional: Notice if file already attached
			}
		} else {
			failedPaths.push(potentialPath);
		}
	});

	if (filesAdded > 0) {
		renderDomFilePills(view);
		new Notice(`Added ${filesAdded} file(s).`);
	}

	if (failedPaths.length > 0) {
		new Notice(
			`Could not resolve ${failedPaths.length} dropped item(s) to vault files.`
		);
	}
};

/**
 * Removes a specific file pill and the corresponding file from the attached list.
 */
export const removeFilePill = (view: HydrateView, filePath: string): void => {
	const initialLength = view.attachedFiles.length;
	view.attachedFiles = view.attachedFiles.filter(
		(path: string) => path !== filePath
	);
	const removed = initialLength > view.attachedFiles.length;

	if (removed) {
		if (filePath === view.initialFilePathFromState) {
			view.initialFilePathFromState = null;
			view.wasInitiallyAttached = false;
		} else {
			if (view.wasInitiallyAttached) {
				view.wasInitiallyAttached = false;
			}
		}
		renderDomFilePills(view);
	}
};

/**
 * Sends the current input and attached files to the backend.
 */
export const handleSend = async (view: HydrateView): Promise<void> => {
	if (view.isLoading) return;

	if (
		view.suggestions.length > 0 &&
		view.activeSuggestionIndex !== -1 &&
		view.suggestionsContainer?.style.display !== "none"
	) {
		handleSuggestionSelect(view, view.activeSuggestionIndex);
		return;
	}

	const originalMessageContent = view.textInput.value.trim();
	let payloadContent = originalMessageContent;
	console.log("[handleSend] Initial payloadContent:", payloadContent);

	// --- Step 1: Handle /selectNN commands ---
	const capturedSelections = [...view.capturedSelections]; // Copy array
	if (capturedSelections.length > 0) {
		console.log(
			`[handleSend] Found ${capturedSelections.length} captured selection(s).`
		);
		for (let i = 0; i < capturedSelections.length; i++) {
			const index = i + 1; // 1-based index for token
			const formattedIndex = index.toString().padStart(2, "0");
			const token = `/select${formattedIndex}`;
			const selectionText = capturedSelections[i];

			if (payloadContent.includes(token)) {
				const replacement = `\n\n--- Selected Text ${index} ---\n${selectionText}\n--- End Selected Text ${index} ---\n`;
				// Use replaceAll in case the same token was somehow added multiple times (though command logic prevents this)
				payloadContent = payloadContent.replaceAll(token, replacement);
				console.log(
					`[handleSend] Replaced ${token} with Selected Text ${index}.`
				);
			} else {
				console.warn(
					`[handleSend] Token ${token} not found in payloadContent, but selection ${index} was captured.`
				);
				// Optionally add a note about the unused selection?
			}
		}
		// Clear the selections array in the view state AFTER processing
		view.capturedSelections = [];
		console.log("[handleSend] Cleared captured selections array.");
	}
	// --- End Step 1 ---

	// --- Step 2: Handle registered slash commands ---
	const registeredEntries = view.plugin.getRegistryEntries();
	if (registeredEntries.length > 0) {
		const triggerMap = new Map<string, string>();
		registeredEntries.forEach((entry: RegistryEntry) => {
			// Use RegistryEntry type
			if (entry.slashCommandTrigger) {
				triggerMap.set(entry.slashCommandTrigger, entry.content);
			}
		});

		if (triggerMap.size > 0) {
			const escapedTriggers = Array.from(triggerMap.keys()).map((cmd) =>
				cmd.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")
			);
			// Regex to find registered commands *only*
			const commandRegex = new RegExp(
				`(?<!\\S)(${escapedTriggers.join("|")})(?=\\s|$)`, // Added negative lookbehind for start of word
				"g"
			);

			// Perform replacement directly on payloadContent
			payloadContent = payloadContent.replace(commandRegex, (match) => {
				// Replace the trigger entirely with its mapped content
				return triggerMap.get(match) ?? ""; // Return empty string if no content
			});
		}
	}
	console.log(
		"[handleSend] payloadContent after registered command processing:",
		payloadContent
	);
	// --- End Step 2 ---

	// --- Step 3: Read and Inject Attached File Contents ---
	let fileContentsToSend = "";
	const currentAttachedFiles = [...view.attachedFiles];
	const currentConvoId = view.conversationId; // Can be null on first turn

	// --- NEW: Step 3: Inject Rules Based on Frontmatter ---
	let rulesContextToSend = "";
	// const rulesToApplyThisTurn: RuleEntry[] = []; // Optional: For logging/debugging

	for (const filePath of currentAttachedFiles) {
		try {
			const file = view.app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile) {
				const fileCache = view.app.metadataCache.getFileCache(file);
				const ruleTags = fileCache?.frontmatter?.["hydrate-rules"];

				let currentFileRuleIds: string[] = [];
				if (typeof ruleTags === "string") {
					currentFileRuleIds = [ruleTags.trim()];
				} else if (Array.isArray(ruleTags)) {
					currentFileRuleIds = ruleTags
						.filter((tag): tag is string => typeof tag === "string")
						.map((tag) => tag.trim());
				}

				for (const ruleId of currentFileRuleIds) {
					if (ruleId && !view.appliedRuleIds.has(ruleId)) {
						const rule = view.plugin.getRuleById(ruleId);
						if (rule) {
							view.appliedRuleIds.add(ruleId);
							// rulesToApplyThisTurn.push(rule); // Optional
							rulesContextToSend += `\n\n--- Begin Applied Rule: ${rule.id} ---\n${rule.ruleText}\n--- End Applied Rule: ${rule.id} ---\n`;
							console.log(
								`[handleSend] Applying rule '${ruleId}' for the first time this conversation.`
							);
						}
					}
				}
			} else {
				console.warn(
					`[handleSend] Could not find TFile for rule check: ${filePath}`
				);
			}
		} catch (error) {
			console.error(
				`[handleSend] Error processing rules for file ${filePath}:`,
				error
			);
		}
	}
	// --- End NEW Step 3 ---

	// --- Step 4: Read and Inject Attached File Contents ---
	for (const filePath of currentAttachedFiles) {
		let shouldSendContent = false;
		const registryKey = currentConvoId
			? `${currentConvoId}:${filePath}`
			: null;

		if (!currentConvoId) {
			// First turn of a conversation
			shouldSendContent = true;
		} else if (
			registryKey &&
			!view.sentFileContentRegistry.has(registryKey)
		) {
			// Subsequent turn, not sent yet for this convo
			shouldSendContent = true;
		}

		if (shouldSendContent) {
			console.log(
				`[handleSend] Reading content for ${filePath} (Convo: ${
					currentConvoId || "NEW"
				})`
			);
			try {
				const file = view.app.vault.getAbstractFileByPath(filePath);
				if (file instanceof TFile) {
					const content = await view.app.vault.read(file);
					fileContentsToSend += `\n\n--- File Content: ${filePath} ---\n${content}\n--- End File Content ---`;
					// Add to registry ONLY if we have a convo ID (won't have one on the very first send)
					if (registryKey) {
						view.sentFileContentRegistry.add(registryKey);
						console.log(
							`[handleSend] Added ${registryKey} to sent registry.`
						);
					}
				} else {
					console.warn(
						`[handleSend] Attached path is not a TFile: ${filePath}`
					);
				}
			} catch (error) {
				console.error(
					`[handleSend] Error reading attached file ${filePath}:`,
					error
				);
			}
		}
	}
	// --- End Step 4 ---

	// --- START: Apply diff - NEW STEP: Inject Local Directory Manifest Context ---
	let localManifestContext = "";
	let pathForManifestLookup: string | undefined = undefined;

	// Priority 1: Use the first attached file's directory
	if (view.attachedFiles && view.attachedFiles.length > 0) {
		pathForManifestLookup = view.attachedFiles[0];
	}

	// Fallback: If no files are attached, try to determine the relevant context
	if (!pathForManifestLookup) {
		const activeFile = view.app.workspace.getActiveFile();
		if (activeFile) {
			pathForManifestLookup = activeFile.path;
			console.log(
				`[handleSend] Using activeFile for manifest lookup: ${activeFile.path}`
			);
		} else {
			console.log(
				"[handleSend] No activeFile found. Trying activeMarkdownView..."
			);
			// Fallback to existing logic if getActiveFile() is null
			const activeMarkdownView =
				view.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeMarkdownView && activeMarkdownView.file) {
				pathForManifestLookup = activeMarkdownView.file.path;
				console.log(
					`[handleSend] Using activeMarkdownView for manifest lookup: ${activeMarkdownView.file.path}`
				);
			} else {
				console.log(
					"[handleSend] No activeMarkdownView with a file found either."
				);
				// pathForManifestLookup remains undefined
			}
		}
	}

	// Debug log for the path determination logic
	console.log("[handleSend] Determining path for manifest lookup:", {
		firstAttachedFilePath:
			view.attachedFiles && view.attachedFiles.length > 0
				? view.attachedFiles[0]
				: null,
		activeObsidianFilePath:
			view.app.workspace.getActiveFile()?.path ?? null,
		activeMarkdownViewFilePathViaType:
			view.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path ??
			null,
		finalPathForManifestLookup: pathForManifestLookup, // This is the important one
	});

	if (pathForManifestLookup) {
		try {
			const dir = path.dirname(pathForManifestLookup);
			// Only proceed if not in vault root (dirname would be '.')
			if (dir && dir !== ".") {
				const manifestFilePath = path.join(dir, ".hydrate-manifest.md");
				const manifestFileExists = await view.app.vault.adapter.exists(
					manifestFilePath
				);

				if (manifestFileExists) {
					console.log(
						`[handleSend] Found manifest file at: ${manifestFilePath}`
					);
					const manifestContent = await view.app.vault.adapter.read(
						manifestFilePath
					);
					const manifest =
						ManifestFile.fromString(manifestContent).getManifest();

					localManifestContext += `\n\n--- Directory Manifest Context for: ${dir} ---\n`;
					localManifestContext += `Purpose: ${manifest.purpose}\n`;
					localManifestContext += `Type: ${manifest.type}\n`;
					if (manifest.domain)
						localManifestContext += `Domain: ${manifest.domain}\n`;
					if (manifest.parent)
						localManifestContext += `Parent: ${manifest.parent}\n`;

					if (manifest.children && manifest.children.length > 0) {
						localManifestContext += `Children: ${manifest.children.join(
							", "
						)}\n`;
					}
					localManifestContext += "Contents:\n";
					if (manifest.contents && manifest.contents.length > 0) {
						manifest.contents.forEach((item) => {
							localManifestContext += `- ${item.name} (Type: ${
								item.type
							}, Modified: ${item.modified}): ${
								item.purpose || "N/A"
							}\n`;
						});
					} else {
						localManifestContext +=
							"(No files listed in manifest)\n";
					}
					localManifestContext += `--- End Manifest Context for: ${dir} ---\n`;
					console.log(
						"[handleSend] Successfully added local manifest context."
					);
				} else {
					console.log(
						`[handleSend] No manifest file found at: ${manifestFilePath}`
					);
				}
			} else {
				console.log(
					`[handleSend] File for manifest lookup ('${pathForManifestLookup}') is in vault root, or dir is invalid. Skipping manifest context.`
				);
			}
		} catch (error) {
			console.error(
				`[handleSend] Error processing local directory manifest using path '${pathForManifestLookup}':`,
				error
			);
		}
	} else {
		console.log(
			"[handleSend] No valid file path found (via attached files, active file, or active markdown view) for manifest lookup. Skipping manifest context."
		);
	}
	// --- END: Apply diff - NEW STEP ---

	// --- Step 5: Construct final payload ---
	let combinedPayload = payloadContent;

	// Prepend rules context first, if it exists
	if (rulesContextToSend) {
		combinedPayload = rulesContextToSend + combinedPayload;
	}

	// Append local manifest context if available and not empty
	if (localManifestContext && localManifestContext.trim() !== "") {
		// Ensure there's a separator
		if (combinedPayload.length > 0 && !combinedPayload.endsWith("\n\n")) {
			combinedPayload += "\n\n";
		}
		combinedPayload += localManifestContext;
	}

	// Append file contents last
	if (fileContentsToSend && fileContentsToSend.trim() !== "") {
		// Ensure there's a separator
		if (combinedPayload.length > 0 && !combinedPayload.endsWith("\n\n")) {
			combinedPayload += "\n\n";
		}
		combinedPayload += fileContentsToSend;
	}
	// --- END: Corrected Payload Construction ---

	console.log(
		"[handleSend] Final combinedPayload (length):",
		combinedPayload.length
	);

	// --- START: Apply diff for conditional send and user message ---
	if (
		currentAttachedFiles.length === 0 &&
		!originalMessageContent &&
		(!localManifestContext || localManifestContext.trim() === "") // Use localManifestContext from this scope
	)
		return;

	addMessageToChat(
		view,
		"user",
		originalMessageContent ||
			`(Sent with ${currentAttachedFiles.length} attached file(s)${
				// Use localManifestContext from this scope
				localManifestContext && localManifestContext.trim() !== ""
					? " and local directory context"
					: ""
			})`
	);
	// --- END: Apply diff for conditional send and user message ---

	// Collect MCP tools from running servers
	let mcpTools: any[] = [];
	if (view.plugin.mcpManager) {
		try {
			console.log("[handleSend] MCP Manager found, checking servers...");
			console.log(
				"[handleSend] Number of servers:",
				view.plugin.mcpManager.getServerCount()
			);
			console.log(
				"[handleSend] Server statuses:",
				view.plugin.mcpManager.getServerStatuses()
			);

			mcpTools = await view.plugin.mcpManager.getAllDiscoveredTools();
			console.log(
				`[handleSend] Collected ${mcpTools.length} MCP tools for backend:`,
				mcpTools
			);
		} catch (error) {
			console.warn("[handleSend] Error collecting MCP tools:", error);
		}
	} else {
		console.warn("[handleSend] No MCP Manager found!");
	}

	const payload: any = {
		message: combinedPayload, // Use the carefully constructed combinedPayload
		conversation_id: view.conversationId,
		model: view.plugin.getSelectedModel(),
		mcp_tools: mcpTools, // Include MCP tools in the request
	};

	// --- START: Apply diff debug log for payload ---
	console.log(
		"[Hydrate - handleSend] Payload to be sent to agent:",
		JSON.stringify(payload, null, 2)
	);
	// --- END: Apply diff debug log for payload ---

	setDomTextContent(view, "");
	setDomSuggestions(view, []);
	setDomLoadingState(view, true);

	try {
		await view.callBackend("/chat", payload);
	} catch (error: any) {
		console.error("Error sending message:", error);
		addMessageToChat(
			view,
			"system",
			`Error: ${error.message || "Failed to connect to backend"}`,
			true
		);
		setDomLoadingState(view, false);
	} finally {
		view.textInput.focus();
		view.textInput.style.height = "auto";
		view.textInput.dispatchEvent(new Event("input"));
		// Ensure captured selection is cleared even on error
		view.capturedSelections = [];
	}
};

/**
 * Stops the current backend request.
 */
export const handleStop = async (view: HydrateView): Promise<void> => {
	if (!view.isLoading || !view.abortController) {
		console.log("Hydrate: Stop clicked, but no request is active.");
		return;
	}

	console.log("Hydrate: Stop requested. Aborting current request...");
	const currentConversationId = view.conversationId; // Capture ID before clearing

	// Abort the frontend fetch request immediately
	view.abortController.abort();
	view.abortController = null; // Clear the controller

	// Stop the loading state visually
	setDomLoadingState(view, false);

	// Inform the user
	addMessageToChat(view, "system", "Request stopped by user.");

	// If we have a conversation ID, tell the backend to stop too
	if (currentConversationId) {
		console.log(
			`Hydrate: Sending stop signal to backend for conversation ${currentConversationId}...`
		);
		const stopUrl = `${view.plugin.settings.backendUrl}/stop/${currentConversationId}`;
		const apiKey = view.plugin.settings.apiKey;

		if (!apiKey) {
			console.error("Hydrate: Cannot send stop signal, API Key missing.");
			// No need to add another chat message, already indicated stop locally
			return;
		}

		try {
			// Send a quick POST request to the /stop endpoint
			// Note: This request doesn't need an abort signal itself
			const stopResponse = await requestUrl({
				url: stopUrl,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-API-Key": apiKey,
				},
				body: JSON.stringify({}), // Empty body, ID is in URL
				throw: false, // Don't throw on 4xx/5xx for this signal
			});

			if (stopResponse.status >= 400) {
				console.warn(
					`Hydrate: Backend returned status ${stopResponse.status} on stop signal: ${stopResponse.text}`
				);
				// Optionally notify user if backend stop failed, but might be noise
			} else {
				console.log(
					"Hydrate: Backend acknowledged stop signal.",
					stopResponse.json
				);
			}
		} catch (error) {
			console.error(
				"Hydrate: Error sending stop signal to backend:",
				error
			);
			// Optionally notify user of error sending stop signal
		}
	} else {
		console.log(
			"Hydrate: No conversation ID found, cannot send stop signal to backend."
		);
	}

	// Ensure UI is fully reset (e.g., re-enable input if needed)
	view.textInput.disabled = false;
	view.textInput.focus();
};

/**
 * Handles selection of a suggestion.
 */
export const handleSuggestionSelect = (
	view: HydrateView,
	index: number
): void => {
	if (
		index < 0 ||
		index >= view.suggestions.length ||
		!view.currentTrigger ||
		view.triggerStartIndex === -1
	) {
		setDomSuggestions(view, []);
		return;
	}

	const selectedEntry = view.suggestions[index];
	if (!selectedEntry?.slashCommandTrigger) return;

	const currentValue = view.textInput.value;
	const triggerEndIndex = view.triggerStartIndex + view.currentTrigger.length;

	const newValue =
		currentValue.substring(0, view.triggerStartIndex) +
		selectedEntry.slashCommandTrigger +
		" " +
		currentValue.substring(triggerEndIndex);

	setDomTextContent(view, newValue);
	setDomSuggestions(view, []);

	const newCursorPos =
		view.triggerStartIndex + selectedEntry.slashCommandTrigger.length + 1;
	view.textInput.focus();
	requestAnimationFrame(() => {
		view.textInput.setSelectionRange(newCursorPos, newCursorPos);
	});
};

/**
 * Handles input changes in the text area to show suggestions.
 */
export const handleInputChange = (view: HydrateView): void => {
	const value = view.textInput.value;
	const cursorPos = view.textInput.selectionStart;

	// Track if user is deleting (shorter input than before)
	const currentLength = value.length;
	const isDeleting = currentLength < (view as any).lastInputLength;
	(view as any).lastInputLength = currentLength;
	(view as any).isDeleting = isDeleting;

	if (cursorPos === null) {
		return;
	}
	const textBeforeCursor = value.substring(0, cursorPos);

	// Check for note search pattern [[ first (but not if deleting)
	const noteSearchMatch = textBeforeCursor.match(/\[\[([^\]]*?)$/);
	if (noteSearchMatch && !isDeleting) {
		const query = noteSearchMatch[1];
		const triggerStart =
			noteSearchMatch.index !== undefined ? noteSearchMatch.index : -1;

		if (triggerStart !== -1) {
			// Open note search modal
			const modal = new NoteSearchModal(
				view.app,
				view,
				(selectedFile: TFile) => {
					// Add the file to attached files if not already present
					if (!view.attachedFiles.includes(selectedFile.path)) {
						view.attachedFiles.push(selectedFile.path);
						renderDomFilePills(view);
					}

					// Remove the [[ from the input
					const currentValue = view.textInput.value;
					const beforeTrigger = currentValue.substring(
						0,
						triggerStart
					);
					const afterCursor = currentValue.substring(cursorPos);

					const newValue = beforeTrigger + afterCursor;
					setDomTextContent(view, newValue);

					// Position cursor
					const newCursorPos = beforeTrigger.length;
					view.textInput.focus();
					requestAnimationFrame(() => {
						view.textInput.setSelectionRange(
							newCursorPos,
							newCursorPos
						);
					});
				}
			);

			modal.open();
			return;
		}
	}

	// Check for slash command pattern (but not if deleting)
	const slashMatch = textBeforeCursor.match(/(?:\s|^)(\/([a-zA-Z0-9_-]*))$/);
	if (slashMatch && !isDeleting) {
		const trigger = slashMatch[1];
		const partialCommand = slashMatch[2];
		const triggerStart =
			slashMatch.index !== undefined
				? slashMatch.index + (slashMatch[0].startsWith("/") ? 0 : 1)
				: -1;

		if (triggerStart !== -1) {
			const allEntries = view.plugin.getRegistryEntries();
			let matchingEntries = allEntries.filter(
				(entry: any) =>
					entry.slashCommandTrigger?.startsWith(trigger) &&
					entry.slashCommandTrigger !== "/"
			);

			if (matchingEntries.length > 0) {
				// Open slash command modal
				const modal = new SlashCommandModal(
					view.app,
					view,
					matchingEntries,
					partialCommand,
					(selectedEntry: RegistryEntry) => {
						const currentValue = view.textInput.value;
						const triggerEndIndex = triggerStart + trigger.length;

						const newValue =
							currentValue.substring(0, triggerStart) +
							selectedEntry.slashCommandTrigger +
							" " +
							currentValue.substring(triggerEndIndex);

						setDomTextContent(view, newValue);

						const newCursorPos =
							triggerStart +
							(selectedEntry.slashCommandTrigger?.length || 0) +
							1;
						view.textInput.focus();
						requestAnimationFrame(() => {
							view.textInput.setSelectionRange(
								newCursorPos,
								newCursorPos
							);
						});
					}
				);

				modal.open();
				return;
			}
		}
	}
};

/**
 * Handles keydown events in the input area (e.g., Enter to send).
 */
export const handleInputKeydown = (
	view: HydrateView,
	event: KeyboardEvent
): void => {
	// Since we're using modals for suggestions, we only need to handle Enter for sending
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		handleSend(view);
	}
};
