import { MarkdownRenderer, Notice, setIcon, TFile } from "obsidian";
import { devLog } from "../../utils/logger";
import { createThrottle } from "../../utils/throttle";
import { HydrateView } from "./hydrateView"; // Corrected path
import { RegistryEntry, ChatTurn, ChatImage, isStoredImage } from "../../types"; // Corrected path (up two levels from components/HydrateView)
import { getImageDataUrl } from "./imageUtils";
import {
	removeFilePill as removeEventHandlerFilePill,
	handleSuggestionSelect,
} from "./eventHandlers"; // Import the handler

/**
 * Content block from Gemini's response when include_thoughts=True
 */
interface GeminiContentBlock {
	type: "thinking" | "text";
	thinking?: string;
	text?: string;
}

/**
 * Processes agent message content which may be a string or Gemini's list-of-blocks format.
 * Returns an object with thinking (optional) and text content.
 */
export function parseAgentContent(
	content: string | GeminiContentBlock[] | unknown
): { thinking: string | null; text: string } {
	// Simple string content
	if (typeof content === "string") {
		return { thinking: null, text: content };
	}

	// Gemini's list-of-blocks format
	if (Array.isArray(content)) {
		let thinking: string | null = null;
		const textParts: string[] = [];

		for (const block of content) {
			if (typeof block === "string") {
				textParts.push(block);
			} else if (block && typeof block === "object") {
				const typedBlock = block as GeminiContentBlock;
				if (typedBlock.type === "thinking" && typedBlock.thinking) {
					thinking = typedBlock.thinking;
				} else if (typedBlock.type === "text" && typedBlock.text) {
					textParts.push(typedBlock.text);
				}
			}
		}

		return { thinking, text: textParts.join("\n") };
	}

	// Fallback
	return { thinking: null, text: String(content || "") };
}

/**
 * Adds a message to the chat container with appropriate styling.
 * @param rawTextForCopy - Optional raw markdown text for copy button when content is HTMLElement
 */
