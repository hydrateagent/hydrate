import { MarkdownRenderer, Notice, setIcon } from "obsidian";
import { HydrateView } from "./hydrateView"; // Corrected path
import { RegistryEntry, ChatTurn } from "../../types"; // Corrected path (up two levels from components/HydrateView)
import {
	removeFilePill as removeEventHandlerFilePill,
	handleSuggestionSelect,
} from "./eventHandlers"; // Import the handler

/**
 * Adds a message to the chat container with appropriate styling.
 */
export function addMessageToChat(
	view: HydrateView,
	role: "user" | "agent" | "system",
	content: string | HTMLElement,
	isError: boolean = false
): void {
	const chatContainer = view.chatContainer as HTMLDivElement; // Access private member
	const plugin = view.plugin; // Access private member

	if (!chatContainer) {
		console.error("Hydrate DOM Utils: chatContainer is null!");
		return;
	}

	const messageClasses = [
		"hydrate-message",
		`hydrate-${role}-message`,
		"p-2",
		"rounded-md",
		"max-w-[90%]",
		"mb-2",
		"select-text",
		"break-words",
		"whitespace-pre-wrap",
	];

	if (role === "user") {
		messageClasses.push(
			"ml-auto",
			"bg-[var(--interactive-accent)]",
			"text-[var(--text-on-accent)]"
		);
	} else if (role === "agent") {
		messageClasses.push("mr-auto", "bg-[var(--background-secondary)]");
	} else {
		messageClasses.push(
			"mx-auto",
			"text-xs",
			"text-[var(--text-muted)]",
			"italic",
			"text-center"
		);
	}

	if (isError) {
		messageClasses.push(
			"hydrate-error-message",
			"bg-[var(--background-modifier-error)]",
			"text-[var(--text-error)]"
		);
	}

	const messageEl = chatContainer.createDiv({
		cls: messageClasses.join(" "),
	});

	// Make agent messages relative for absolute positioning of the copy button
	if (role === "agent") {
		messageEl.style.position = "relative";
		// Add some padding to the bottom to avoid overlap with the button
		messageEl.style.paddingBottom = "24px"; // Adjust as needed
	}

	if (content instanceof HTMLElement) {
		messageEl.appendChild(content);
	} else if (role === "agent") {
		const originalContentString = content; // Store original string for copying
		try {
			// Render markdown first
			MarkdownRenderer.render(plugin.app, content, messageEl, "", plugin);

			// Create and add the copy button AFTER rendering
			const copyButton = messageEl.createEl("button", {
				cls: "hydrate-copy-button absolute bottom-1 right-1 p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] transition-colors duration-150",
				attr: { "aria-label": "Copy message" },
			});

			// Use Obsidian's setIcon helper
			setIcon(copyButton, "copy"); // Use Lucide icon name
			// Adjust icon size if needed (optional)
			copyButton.children[0]?.setAttribute("width", "14");
			copyButton.children[0]?.setAttribute("height", "14");

			copyButton.addEventListener("click", async (e) => {
				e.stopPropagation(); // Prevent event bubbling
				try {
					await navigator.clipboard.writeText(originalContentString);
					// Show success feedback by changing the icon
					setIcon(copyButton, "check");
					copyButton.children[0]?.setAttribute("width", "14");
					copyButton.children[0]?.setAttribute("height", "14");

					setTimeout(() => {
						// Revert back to copy icon
						setIcon(copyButton, "copy");
						copyButton.children[0]?.setAttribute("width", "14");
						copyButton.children[0]?.setAttribute("height", "14");
					}, 1500); // Revert after 1.5 seconds
				} catch (err) {
					console.error("Failed to copy text: ", err);
					new Notice("Failed to copy message.");
				}
			});
		} catch (renderError) {
			console.error("Markdown rendering error:", renderError);
			messageEl.setText(`(Error rendering message) ${content}`);
		}
	} else if (role === "user") {
		const registeredEntries = plugin.getRegistryEntries();
		const registeredCommands = registeredEntries
			.map((e: RegistryEntry) => e.slashCommandTrigger)
			.filter((t: string | undefined): t is string => !!t);

		// Add the built-in /select command to the list of commands to highlight
		const allCommandsToHighlight = [...registeredCommands, "/select"];

		if (allCommandsToHighlight.length > 0) {
			const escapedCommands = allCommandsToHighlight.map((cmd: string) =>
				cmd.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")
			);
			const commandRegex = new RegExp(
				`(${escapedCommands.join("|")})(?=\\s|$)`,
				"g"
			);

			let lastIndex = 0;
			let match;
			const fragment = document.createDocumentFragment();

			while ((match = commandRegex.exec(content)) !== null) {
				if (match.index > lastIndex) {
					fragment.appendChild(
						document.createTextNode(
							content.substring(lastIndex, match.index)
						)
					);
				}
				const strongEl = document.createElement("strong");
				strongEl.addClass("hydrate-slash-command-display");
				strongEl.textContent = match[0];
				fragment.appendChild(strongEl);
				lastIndex = commandRegex.lastIndex;
			}

			if (lastIndex < content.length) {
				fragment.appendChild(
					document.createTextNode(content.substring(lastIndex))
				);
			}
			messageEl.appendChild(fragment);
		} else {
			messageEl.createSpan({ text: content });
		}
	} else {
		messageEl.createSpan({ text: content });
	}

	requestAnimationFrame(() => {
		chatContainer.scrollTop = chatContainer.scrollHeight;
	});

	// Track this message in chat history (skip system messages and when restoring from history)
	if (role !== "system" && typeof content === "string") {
		const chatTurn = {
			role: role as "user" | "agent",
			content: content,
			timestamp: new Date().toISOString(),
		};
		// Only add to history if we're not currently restoring from history
		if (!view.isRestoringFromHistory) {
			view.currentChatTurns.push(chatTurn);

			// Refresh context suggestions after new messages (but not for system messages)
			if (role === "user" || role === "agent") {
				// Use setTimeout to avoid blocking the UI
				setTimeout(() => {
					view.refreshContextSuggestions?.();
				}, 1000);
			}
		}
	}
}

