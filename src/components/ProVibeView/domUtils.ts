import { MarkdownRenderer } from "obsidian";
import { ProVibeView } from "../../../proVibeView"; // Adjust path relative to this file
import { RegistryEntry } from "../../../src/types"; // Adjust path relative to this file
import { removeFilePill as removeEventHandlerFilePill } from "./eventHandlers"; // Import the handler

/**
 * Adds a message to the chat container with appropriate styling.
 */
export function addMessageToChat(
	view: ProVibeView,
	role: "user" | "agent" | "system",
	content: string | HTMLElement,
	isError: boolean = false
): void {
	const chatContainer = (view as any).chatContainer as HTMLDivElement; // Access private member
	const plugin = (view as any).plugin; // Access private member

	if (!chatContainer) {
		console.error("ProVibe DOM Utils: chatContainer is null!");
		return;
	}

	const messageClasses = [
		"provibe-message",
		`provibe-${role}-message`,
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
			"provibe-error-message",
			"bg-[var(--background-modifier-error)]",
			"text-[var(--text-error)]"
		);
	}

	const messageEl = chatContainer.createDiv({
		cls: messageClasses.join(" "),
	});

	if (content instanceof HTMLElement) {
		messageEl.appendChild(content);
	} else if (role === "agent") {
		try {
			MarkdownRenderer.render(plugin.app, content, messageEl, "", plugin);
		} catch (renderError) {
			console.error("Markdown rendering error:", renderError);
			messageEl.setText(`(Error rendering message) ${content}`);
		}
	} else if (role === "user") {
		const registeredEntries = plugin.getRegistryEntries();
		const registeredCommands = registeredEntries
			.map((e: RegistryEntry) => e.slashCommandTrigger)
			.filter((t: string | undefined): t is string => !!t);

		if (registeredCommands.length > 0) {
			const escapedCommands = registeredCommands.map((cmd: string) =>
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
				strongEl.addClass("provibe-slash-command-display");
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
}

/**
 * Sets the loading state of the UI elements (buttons, input).
 */
export function setLoadingState(view: ProVibeView, loading: boolean): void {
	// Access private members via 'any' cast or make them accessible
	(view as any).isLoading = loading;
	const textInput = (view as any).textInput as HTMLTextAreaElement;
	const stopButton = (view as any).stopButton as HTMLButtonElement | null;
	const containerEl = view.containerEl; // Public member

	const sendButton = containerEl.querySelector(
		".provibe-send-button"
	) as HTMLButtonElement;

	if (sendButton) {
		sendButton.disabled = loading;
		sendButton.textContent = loading ? "Sending..." : "Send";
	}
	if (textInput) {
		textInput.disabled = loading;
	}
	if (stopButton) {
		stopButton.style.display = loading ? "inline-block" : "none";
		stopButton.disabled = !loading;
	}
}

/**
 * Renders the file pills for attached files.
 */
export function renderFilePills(view: ProVibeView): void {
	const filePillsContainer = view.filePillsContainer;
	const attachedFiles = view.attachedFiles; // Public member
	const initialFilePathFromState = view.initialFilePathFromState;
	const wasInitiallyAttached = view.wasInitiallyAttached;

	if (!filePillsContainer) {
		console.error("ProVibe DOM Utils: filePillsContainer is null!");
		return;
	}

	console.log(
		"ProVibe DOM Utils: renderFilePills called. Attached files:",
		attachedFiles,
		"wasInitiallyAttached:",
		wasInitiallyAttached,
		"initialFilePath:",
		initialFilePathFromState
	);

	filePillsContainer.empty();
	if (attachedFiles.length === 0) {
		filePillsContainer.style.display = "none";
		return;
	}

	filePillsContainer.style.display = "flex";

	attachedFiles.forEach((filePath) => {
		const pill = filePillsContainer.createDiv({
			cls: "provibe-file-pill flex items-center !px-1.5 !py-0 bg-[var(--background-modifier-border)] rounded-md text-xs text-[var(--text-muted)]",
		});
		const fileName = filePath.split("/").pop() || filePath;
		pill.createSpan({
			text: fileName,
			cls: "provibe-pill-text leading-none",
		});

		const removeBtn = pill.createEl("button", {
			text: "✕",
			cls: "provibe-pill-remove ml-1 !p-0 !border-none !bg-transparent !appearance-none text-[var(--text-muted)] hover:text-[var(--text-normal)] cursor-pointer text-xs",
		});
		removeBtn.style.height = "auto";
		removeBtn.style.minHeight = "unset";
		removeBtn.style.boxShadow = "none";
		removeBtn.addEventListener("click", () =>
			removeEventHandlerFilePill(view, filePath)
		);
	});
}

/**
 * Renders the slash command suggestions.
 */
export function renderSuggestions(view: ProVibeView): void {
	const suggestionsContainer = (view as any)
		.suggestionsContainer as HTMLDivElement | null;
	const suggestions = (view as any).suggestions as RegistryEntry[];
	const activeSuggestionIndex = (view as any).activeSuggestionIndex as number;
	const handleSuggestionSelect = (view as any).handleSuggestionSelect.bind(
		view
	); // Bind context

	if (!suggestionsContainer) {
		console.error("ProVibe DOM Utils: suggestionsContainer is null!");
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
			cls: "provibe-suggestion-item p-1.5 cursor-pointer hover:bg-[var(--background-modifier-hover)] rounded-sm text-sm",
		});

		itemEl.id = `provibe-suggestion-${index}`;

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
			handleSuggestionSelect(index);
		});
	});

	if (activeSuggestionIndex !== -1) {
		const activeEl = suggestionsContainer.querySelector(
			`#provibe-suggestion-${activeSuggestionIndex}`
		);
		activeEl?.scrollIntoView({ block: "nearest" });
	}
}

/**
 * Updates the suggestions state and re-renders the suggestions UI.
 */
export function setSuggestions(
	view: ProVibeView,
	newSuggestions: RegistryEntry[]
): void {
	(view as any).suggestions = newSuggestions;
	(view as any).activeSuggestionIndex = -1;
	renderSuggestions(view); // Call the renderer also in this file
}

/**
 * Sets the text content of the input text area and dispatches an input event.
 */
export function setTextContent(view: ProVibeView, text: string): void {
	const textInput = (view as any).textInput as HTMLTextAreaElement;
	if (textInput) {
		textInput.value = text;
		textInput.dispatchEvent(new Event("input", { bubbles: true }));
	}
}
