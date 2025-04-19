import { Notice, TFile } from "obsidian";
import type ProVibeView from "../../../proVibeView"; // Use type import for the view
import {
	addMessageToChat,
	renderFilePills,
	setLoadingState,
	setSuggestions,
	setTextContent,
} from "./domUtils";

// Define types for clarity if needed, e.g., for state or complex parameters

/**
 * Clears the chat input and attached files.
 */
export const handleClear = (view: ProVibeView): void => {
	setTextContent(view.inputContainer, "");
	view.attachedFiles = [];
	renderFilePills(view.filePillsContainer, view.attachedFiles, (file) =>
		removeFilePill(view, file)
	);
	setSuggestions(view.suggestionsContainer, []);
};

/**
 * Handles file drops into the input area.
 */
export const handleDrop = (view: ProVibeView, event: DragEvent): void => {
	event.preventDefault();
	event.stopPropagation();

	if (event.dataTransfer?.files) {
		const files = Array.from(event.dataTransfer.files);
		const obsidianFiles: TFile[] = [];

		for (const file of files) {
			// Attempt to find the corresponding TFile in the vault
			// This part might need refinement based on how files are identified
			const tFile = view.app.vault.getAbstractFileByPath(file.path);
			if (tFile instanceof TFile) {
				obsidianFiles.push(tFile);
			} else {
				new Notice(`File not found in vault: ${file.name}`);
			}
		}

		view.attachedFiles.push(...obsidianFiles);
		renderFilePills(view.filePillsContainer, view.attachedFiles, (file) =>
			removeFilePill(view, file)
		);
	}
};

/**
 * Removes a specific file pill and the corresponding file from the attached list.
 */
export const removeFilePill = (
	view: ProVibeView,
	fileToRemove: TFile
): void => {
	view.attachedFiles = view.attachedFiles.filter(
		(file) => file.path !== fileToRemove.path
	);
	renderFilePills(view.filePillsContainer, view.attachedFiles, (file) =>
		removeFilePill(view, file)
	);
};

/**
 * Sends the current input and attached files to the backend.
 */
export const handleSend = async (view: ProVibeView): Promise<void> => {
	const inputText = view.inputContainer.textContent ?? "";
	if (!inputText.trim() && view.attachedFiles.length === 0) {
		new Notice("Please enter a message or attach a file.");
		return;
	}

	setLoadingState(view.loadingIndicator, true);
	addMessageToChat(view.chatContainer, "user", inputText, view.attachedFiles);

	// Clear input and pills after sending
	handleClear(view);

	try {
		await view.callBackend(
			inputText,
			view.attachedFiles,
			view.conversationId
		);
	} catch (error) {
		console.error("Error calling backend:", error);
		new Notice("Failed to get response from ProVibe.");
		addMessageToChat(
			view.chatContainer,
			"error",
			"Error: Could not get response."
		);
	} finally {
		setLoadingState(view.loadingIndicator, false);
	}
};

/**
 * Stops the ongoing backend request.
 */
export const handleStop = (view: ProVibeView): void => {
	if (view.currentRequestController) {
		view.currentRequestController.abort();
		view.currentRequestController = null;
		setLoadingState(view.loadingIndicator, false);
		new Notice("Request stopped.");
	} else {
		new Notice("No active request to stop.");
	}
};

/**
 * Handles selection of a suggestion.
 */
export const handleSuggestionSelect = (
	view: ProVibeView,
	suggestionText: string
): void => {
	setTextContent(view.inputContainer, suggestionText);
	setSuggestions(view.suggestionsContainer, []); // Clear suggestions
	// Optionally trigger send immediately?
	// handleSend(view);
};

/**
 * Handles input changes in the text area to show suggestions.
 */
export const handleInputChange = (view: ProVibeView): void => {
	const currentText = view.inputContainer.textContent ?? "";
	// Basic suggestion logic (example: show suggestions if input ends with '/')
	if (currentText.endsWith("/")) {
		// Replace with actual suggestion fetching/filtering logic
		const fetchedSuggestions = [
			"/explain this code",
			"/find bugs",
			"/refactor",
		];
		setSuggestions(
			view.suggestionsContainer,
			fetchedSuggestions,
			(suggestion) => handleSuggestionSelect(view, suggestion)
		);
	} else {
		setSuggestions(view.suggestionsContainer, []);
	}
};

/**
 * Handles keydown events in the input area (e.g., Enter to send).
 */
export const handleInputKeydown = (
	view: ProVibeView,
	event: KeyboardEvent
): void => {
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault(); // Prevent newline
		handleSend(view);
	} else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
		// Add suggestion navigation logic if suggestions are visible
		// event.preventDefault();
		// navigateSuggestions(view, event.key);
	}
};