/**
 * Sets the loading state of the UI elements (buttons, input).
 */
export function setLoadingState(
	view: HydrateView,
	loading: boolean,
	customMessage?: string
): void {
	// Access private members via 'any' cast or make them accessible
	view.isLoading = loading;
	const textInput = view.textInput as HTMLTextAreaElement;
	const stopButton = view.stopButton as HTMLButtonElement | null;
	const loadingIndicator = view.loadingIndicator as HTMLDivElement | null;
	const chatContainer = view.chatContainer as HTMLDivElement;
	const containerEl = view.containerEl; // Public member

	// Find the actual send button (it has class 'hydrate-overlay-button' and text 'Send')
	const buttons = Array.from(
		containerEl.querySelectorAll(".hydrate-overlay-button")
	);
	let sendButton: HTMLButtonElement | null = null;

	for (const button of buttons) {
		if (
			button.textContent?.trim() === "Send" ||
			button.textContent?.trim() === "Sending..."
		) {
			sendButton = button as HTMLButtonElement;
			break;
		}
	}

	// Update send button
	if (sendButton) {
		sendButton.disabled = loading;
		sendButton.textContent = loading ? "Sending..." : "Send";
	}

	// Update text input
	if (textInput) {
		textInput.disabled = loading;
	}

	// Update stop button
	if (stopButton) {
		stopButton.style.display = loading ? "inline-block" : "none";
		stopButton.disabled = !loading;
	}

	// Show/hide loading indicator in chat
	if (loadingIndicator) {
		if (loading) {
			loadingIndicator.empty();
			loadingIndicator.style.display = "flex";
			loadingIndicator.style.alignItems = "center";
			loadingIndicator.style.justifyContent = "center";
			loadingIndicator.style.padding = "16px";
			loadingIndicator.style.color = "var(--text-muted)";
			loadingIndicator.style.fontSize = "14px";
			loadingIndicator.style.fontStyle = "italic";

			// Use custom message or default
			const message = customMessage || "Agent is thinking";

			// Create animated dots
			const loadingText = loadingIndicator.createEl("span", {
				text: message,
			});
			const dotsContainer = loadingIndicator.createEl("span", {
				cls: "hydrate-loading-dots",
				text: "...",
			});

			// Add CSS animation for the dots
			const style = document.createElement("style");
			style.textContent = `
				.hydrate-loading-dots {
					animation: hydrate-loading-blink 1.4s infinite both;
					margin-left: 4px;
				}
				@keyframes hydrate-loading-blink {
					0%, 80%, 100% { opacity: 0; }
					40% { opacity: 1; }
				}
			`;
			if (!document.head.querySelector("style[data-hydrate-loading]")) {
				style.setAttribute("data-hydrate-loading", "true");
				document.head.appendChild(style);
			}

			// Scroll to show the loading indicator
			if (chatContainer) {
				requestAnimationFrame(() => {
					chatContainer.scrollTop = chatContainer.scrollHeight;
				});
			}
		} else {
			loadingIndicator.style.display = "none";
			loadingIndicator.empty();
		}
	}
}