export function addMessageToChat(
	view: HydrateView,
	role: "user" | "agent" | "system",
	content: string | HTMLElement,
	isError: boolean = false,
	rawTextForCopy?: string,
	images?: ChatImage[],
): void {
	const chatContainer = view.chatContainer; // Access private member
	const plugin = view.plugin; // Access private member

	if (!chatContainer) {
		devLog.error("Hydrate DOM Utils: chatContainer is null!");
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
			"text-[var(--text-on-accent)]",
		);
	} else if (role === "agent") {
		messageClasses.push("mr-auto", "bg-[var(--background-secondary)]");
	} else {
		messageClasses.push(
			"mx-auto",
			"text-xs",
			"text-[var(--text-muted)]",
			"italic",
			"text-center",
		);
	}

	if (isError) {
		messageClasses.push(
			"hydrate-error-message",
			"text-[var(--text-error)]",
		);
	}

	const messageEl = chatContainer.createDiv({
		cls: messageClasses.join(" "),
	});

	// Make agent messages relative for absolute positioning of the copy button
	if (role === "agent") {
		messageEl.addClass("hydrate-message-agent");
	}

	// Render images if present
	if (images && images.length > 0) {
		const imagesContainer = messageEl.createDiv({
			cls: "hydrate-message-images",
		});
		imagesContainer.style.cssText = `
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			margin-bottom: 8px;
		`;

		images.forEach((img) => {
			const imgEl = document.createElement("img");
			imgEl.style.cssText = `
				max-width: 200px;
				max-height: 200px;
				min-width: 60px;
				min-height: 60px;
				border-radius: 4px;
				border: 1px solid var(--background-modifier-border);
				background: var(--background-secondary);
			`;

			// Handle both base64 and vault-stored images
			if (isStoredImage(img)) {
				// Load async from vault
				devLog.debug("Loading stored image from vault:", img.vaultPath);
				imgEl.alt = "Loading...";
				getImageDataUrl(plugin.app, img)
					.then((dataUrl) => {
						devLog.debug("Image loaded successfully, length:", dataUrl.length);
						imgEl.src = dataUrl;
						imgEl.alt = "";
					})
					.catch((error) => {
						devLog.error("Failed to load image from vault:", error);
						imgEl.alt = "Image not found";
					});
			} else {
				// Direct base64
				devLog.debug("Using base64 image, data length:", img.data?.length);
				imgEl.src = `data:${img.mimeType};base64,${img.data}`;
			}

			imagesContainer.appendChild(imgEl);
		});
	}

	if (content instanceof HTMLElement) {
		messageEl.appendChild(content);
		// Add copy button for agent messages with pre-rendered HTML
		if (role === "agent" && rawTextForCopy) {
			const copyButton = messageEl.createEl("button", {
				cls: "hydrate-copy-button absolute bottom-1 right-1 p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] transition-colors duration-150",
				attr: { "aria-label": "Copy message" },
			});
			setIcon(copyButton, "copy");
			copyButton.children[0]?.setAttribute("width", "14");
			copyButton.children[0]?.setAttribute("height", "14");

			copyButton.addEventListener("click", (e) => {
				e.stopPropagation();
				void (async () => {
					try {
						await navigator.clipboard.writeText(rawTextForCopy);
						setIcon(copyButton, "check");
						copyButton.children[0]?.setAttribute("width", "14");
						copyButton.children[0]?.setAttribute("height", "14");
						setTimeout(() => {
							setIcon(copyButton, "copy");
							copyButton.children[0]?.setAttribute("width", "14");
							copyButton.children[0]?.setAttribute("height", "14");
						}, 1500);
					} catch (err) {
						devLog.error("Failed to copy text: ", err);
						new Notice("Failed to copy message.");
					}
				})();
			});
		}
	} else if (role === "agent") {
		const originalContentString = content; // Store original string for copying
		try {
			// Render markdown first
			void MarkdownRenderer.render(
				plugin.app,
				content,
				messageEl,
				"",
				view,
			);

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

			copyButton.addEventListener("click", (e) => {
				e.stopPropagation(); // Prevent event bubbling
				void (async () => {
					try {
						await navigator.clipboard.writeText(
							originalContentString,
						);
						// Show success feedback by changing the icon
						setIcon(copyButton, "check");
						copyButton.children[0]?.setAttribute("width", "14");
						copyButton.children[0]?.setAttribute("height", "14");

						setTimeout(() => {
							// Revert back to copy icon
							setIcon(copyButton, "copy");
							copyButton.children[0]?.setAttribute("width", "14");
							copyButton.children[0]?.setAttribute(
								"height",
								"14",
							);
						}, 1500); // Revert after 1.5 seconds
					} catch (err) {
						devLog.error("Failed to copy text: ", err);
						new Notice("Failed to copy message.");
					}
				})();
			});
		} catch (renderError) {
			devLog.error("Markdown rendering error:", renderError);
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
				cmd.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"),
			);
			const commandRegex = new RegExp(
				`(${escapedCommands.join("|")})(?=\\s|$)`,
				"g",
			);

			let lastIndex = 0;
			let match;
			const fragment = document.createDocumentFragment();

			while ((match = commandRegex.exec(content)) !== null) {
				if (match.index > lastIndex) {
					fragment.appendChild(
						document.createTextNode(
							content.substring(lastIndex, match.index),
						),
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
					document.createTextNode(content.substring(lastIndex)),
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
		const chatTurn: ChatTurn = {
			role: role,
			content: content,
			images: images,
			timestamp: new Date().toISOString(),
		};
		// Only add to history if we're not currently restoring from history
		if (!view.isRestoringFromHistory) {
			view.currentChatTurns.push(chatTurn);

			// Refresh context suggestions after new messages (but not for system messages)
			if (role === "user" || role === "agent") {
				// Use setTimeout to avoid blocking the UI
				setTimeout(() => {
					void view.refreshContextSuggestions?.();
				}, 1000);
			}
		}
	}
}

/**
 * Creates an empty agent message bubble (same DOM structure/classes as
 * `addMessageToChat` uses for role "agent") and returns handles to stream
 * content into it as tokens arrive.
 *
 * `update()` re-renders markdown into the cleared element, trailing-edge
 * throttled (via `createThrottle`, see src/utils/throttle.ts + its tests) to
 * at most once every 100ms so a fast token stream doesn't thrash markdown
 * rendering. `finalize()` cancels any pending throttled render, does one
 * last full render from the authoritative final text, adds the copy button,
 * and pushes the ChatTurn bookkeeping exactly once - mirroring the tail of
 * `addMessageToChat` for agent messages.
 *
 * The bubble is TRANSIENT until `finalize()` commits it: any other outcome
 * (mid-stream error, or a `done` that turns out to carry
 * `tool_calls_prepared`) must call `teardown()` instead, which cancels the
 * pending throttled render and removes the element without ever pushing a
 * ChatTurn - matching the non-streaming path, where a failed or tool-call
 * turn never leaves a partial agent message in the chat or in history.
 * `finalize()` and `teardown()` share the same `finalized` guard, so calling
 * either after the other (or calling either twice) is a safe no-op.
 *
 * Not unit tested directly: this function (like `addMessageToChat`, which
 * it mirrors) builds DOM via Obsidian's HTMLElement prototype extensions
 * (createDiv/createEl/empty/addClass) and calls MarkdownRenderer.render /
 * setIcon, none of which are polyfilled under this project's vitest+jsdom
 * setup - and importing this module transitively pulls in eventHandlers.ts
 * -> NoteSearchModal.ts, which extends Obsidian's FuzzySuggestModal, so even
 * importing it in a test file crashes at module-evaluation time. The pure,
 * DOM-free throttling logic is extracted into throttle.ts specifically so
 * it can be tested in isolation; see throttle.test.ts.
 */
export function createStreamingAgentMessage(view: HydrateView): {
	el: HTMLElement;
	update(text: string): void;
	updateThinking(text: string): void;
	finalize(finalText: string): void;
	teardown(): void;
} {
	const chatContainer = view.chatContainer;
	const plugin = view.plugin;

	const messageClasses = [
		"hydrate-message",
		"hydrate-agent-message",
		"p-2",
		"rounded-md",
		"max-w-[90%]",
		"mb-2",
		"select-text",
		"break-words",
		"whitespace-pre-wrap",
		"mr-auto",
		"bg-[var(--background-secondary)]",
	];

	const el = chatContainer.createDiv({ cls: messageClasses.join(" ") });
	el.addClass("hydrate-message-agent");

	// Answer markdown renders into its own child div so live thinking (a
	// sibling section above it) survives each throttled text re-render.
	const textDiv = el.createDiv();

	// Live thinking section, created lazily on the first thinking delta.
	// Same classes as the finished collapsible in the addAgentMessage hook,
	// but open while streaming so the reasoning is visible as it happens;
	// the finalize/teardown outcome replaces it with the normal collapsed
	// rendering.
	let thinkingContent: HTMLElement | null = null;

	const scrollToBottom = () => {
		requestAnimationFrame(() => {
			chatContainer.scrollTop = chatContainer.scrollHeight;
		});
	};

	const renderMarkdown = (text: string) => {
		textDiv.empty();
		void MarkdownRenderer.render(plugin.app, text, textDiv, "", view);
		scrollToBottom();
	};

	const renderThinking = (text: string) => {
		if (!thinkingContent) {
			const details = document.createElement("details");
			details.className = "hydrate-thinking-section";
			details.open = true;
			const summary = document.createElement("summary");
			summary.className = "hydrate-thinking-summary";
			summary.textContent = "Model thinking...";
			details.appendChild(summary);
			thinkingContent = document.createElement("div");
			thinkingContent.className = "hydrate-thinking-content";
			details.appendChild(thinkingContent);
			el.insertBefore(details, textDiv);
		}
		thinkingContent.textContent = text;
		scrollToBottom();
	};

	const throttledRender = createThrottle(renderMarkdown, 100);
	const throttledThinking = createThrottle(renderThinking, 100);

	let finalized = false;

	const update = (text: string) => {
		if (finalized) return;
		throttledRender(text);
	};

	const updateThinking = (text: string) => {
		if (finalized) return;
		throttledThinking(text);
	};

	const finalize = (finalText: string) => {
		if (finalized) return;
		finalized = true;
		throttledRender.cancel();
		throttledThinking.cancel();

		el.empty();
		void MarkdownRenderer.render(plugin.app, finalText, el, "", view);

		const copyButton = el.createEl("button", {
			cls: "hydrate-copy-button absolute bottom-1 right-1 p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] transition-colors duration-150",
			attr: { "aria-label": "Copy message" },
		});
		setIcon(copyButton, "copy");
		copyButton.children[0]?.setAttribute("width", "14");
		copyButton.children[0]?.setAttribute("height", "14");

		copyButton.addEventListener("click", (e) => {
			e.stopPropagation();
			void (async () => {
				try {
					await navigator.clipboard.writeText(finalText);
					setIcon(copyButton, "check");
					copyButton.children[0]?.setAttribute("width", "14");
					copyButton.children[0]?.setAttribute("height", "14");
					setTimeout(() => {
						setIcon(copyButton, "copy");
						copyButton.children[0]?.setAttribute("width", "14");
						copyButton.children[0]?.setAttribute("height", "14");
					}, 1500);
				} catch (err) {
					devLog.error("Failed to copy text: ", err);
					new Notice("Failed to copy message.");
				}
			})();
		});

		scrollToBottom();

		// Mirrors addMessageToChat's tail bookkeeping for agent messages:
		// track the turn (unless restoring from history) and refresh
		// suggestions. This is the ONLY place that pushes the ChatTurn for a
		// streamed message - callers must not also route it through
		// addMessageToChat.
		if (!view.isRestoringFromHistory) {
			const chatTurn: ChatTurn = {
				role: "agent",
				content: finalText,
				timestamp: new Date().toISOString(),
			};
			view.currentChatTurns.push(chatTurn);

			setTimeout(() => {
				void view.refreshContextSuggestions?.();
			}, 1000);
		}
	};

	// Tears down a bubble that will never be finalized (mid-stream error, or
	// a `done` whose tool_calls_prepared preempts the streamed text): cancels
	// the pending throttled render and removes the element. Never pushes a
	// ChatTurn. Shares the `finalized` guard with `finalize()` so this is
	// idempotent and safe to call after finalize() already ran (a no-op).
	const teardown = () => {
		if (finalized) return;
		finalized = true;
		throttledRender.cancel();
		throttledThinking.cancel();
		el.remove();
	};

	return { el, update, updateThinking, finalize, teardown };
}

/**
 * Sets the loading state of the UI elements (buttons, input).
 */
export function setLoadingState(
	view: HydrateView,
	loading: boolean,
	customMessage?: string,
): void {
	// Access private members via 'any' cast or make them accessible
	view.isLoading = loading;
	const textInput = view.textInput;
	const stopButton = view.stopButton;
	const loadingIndicator = view.loadingIndicator;
	const chatContainer = view.chatContainer;
	const containerEl = view.containerEl; // Public member

	// Find the actual send button (it has class 'hydrate-overlay-button' and text 'Send')
	const buttons = Array.from(
		containerEl.querySelectorAll(".hydrate-overlay-button"),
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
		if (loading) {
			stopButton.removeClass("hydrate-stop-button-default");
			stopButton.removeClass("hydrate-stop-button-hidden");
			stopButton.addClass("hydrate-stop-button-visible");
		} else {
			stopButton.removeClass("hydrate-stop-button-visible");
			stopButton.addClass("hydrate-stop-button-hidden");
		}
		stopButton.disabled = !loading;
	}

	// Show/hide loading indicator in chat
	if (loadingIndicator) {
		if (loading) {
			loadingIndicator.empty();
			loadingIndicator.addClass("hydrate-loading-indicator");
			loadingIndicator.removeClass("hydrate-loading-indicator-hidden");

			// Use custom message or default
			const message = customMessage || "Agent is thinking";

			// Create animated dots
			loadingIndicator.createEl("span", {
				text: message,
			});
			loadingIndicator.createEl("span", {
				cls: "hydrate-loading-dots",
				text: "...",
			});

			// CSS animation is now defined in hydrate-styles.css

			// Scroll to show the loading indicator
			if (chatContainer) {
				requestAnimationFrame(() => {
					chatContainer.scrollTop = chatContainer.scrollHeight;
				});
			}
		} else {
			loadingIndicator.addClass("hydrate-loading-indicator-hidden");
			loadingIndicator.removeClass("hydrate-loading-indicator");
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

	if (!filePillsContainer) {
		devLog.error("Hydrate DOM Utils: filePillsContainer is null!");
		return;
	}

	filePillsContainer.empty();
	if (attachedFiles.length === 0) {
		filePillsContainer.addClass("hydrate-file-pills-hidden");
		filePillsContainer.removeClass("hydrate-file-pills-visible");
		return;
	}

	filePillsContainer.addClass("hydrate-file-pills-visible");
	filePillsContainer.removeClass("hydrate-file-pills-hidden");

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
			removeEventHandlerFilePill(view, filePath),
		);
	});
}

/**
 * Renders image preview thumbnails in the input area.
 */
export const renderImagePreviews = (view: HydrateView): void => {
	const containerEl = view.containerEl;

	// Find or create image previews container
	let imagePreviews = containerEl.querySelector(".hydrate-image-previews") as HTMLDivElement;
	if (!imagePreviews) {
		const inputSection = containerEl.querySelector(".hydrate-input-section");
		if (!inputSection) return;

		imagePreviews = document.createElement("div");
		imagePreviews.className = "hydrate-image-previews";
		imagePreviews.style.cssText = `
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			padding: 8px;
			border-bottom: 1px solid var(--background-modifier-border);
		`;
		inputSection.insertBefore(imagePreviews, inputSection.firstChild);
	}

	// Clear existing previews
	imagePreviews.innerHTML = "";

	// Hide if no images
	if (view.attachedImages.length === 0) {
		imagePreviews.style.display = "none";
		return;
	}

	imagePreviews.style.display = "flex";

	// Create preview for each image
	view.attachedImages.forEach((img, index) => {
		const preview = document.createElement("div");
		preview.className = "hydrate-image-preview";
		preview.style.cssText = `
			position: relative;
			width: 60px;
			height: 60px;
			border-radius: 4px;
			overflow: hidden;
			border: 1px solid var(--background-modifier-border);
		`;

		const imgEl = document.createElement("img");
		imgEl.src = `data:${img.mimeType};base64,${img.data}`;
		imgEl.style.cssText = `
			width: 100%;
			height: 100%;
			object-fit: cover;
		`;
		imgEl.alt = img.filename || `Image ${index + 1}`;

		const removeBtn = document.createElement("button");
		removeBtn.className = "hydrate-image-remove";
		removeBtn.innerHTML = "×";
		removeBtn.style.cssText = `
			position: absolute;
			top: 2px;
			right: 2px;
			width: 18px;
			height: 18px;
			border-radius: 50%;
			border: none;
			background: var(--background-modifier-error);
			color: white;
			cursor: pointer;
			font-size: 12px;
			line-height: 1;
			display: flex;
			align-items: center;
			justify-content: center;
		`;
		removeBtn.onclick = (e) => {
			e.stopPropagation();
			view.attachedImages.splice(index, 1);
			renderImagePreviews(view);
		};

		preview.appendChild(imgEl);
		preview.appendChild(removeBtn);
		imagePreviews.appendChild(preview);
	});
};

/**
 * Renders the slash command suggestions.
 */
export function renderSuggestions(view: HydrateView): void {
	const suggestionsContainer = view.suggestionsContainer;
	const suggestions = view.suggestions;
	const activeSuggestionIndex = view.activeSuggestionIndex;

	if (!suggestionsContainer) {
		devLog.error("Hydrate DOM Utils: suggestionsContainer is null!");
		return;
	}

	suggestionsContainer.empty();

	if (suggestions.length === 0) {
		suggestionsContainer.addClass("hydrate-suggestions-hidden");
		suggestionsContainer.removeClass("hydrate-suggestions-visible");
		// Resetting trigger state is likely handled elsewhere (e.g., input change)
		return;
	}

	suggestionsContainer.addClass("hydrate-suggestions-visible");
	suggestionsContainer.removeClass("hydrate-suggestions-hidden");

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
			`#hydrate-suggestion-${activeSuggestionIndex}`,
		);
		activeEl?.scrollIntoView({ block: "nearest" });
	}
}

