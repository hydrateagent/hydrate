import { Notice, TFile, requestUrl, MarkdownView } from "obsidian";
import type { ProVibeView } from "./proVibeView";
import { RegistryEntry } from "../../types"; // Added import
import {
	addMessageToChat,
	renderFilePills as renderDomFilePills,
	setLoadingState as setDomLoadingState,
	setSuggestions as setDomSuggestions,
	setTextContent as setDomTextContent,
	renderSuggestions as renderDomSuggestions,
} from "./domUtils";

// Define types for clarity if needed, e.g., for state or complex parameters

/**
 * Clears the chat input and attached files.
 */
export const handleClear = (view: ProVibeView): void => {
	setDomTextContent(view, "");
	view.attachedFiles = [];
	view.initialFilePathFromState = null;
	view.wasInitiallyAttached = false;
	view.capturedSelection = null;
	renderDomFilePills(view);
	view.conversationId = null;
	setDomSuggestions(view, []);
	addMessageToChat(view, "system", "Chat cleared. New conversation started.");
	view.textInput.style.height = "auto";
	view.textInput.dispatchEvent(new Event("input"));
	view.textInput.focus();
};

/**
 * Handles file drops into the input area.
 */
export const handleDrop = (view: ProVibeView, event: DragEvent): void => {
	event.preventDefault();
	event.stopPropagation();
	const containerEl = view.containerEl;
	const inputAreaContainer = containerEl.querySelector(
		".provibe-input-area-container"
	);
	if (!inputAreaContainer) return;
	inputAreaContainer.classList.remove("provibe-drag-over");

	let pathData = "";
	if (event.dataTransfer?.types.includes("text/uri-list")) {
		pathData = event.dataTransfer.getData("text/uri-list");
	} else if (event.dataTransfer?.types.includes("text/plain")) {
		pathData = event.dataTransfer.getData("text/plain");
	}

	if (!pathData) {
		console.warn("ProVibe drop: Could not extract path data.");
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

		// ... (rest of path resolution logic from ProVibeView.handleDrop) ...
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
						`ProVibe drop: No 'file' param in URI: ${potentialPath}`
					);
				}
			} catch (e) {
				console.error(
					`ProVibe drop: Error parsing URI: ${potentialPath}`,
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
					`ProVibe drop: Error decoding file URI: ${potentialPath}`,
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
						`ProVibe drop: Ambiguous match for ${normalizedPathForComparison}: Found ${possibleMatches
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
export const removeFilePill = (view: ProVibeView, filePath: string): void => {
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
export const handleSend = async (view: ProVibeView): Promise<void> => {
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

	// --- Step 1: Handle /select command ---
	const selectCommand = "/select";
	if (payloadContent.includes(selectCommand)) {
		console.log("[handleSend] /select command detected.");
		// Use the continuously captured selection
		const selectedText = view.capturedSelection; // Get from state
		console.log(
			"[handleSend] Using captured selection:",
			`'${selectedText}'`
		);

		if (selectedText) {
			// Check if captured selection exists
			payloadContent = payloadContent.replace(
				selectCommand,
				`\n\n--- Selected Text ---\n${selectedText}\n--- End Selected Text ---`
			);
			console.log(
				"ProVibe: Replaced /select with captured selected text."
			);
		} else {
			// Remove the command entirely if no text was captured
			payloadContent = payloadContent.replace(selectCommand, "").trim();
			addMessageToChat(
				view,
				"system",
				"No text selection was captured while '/select' was present. Command ignored."
			);
			console.log(
				"ProVibe: /select command found but no captured selection available, removing command."
			);
		}
		// Clear the captured selection state *after* using it
		view.capturedSelection = null;
	}
	console.log(
		"[handleSend] payloadContent after /select processing:",
		payloadContent
	);
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
				// Optionally add an error marker to the payload?
				// fileContentsToSend += `\n\n--- Error Reading File: ${filePath} ---`;
			}
		}
	}
	// --- End Step 3 ---

	// --- Step 4: Construct final payload --- // Renumbered step
	// Start with the user message + replaced selections/commands
	let combinedPayload = payloadContent;
	// Append the content of newly included files (if any)
	combinedPayload += fileContentsToSend;

	// Remove the old [File: path] indicators as content is now inline
	// const attachedFilesContent = currentAttachedFiles
	// 	.map((path) => `[File: ${path}]`)
	// 	.join("\n");
	// if (attachedFilesContent) {
	// 	combinedPayload =
	// 		attachedFilesContent +
	// 		(combinedPayload ? "\n\n" + combinedPayload : "");
	// }

	console.log(
		"[handleSend] Final combinedPayload (length):",
		combinedPayload.length
	);
	// console.log("[handleSend] Final combinedPayload (snippet):", combinedPayload.substring(0, 500)); // Log snippet

	if (currentAttachedFiles.length === 0 && !originalMessageContent) return; // Check if *anything* is being sent

	addMessageToChat(
		view,
		"user",
		originalMessageContent ||
			`(Sent with ${currentAttachedFiles.length} attached file(s))`
	);

	const payload: any = {
		message: combinedPayload,
	};
	if (view.conversationId) {
		payload.conversation_id = view.conversationId;
	}

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
		view.capturedSelection = null;
	}
};

/**
 * Stops the ongoing backend request.
 */
export const handleStop = async (view: ProVibeView): Promise<void> => {
	if (!view.isLoading || !view.conversationId || !view.stopButton) return;

	view.stopButton.textContent = "Stopping...";
	view.stopButton.disabled = true;

	const backendUrl = view.plugin.settings.backendUrl;
	if (!backendUrl) {
		new Notice("Backend URL is not configured.");
		if (view.isLoading && view.stopButton) {
			view.stopButton.textContent = "Stop";
			view.stopButton.disabled = false;
		}
		return;
	}

	const stopUrl = `${backendUrl}/stop/${view.conversationId}`;

	try {
		await requestUrl({ url: stopUrl, method: "POST" });
		new Notice("Stop signal sent.");
	} catch (error: any) {
		console.error("Error sending stop signal:", error);
		new Notice(`Failed to send stop signal: ${error.message}`);
		if (view.isLoading && view.stopButton) {
			view.stopButton.textContent = "Stop";
			view.stopButton.disabled = false;
		}
	}
};

/**
 * Handles selection of a suggestion.
 */
export const handleSuggestionSelect = (
	view: ProVibeView,
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
export const handleInputChange = (view: ProVibeView): void => {
	const value = view.textInput.value;
	const cursorPos = view.textInput.selectionStart;

	if (cursorPos === null) {
		setDomSuggestions(view, []);
		return;
	}
	const textBeforeCursor = value.substring(0, cursorPos);

	const match = textBeforeCursor.match(/(?:\s|^)(\/([a-zA-Z0-9_-]*))$/);

	if (match) {
		const trigger = match[1];
		const triggerStart =
			match.index !== undefined
				? match.index + (match[0].startsWith("/") ? 0 : 1)
				: -1;

		if (triggerStart !== -1) {
			const allEntries = view.plugin.getRegistryEntries();
			let matchingEntries = allEntries.filter(
				(entry: any) =>
					entry.slashCommandTrigger?.startsWith(trigger) &&
					entry.slashCommandTrigger !== "/"
			);

			if (matchingEntries.length > 0) {
				view.currentTrigger = trigger;
				view.triggerStartIndex = triggerStart;
				setDomSuggestions(view, matchingEntries);
			} else {
				setDomSuggestions(view, []);
			}
		} else {
			setDomSuggestions(view, []);
		}
	} else {
		setDomSuggestions(view, []);
	}
};

/**
 * Handles keydown events in the input area (e.g., Enter to send).
 */
export const handleInputKeydown = (
	view: ProVibeView,
	event: KeyboardEvent
): void => {
	const suggestionsVisible =
		view.suggestions.length > 0 &&
		view.suggestionsContainer?.style.display !== "none";

	if (suggestionsVisible) {
		switch (event.key) {
			case "ArrowUp":
				event.preventDefault();
				view.activeSuggestionIndex =
					(view.activeSuggestionIndex - 1 + view.suggestions.length) %
					view.suggestions.length;
				renderDomSuggestions(view);
				break;
			case "ArrowDown":
				event.preventDefault();
				view.activeSuggestionIndex =
					(view.activeSuggestionIndex + 1) % view.suggestions.length;
				renderDomSuggestions(view);
				break;
			case "Enter":
			case "Tab":
				if (view.activeSuggestionIndex !== -1) {
					event.preventDefault();
					handleSuggestionSelect(view, view.activeSuggestionIndex);
				} else {
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						setDomSuggestions(view, []);
						handleSend(view);
					} else if (event.key === "Tab") {
						setDomSuggestions(view, []);
					}
				}
				break;
			case "Escape":
				event.preventDefault();
				setDomSuggestions(view, []);
				break;
			default:
				break;
		}
	} else if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		handleSend(view);
	}
};