/**
 * Renders the file pills for attached files.
 */
export function renderFilePills(view: HydrateView): void {
	const filePillsContainer = view.filePillsContainer;
	const attachedFiles = view.attachedFiles; // Public member
	const initialFilePathFromState = view.initialFilePathFromState;
	const wasInitiallyAttached = view.wasInitiallyAttached;

	if (!filePillsContainer) {
		console.error("Hydrate DOM Utils: filePillsContainer is null!");
		return;
	}

	filePillsContainer.empty();
	if (attachedFiles.length === 0) {
		filePillsContainer.style.display = "none";
		return;
	}

	filePillsContainer.style.display = "flex";

	attachedFiles.forEach((filePath) => {
		const pill = filePillsContainer.createDiv({
			cls: "hydrate-file-pill",
		});
		const fileName = filePath.split("/").pop() || filePath;
		pill.createSpan({
			text: fileName,
			cls: "hydrate-pill-text",
		});

		const removeBtn = pill.createEl("button", {
			text: "✕",
			cls: "hydrate-pill-remove",
		});
		removeBtn.addEventListener("click", () =>
			removeEventHandlerFilePill(view, filePath)
		);
	});
}

/**
 * Renders the slash command suggestions.
 */
export function renderSuggestions(view: HydrateView): void {
	const suggestionsContainer =
		view.suggestionsContainer as HTMLDivElement | null;
	const suggestions = view.suggestions as RegistryEntry[];
	const activeSuggestionIndex = view.activeSuggestionIndex as number;

	if (!suggestionsContainer) {
		console.error("Hydrate DOM Utils: suggestionsContainer is null!");
		return;
	}

	suggestionsContainer.empty();

	if (suggestions.length === 0) {
		suggestionsContainer.style.display = "none";
		// Resetting trigger state is likely handled elsewhere (e.g., input change)
		return;
	}

	suggestionsContainer.style.display = "block";

	suggestions.forEach((entry: RegistryEntry, index: number) => {
		const itemEl = suggestionsContainer.createDiv({
			cls: "hydrate-suggestion-item p-1.5 cursor-pointer hover:bg-[var(--background-modifier-hover)] rounded-sm text-sm",
		});

		itemEl.id = `hydrate-suggestion-${index}`;

		if (index === activeSuggestionIndex) {
			itemEl.addClass("is-selected");
			itemEl.addClass("bg-[var(--background-modifier-hover)]");
		}

		const triggerEl = itemEl.createEl("strong");
		triggerEl.textContent = entry.slashCommandTrigger ?? "";
		itemEl.createSpan({
			text: `: ${entry.description || "(No description)"}`,
			cls: "text-[var(--text-muted)] ml-1",
		});

		itemEl.addEventListener("click", (e) => {
			e.stopPropagation();
			handleSuggestionSelect(view, index);
		});
	});

	if (activeSuggestionIndex !== -1) {
		const activeEl = suggestionsContainer.querySelector(
			`#hydrate-suggestion-${activeSuggestionIndex}`
		);
		activeEl?.scrollIntoView({ block: "nearest" });
	}
}

/**
 * Updates the suggestions state and re-renders the suggestions UI.
 */
export function setSuggestions(
	view: HydrateView,
	newSuggestions: RegistryEntry[]
): void {
	view.suggestions = newSuggestions;
	view.activeSuggestionIndex = -1;
	renderSuggestions(view); // Call the renderer also in this file
}