/**
 * Updates the suggestions state and re-renders the suggestions UI.
 */
export function setSuggestions(
	view: HydrateView,
	newSuggestions: RegistryEntry[],
): void {
	view.suggestions = newSuggestions;
	view.activeSuggestionIndex = -1;
	renderSuggestions(view); // Call the renderer also in this file
}

/**
 * Sets the text content of the input text area and dispatches an input event.
 */
export function setTextContent(view: HydrateView, text: string): void {
	const textInput = view.textInput;
	if (textInput) {
		textInput.value = text;
		textInput.dispatchEvent(new Event("input", { bubbles: true }));
	}
}

/**
 * Renders note search suggestions for [[ note linking.
 */
export function renderNoteSearchSuggestions(view: HydrateView): void {
	const suggestionsContainer = view.suggestionsContainer;
	const noteSearchResults = view.noteSearchResults;
	const activeSuggestionIndex = view.activeSuggestionIndex;

	if (!suggestionsContainer) {
		devLog.error("Hydrate DOM Utils: suggestionsContainer is null!");
		return;
	}

	suggestionsContainer.empty();

	if (noteSearchResults.length === 0) {
		suggestionsContainer.addClass("hydrate-suggestions-hidden");
		suggestionsContainer.removeClass("hydrate-suggestions-visible");
		return;
	}

	suggestionsContainer.addClass("hydrate-suggestions-visible");
	suggestionsContainer.removeClass("hydrate-suggestions-hidden");

	noteSearchResults.forEach((file: TFile, index: number) => {
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
			`#hydrate-note-suggestion-${activeSuggestionIndex}`,
		);
		activeEl?.scrollIntoView({ block: "nearest" });
	}
}

/**
 * Selects a note from the search results and adds it to attached files.
 */
export function selectNoteSearchResult(view: HydrateView, index: number): void {
	const noteSearchResults = view.noteSearchResults;
	const noteSearchStartIndex = view.noteSearchStartIndex;

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
		view.textInput.selectionStart || 0,
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
export function setNoteSearchResults(
	view: HydrateView,
	results: TFile[],
): void {
	view.noteSearchResults = results;
	view.activeSuggestionIndex = -1;
	view.noteSearchActive = results.length > 0;

	if (results.length > 0) {
		renderNoteSearchSuggestions(view);
	} else {
		// Hide suggestions container
		const suggestionsContainer = view.suggestionsContainer;
		if (suggestionsContainer) {
			suggestionsContainer.addClass("hydrate-suggestions-hidden");
			suggestionsContainer.removeClass("hydrate-suggestions-visible");
		}
	}
}
