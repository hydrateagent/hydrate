import { Notice, TFile, requestUrl } from "obsidian";
import type { ProVibeView } from "../../../proVibeView"; // Corrected type import
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
	const registeredEntries = view.plugin.getRegistryEntries();

	if (registeredEntries.length > 0) {
		const triggerMap = new Map<string, string>();
		registeredEntries.forEach((entry: any) => {
			if (entry.slashCommandTrigger) {
				triggerMap.set(entry.slashCommandTrigger, entry.content);
			}
		});

		if (triggerMap.size > 0) {
			const escapedTriggers = Array.from(triggerMap.keys()).map((cmd) =>
				cmd.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")
			);
			const commandRegex = new RegExp(
				`(${escapedTriggers.join("|")})(?=\\s|$)`,
				"g"
			);
			payloadContent = originalMessageContent.replace(
				commandRegex,
				(match) => {
					const commandName = match.substring(1);
					const content = triggerMap.get(match) ?? "";
					return `${commandName}\n${content}`;
				}
			);
		}
	}

	const currentAttachedFiles = [...view.attachedFiles];
	const attachedFilesContent = currentAttachedFiles
		.map((path) => `[File: ${path}]`)
		.join("\n");

	let combinedPayload = payloadContent;
	if (attachedFilesContent) {
		combinedPayload =
			attachedFilesContent +
			(payloadContent ? "\n\n" + payloadContent : "");
	}

	if (!attachedFilesContent && !originalMessageContent) return;

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
			const matchingEntries = allEntries.filter(
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