/**
 * Sets the text content of the input text area and dispatches an input event.
 */
export function setTextContent(view: HydrateView, text: string): void {
	const textInput = view.textInput as HTMLTextAreaElement;
	if (textInput) {
		textInput.value = text;
		textInput.dispatchEvent(new Event("input", { bubbles: true }));
	}
}

/**
 * Renders note search suggestions for [[ note linking.
 */
export function renderNoteSearchSuggestions(view: HydrateView): void {
	const suggestionsContainer =
		view.suggestionsContainer as HTMLDivElement | null;
	const noteSearchResults = view.noteSearchResults;
	const activeSuggestionIndex = view.activeSuggestionIndex as number;

	if (!suggestionsContainer) {
		console.error("Hydrate DOM Utils: suggestionsContainer is null!");
		return;
	}

	suggestionsContainer.empty();

	if (noteSearchResults.length === 0) {
		suggestionsContainer.style.display = "none";
		return;
	}

	suggestionsContainer.style.display = "block";

	noteSearchResults.forEach((file: any, index: number) => {
		const itemEl = suggestionsContainer.createDiv({
			cls: "hydrate-suggestion-item p-1.5 cursor-pointer hover:bg-[var(--background-modifier-hover)] rounded-sm text-sm",
		});

		itemEl.id = `hydrate-note-suggestion-${index}`;

		if (index === activeSuggestionIndex) {
			itemEl.addClass("is-selected");
			itemEl.addClass("bg-[var(--background-modifier-hover)]");
		}

		// Show file name prominently
		const nameEl = itemEl.createEl("strong");
		nameEl.textContent = file.basename || file.name;

		// Show file path if different from name
		if (file.path !== file.basename) {
			itemEl.createSpan({
				text: ` (${file.path})`,
				cls: "text-[var(--text-muted)] ml-1 text-xs",
			});
		}

		itemEl.addEventListener("click", (e) => {
			e.stopPropagation();
			selectNoteSearchResult(view, index);
		});
	});

	if (activeSuggestionIndex !== -1) {
		const activeEl = suggestionsContainer.querySelector(
			`#hydrate-note-suggestion-${activeSuggestionIndex}`
		);
		activeEl?.scrollIntoView({ block: "nearest" });
	}
}

/**
 * Selects a note from the search results and adds it to attached files.
 */
export function selectNoteSearchResult(view: HydrateView, index: number): void {
	const noteSearchResults = view.noteSearchResults;
	const noteSearchStartIndex = view.noteSearchStartIndex as number;

	if (
		index < 0 ||
		index >= noteSearchResults.length ||
		noteSearchStartIndex === -1
	) {
		setNoteSearchResults(view, []);
		return;
	}

	const selectedFile = noteSearchResults[index];
	if (!selectedFile?.path) return;

	// Add the file to attached files if not already present
	if (!view.attachedFiles.includes(selectedFile.path)) {
		view.attachedFiles.push(selectedFile.path);
		view.wasInitiallyAttached = false; // User manually added a file
		renderFilePills(view);
	}

	// Remove the [[ from the input
	const currentValue = view.textInput.value;
	const beforeTrigger = currentValue.substring(0, noteSearchStartIndex);
	const afterCursor = currentValue.substring(
		view.textInput.selectionStart || 0
	);

	const newValue = beforeTrigger + afterCursor;
	setTextContent(view, newValue);

	// Clear note search state
	setNoteSearchResults(view, []);

	// Position cursor
	const newCursorPos = beforeTrigger.length;
	view.textInput.focus();
	requestAnimationFrame(() => {
		view.textInput.setSelectionRange(newCursorPos, newCursorPos);
	});
}

/**
 * Updates the note search results and re-renders the suggestions UI.
 */
export function setNoteSearchResults(view: HydrateView, results: any[]): void {
	view.noteSearchResults = results;
	view.activeSuggestionIndex = -1;
	view.noteSearchActive = results.length > 0;

	if (results.length > 0) {
		renderNoteSearchSuggestions(view);
	} else {
		// Hide suggestions container
		const suggestionsContainer =
			view.suggestionsContainer as HTMLDivElement | null;
		if (suggestionsContainer) {
			suggestionsContainer.style.display = "none";
		}
	}
}
