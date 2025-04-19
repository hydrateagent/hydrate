import {
	ItemView,
	WorkspaceLeaf,
	requestUrl,
	Notice,
	TFile,
	Editor,
	parseYaml,
	MarkdownRenderer,
	ViewStateResult,
	sanitizeHTMLToDom,
} from "obsidian";
import ProVibePlugin from "./main"; // Import the plugin class to access settings
import { DiffReviewModal, DiffReviewResult } from "./DiffReviewModal"; // Import the new modal
import { ReactViewHost } from "./src/ReactViewHost"; // <<< ADD THIS IMPORT
import { RegistryEntry } from "./src/types"; // <<< Import RegistryEntry type

export const PROVIBE_VIEW_TYPE = "provibe-view";

// Define interfaces for communication with the backend
interface HistoryMessage {
	type: "human" | "ai" | "tool" | "system"; // Langchain types
	content: string;
	// Optional fields from Langchain messages
	tool_calls?: { id: string; name: string; args: any }[];
	tool_call_id?: string;
}

interface ChatMessage {
	role: "user" | "agent";
	content: string;
}

interface BackendToolCall {
	action: "tool_call";
	tool: string;
	params: any;
	id: string; // Tool call ID from the agent
}

interface BackendResponse {
	agent_message?: HistoryMessage; // Now receives the full agent message
	// Can now receive multiple tool calls
	tool_calls?: BackendToolCall[];
	conversation_id: string; // ID is always returned
}

// Interface for storing tool results with their IDs
interface ToolResult {
	id: string;
	result: any;
}

export class ProVibeView extends ItemView {
	private plugin: ProVibePlugin; // Store reference to the plugin
	private textInput: HTMLTextAreaElement;
	private chatContainer: HTMLDivElement; // Container for chat messages
	private filePillsContainer: HTMLDivElement; // Container for file pills
	private attachedFiles: string[] = []; // Store paths of attached files
	private isLoading: boolean = false; // Flag to prevent multiple submissions
	private conversationId: string | null = null; // Add state for conversation ID
	private stopButton: HTMLButtonElement | null = null; // Added reference for stop button
	private initialFilePathFromState: string | null = null; // <<< ADDED: Store path from state

	// --- Slash Command State ---
	private suggestions: RegistryEntry[] = [];
	private activeSuggestionIndex: number = -1;
	private suggestionsContainer: HTMLDivElement | null = null;
	private currentTrigger: string | null = null; // Store the trigger being suggested for
	private triggerStartIndex: number = -1; // Store start index of the current trigger
	// --- End Slash Command State ---

	constructor(leaf: WorkspaceLeaf, plugin: ProVibePlugin) {
		super(leaf);
		this.plugin = plugin; // Save plugin reference
	}

	getViewType(): string {
		return PROVIBE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "ProVibe";
	}

	// <<< ADDED: setState method to capture initialFilePath >>>
	async setState(state: any, result: ViewStateResult): Promise<void> {
		console.log("ProVibeView setState called with state:", state);
		if (state?.sourceFilePath) {
			this.initialFilePathFromState = state.sourceFilePath;
			console.log(
				"ProVibeView setState: Captured sourceFilePath:",
				this.initialFilePathFromState
			);

			// <<< MOVED: Auto-attach logic now runs here >>>
			console.log(
				"ProVibe [setState]: Attempting to auto-attach file using path from state."
			);
			console.log(
				"ProVibe [setState]: Current attachedFiles BEFORE attach:",
				[...this.attachedFiles]
			);

			const fileToAttachPath = this.initialFilePathFromState; // Already set

			console.log(
				"ProVibe [setState]: File path to check for attachment:",
				fileToAttachPath
			);

			if (fileToAttachPath) {
				if (!this.attachedFiles.includes(fileToAttachPath)) {
					// Verify the file actually exists in the vault before adding
					const fileExists =
						this.app.vault.getAbstractFileByPath(
							fileToAttachPath
						) instanceof TFile;
					if (fileExists) {
						console.log(
							`ProVibe [setState]: Attaching ${fileToAttachPath}...`
						);
						this.attachedFiles.push(fileToAttachPath);
						console.log(
							"ProVibe [setState]: attachedFiles after push:",
							[...this.attachedFiles]
						);
						// Render pills immediately after attach (if view is already open)
						if (this.filePillsContainer) {
							this.renderFilePills();
						}
					} else {
						console.warn(
							`ProVibe [setState]: File path from state '${fileToAttachPath}' does not exist or is not a TFile. Not attaching.`
						);
					}
				} else {
					console.log(
						`ProVibe [setState]: File ${fileToAttachPath} already attached.`
					);
				}
			} else {
				// This case is less likely now as we only run this logic if sourceFilePath exists
				console.log(
					"ProVibe [setState]: File path variable was unexpectedly null/empty."
				);
			}
			// <<< END MOVED >>>
		} else {
			console.log(
				"ProVibeView setState: No sourceFilePath found in state."
			);
		}
		await super.setState(state, result);
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClasses([
			"provibe-view-container",
			"p-3",
			"flex",
			"flex-col",
			"h-full",
		]);

		this.chatContainer = container.createEl("div", {
			cls: "provibe-chat-container flex-grow overflow-y-auto p-2 space-y-3",
		});

		const inputAreaContainer = container.createEl("div", {
			cls: "provibe-input-area-container relative pt-3 border-t border-[var(--background-modifier-border)] mb-4",
		});

		this.suggestionsContainer = inputAreaContainer.createEl("div", {
			cls: "provibe-suggestions-container absolute bottom-full left-0 right-0 mb-1 p-1 bg-[var(--background-secondary)] border border-[var(--background-modifier-border)] rounded-md shadow-lg z-10 hidden max-h-40 overflow-y-auto",
		});

		this.filePillsContainer = inputAreaContainer.createEl("div", {
			cls: "provibe-file-pills-container flex flex-wrap gap-1 pb-2",
		});

		const inputControlsArea = inputAreaContainer.createEl("div", {
			cls: "provibe-input-controls-area flex items-end gap-2",
		});

		this.textInput = inputControlsArea.createEl("textarea", {
			cls: "provibe-textarea flex-grow p-2 border border-[var(--background-modifier-border)] rounded-md bg-[var(--background-primary)] text-[var(--text-normal)] focus:border-[var(--interactive-accent)] focus:outline-none resize-none",
			attr: {
				placeholder:
					"Enter your prompt, drop files, or type / for commands...",
				rows: "3",
			},
		});

		// Auto-Resizing Logic
		const adjustTextareaHeight = () => {
			const minRows = 3;
			const maxRows = 10;
			this.textInput.style.height = "auto";
			const scrollHeight = this.textInput.scrollHeight;
			const computedStyle = getComputedStyle(this.textInput);
			const lineHeight = parseFloat(computedStyle.lineHeight) || 18;
			const padding =
				parseFloat(computedStyle.paddingTop) +
				parseFloat(computedStyle.paddingBottom);
			const border =
				parseFloat(computedStyle.borderTopWidth) +
				parseFloat(computedStyle.borderBottomWidth);
			const minHeight = lineHeight * minRows + padding + border;
			const maxHeight = lineHeight * maxRows + padding + border;
			const targetHeight = Math.max(
				minHeight,
				Math.min(maxHeight, scrollHeight)
			);
			this.textInput.style.height = `${targetHeight}px`;
			this.textInput.style.overflowY =
				scrollHeight > maxHeight ? "auto" : "hidden";
		};
		this.textInput.addEventListener("input", adjustTextareaHeight);
		setTimeout(adjustTextareaHeight, 0);

		// Buttons
		const buttonContainer = inputControlsArea.createEl("div", {
			cls: "provibe-button-container flex flex-col gap-1 flex-shrink-0",
		});
		const clearButton = buttonContainer.createEl("button", {
			text: "Clear",
			cls: "provibe-button provibe-clear-button px-3 py-1.5 rounded-md bg-[var(--background-modifier-border)] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] transition-colors duration-150",
		});
		const sendButton = buttonContainer.createEl("button", {
			text: "Send",
			cls: "provibe-button provibe-send-button px-3 py-1.5 rounded-md bg-[var(--interactive-accent)] text-[var(--text-on-accent)] hover:bg-[var(--interactive-accent-hover)] transition-colors duration-150",
		});
		this.stopButton = buttonContainer.createEl("button", {
			text: "Stop",
			cls: "provibe-button provibe-stop-button px-3 py-1.5 rounded-md bg-red-700 text-white hover:bg-red-600 transition-colors duration-150",
		});
		this.stopButton.style.display = "none";

		// Event Listeners
		clearButton.addEventListener("click", this.handleClear);
		sendButton.addEventListener("click", this.handleSend);
		this.stopButton.addEventListener("click", this.handleStop);

		// Input Event Listeners
		this.textInput.addEventListener("input", this.handleInputChange);
		this.textInput.addEventListener("keydown", this.handleInputKeydown);
		this.textInput.addEventListener("click", this.handleInputChange);
		this.textInput.addEventListener("keyup", (e) => {
			if (
				[
					"ArrowUp",
					"ArrowDown",
					"ArrowLeft",
					"ArrowRight",
					"Escape",
				].includes(e.key)
			) {
				this.handleInputChange();
			}
		});
		this.registerDomEvent(document, "click", (event) => {
			if (
				this.suggestionsContainer &&
				!inputAreaContainer.contains(event.target as Node)
			) {
				this.setSuggestions([]);
			}
		});

		// Drag and Drop
		this.registerDomEvent(
			inputAreaContainer,
			"dragover",
			(event: DragEvent) => {
				if (event.dataTransfer) {
					event.preventDefault();
					inputAreaContainer.addClass("provibe-drag-over");
				}
			}
		);
		this.registerDomEvent(inputAreaContainer, "dragleave", () => {
			inputAreaContainer.removeClass("provibe-drag-over");
		});
		this.registerDomEvent(inputAreaContainer, "drop", this.handleDrop);

		this.addMessageToChat(
			"system",
			"ProVibe Agent ready. Type your prompt, drop files, or type / for commands."
		);
		this.renderFilePills();
	}

	// --- UI Update Methods ---

	// Update addMessageToChat to add styling classes and handle user slash command styling
	private addMessageToChat(
		role: "user" | "agent" | "system",
		content: string | HTMLElement,
		isError: boolean = false
	) {
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

		const messageEl = this.chatContainer.createDiv({
			cls: messageClasses.join(" "),
		});

		// --- Updated Rendering Logic ---
		if (content instanceof HTMLElement) {
			messageEl.appendChild(content);
		} else if (role === "agent") {
			// Agent messages rendered as Markdown
			try {
				MarkdownRenderer.render(
					this.plugin.app,
					content,
					messageEl,
					"",
					this.plugin
				);
			} catch (renderError) {
				console.error("Markdown rendering error:", renderError);
				messageEl.setText(`(Error rendering message) ${content}`);
			}
		} else if (role === "user") {
			// User messages: scan for slash commands and style them
			const registeredCommands = this.plugin
				.getRegistryEntries()
				.map((e) => e.slashCommandTrigger)
				.filter((t): t is string => !!t); // Get list of valid triggers like ["/issue", "/test"]

			if (registeredCommands.length > 0) {
				// Create a regex that matches any of the registered commands
				// Escape special regex characters in triggers
				const escapedCommands = registeredCommands.map((cmd) =>
					cmd.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")
				);
				const commandRegex = new RegExp(
					`(${escapedCommands.join("|")})(?=\\s|$)`, // Match command if followed by space or end of string
					"g"
				);

				let lastIndex = 0;
				let match;
				const fragment = document.createDocumentFragment();

				while ((match = commandRegex.exec(content)) !== null) {
					// Add text before the match
					if (match.index > lastIndex) {
						fragment.appendChild(
							document.createTextNode(
								content.substring(lastIndex, match.index)
							)
						);
					}
					// Add the styled command
					const strongEl = document.createElement("strong");
					strongEl.addClass("provibe-slash-command-display"); // Add class for potential specific styling
					strongEl.textContent = match[0]; // The matched command e.g., /issue
					fragment.appendChild(strongEl);
					lastIndex = commandRegex.lastIndex;
				}

				// Add any remaining text after the last match
				if (lastIndex < content.length) {
					fragment.appendChild(
						document.createTextNode(content.substring(lastIndex))
					);
				}
				messageEl.appendChild(fragment);
			} else {
				// No registered commands, just display plain text
				messageEl.createSpan({ text: content });
			}
		} else {
			// System messages as plain text
			messageEl.createSpan({ text: content });
		}
		// --- End Updated Rendering Logic ---

		requestAnimationFrame(() => {
			this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
		});
	}

	private setLoadingState(loading: boolean) {
		this.isLoading = loading;
		const sendButton = this.containerEl.querySelector(
			".provibe-send-button"
		) as HTMLButtonElement;
		if (sendButton) {
			sendButton.disabled = loading;
			sendButton.textContent = loading ? "Sending..." : "Send";
		}
		this.textInput.disabled = loading;
		if (this.stopButton) {
			this.stopButton.style.display = loading ? "inline-block" : "none";
			this.stopButton.disabled = !loading;
		}
	}

	// --- Event Handlers ---

	private handleClear = () => {
		this.textInput.value = "";
		this.chatContainer.empty();
		this.attachedFiles = [];
		this.renderFilePills();
		this.conversationId = null;
		this.setSuggestions([]);
		this.addMessageToChat(
			"system",
			"Chat cleared. New conversation started."
		);
		this.textInput.style.height = "auto";
		this.textInput.dispatchEvent(new Event("input"));
		this.textInput.focus();
	};

	private handleDrop = (event: DragEvent) => {
		console.log("ProVibe: Drop event triggered");
		console.log("ProVibe: drop - dataTransfer:", event.dataTransfer);
		console.log("ProVibe: drop - types:", event.dataTransfer?.types);

		event.preventDefault();
		const inputAreaContainer = this.containerEl.querySelector(
			".provibe-input-area-container"
		);
		if (!inputAreaContainer) return;
		inputAreaContainer.classList.remove("provibe-drag-over");

		let pathData = "";
		if (event.dataTransfer?.types.includes("text/uri-list")) {
			pathData = event.dataTransfer.getData("text/uri-list");
			console.log(
				"ProVibe: drop - got data from text/uri-list:",
				pathData
			);
		} else if (event.dataTransfer?.types.includes("text/plain")) {
			pathData = event.dataTransfer.getData("text/plain");
			console.log("ProVibe: drop - got data from text/plain:", pathData);
		}

		if (!pathData) {
			console.warn(
				"ProVibe: drop - Could not extract path data from dataTransfer."
			);
			new Notice("Could not determine dropped file path.");
			return;
		}

		const potentialPaths = pathData
			.split(/\r?\n/)
			.map((p) => p.trim())
			.filter((p) => p);
		const allVaultFiles = this.app.vault.getFiles();
		let filesAdded = 0;

		console.log("ProVibe: Processing potential paths:", potentialPaths);

		potentialPaths.forEach((potentialPath) => {
			let vaultPath: string | null = null;
			let foundVaultFile: TFile | null = null;
			let normalizedPathForComparison: string | null = null;

			if (
				potentialPath.startsWith("obsidian://open?vault=") ||
				potentialPath.startsWith("obsidian://vault/")
			) {
				try {
					const url = new URL(potentialPath);
					const filePathParam = url.searchParams.get("file");
					if (filePathParam) {
						vaultPath = filePathParam;
						console.log(
							`ProVibe: Extracted path from Obsidian URI: ${vaultPath}`
						);
					} else {
						console.warn(
							`ProVibe: Could not extract 'file' param from Obsidian URI: ${potentialPath}`
						);
					}
				} catch (e) {
					console.error(
						`ProVibe: Error parsing Obsidian URI: ${potentialPath}`,
						e
					);
				}
				if (vaultPath) {
					normalizedPathForComparison = vaultPath;
					vaultPath = null;
				}
			} else if (potentialPath.startsWith("file://")) {
				try {
					let osPath = decodeURIComponent(potentialPath.substring(7));
					if (/^\/[a-zA-Z]:/.test(osPath)) {
						osPath = osPath.substring(1);
					}
					const normalizedOsPath = osPath.replace(/\\\\/g, "/");
					console.log(
						`ProVibe: Decoded file URI to OS path: ${normalizedOsPath}`
					);
					let foundVaultFile: TFile | null = null;
					const directMatch =
						this.app.vault.getAbstractFileByPath(normalizedOsPath);
					if (directMatch instanceof TFile) {
						foundVaultFile = directMatch;
					}
					if (!foundVaultFile)
						foundVaultFile =
							allVaultFiles.find((vf) =>
								normalizedOsPath.endsWith("/" + vf.path)
							) || null;
					if (!foundVaultFile)
						foundVaultFile =
							allVaultFiles.find((vf) =>
								normalizedOsPath.endsWith(vf.path)
							) || null;

					if (foundVaultFile) {
						vaultPath = foundVaultFile.path;
					}
				} catch (e) {
					console.error(
						`ProVibe: Error processing file URI: ${potentialPath}`,
						e
					);
				}
			} else {
				normalizedPathForComparison = potentialPath.replace(
					/\\\\/g,
					"/"
				);
				console.log(
					`ProVibe: Treating potential path as direct/OS path: ${normalizedPathForComparison}`
				);
			}

			if (normalizedPathForComparison) {
				const directMatch = this.app.vault.getAbstractFileByPath(
					normalizedPathForComparison
				);
				if (directMatch instanceof TFile) {
					foundVaultFile = directMatch;
					console.log(
						`ProVibe: Found vault file by exact path: ${foundVaultFile.path}`
					);
				}
				if (!foundVaultFile) {
					foundVaultFile =
						allVaultFiles.find((vf) =>
							normalizedPathForComparison?.endsWith("/" + vf.path)
						) || null;
					if (!foundVaultFile) {
						foundVaultFile =
							allVaultFiles.find((vf) =>
								normalizedPathForComparison?.endsWith(vf.path)
							) || null;
					}
					if (foundVaultFile) {
						console.log(
							`ProVibe: Found vault file by OS path endsWith: ${foundVaultFile.path}`
						);
					}
				}
				if (!foundVaultFile) {
					const possibleMatches = allVaultFiles.filter((vf) =>
						vf.path.startsWith(normalizedPathForComparison + ".")
					);
					if (possibleMatches.length === 1) {
						foundVaultFile = possibleMatches[0];
						console.log(
							`ProVibe: Found vault file by missing extension heuristic: ${foundVaultFile.path}`
						);
					} else if (possibleMatches.length > 1) {
						console.warn(
							`ProVibe: Ambiguous match for ${normalizedPathForComparison} (missing extension?): Found ${possibleMatches
								.map((f) => f.path)
								.join(", ")}`
						);
					}
				}
			}

			if (foundVaultFile) {
				vaultPath = foundVaultFile.path;
			}

			if (vaultPath) {
				if (!this.attachedFiles.includes(vaultPath)) {
					console.log(
						`ProVibe: Adding ${vaultPath} to attachedFiles.`
					);
					this.attachedFiles.push(vaultPath);
					filesAdded++;
				} else {
					console.log(`ProVibe: File ${vaultPath} already attached.`);
				}
			} else {
				console.warn(
					`ProVibe: Could not resolve path/URI ${potentialPath} (normalized: ${normalizedPathForComparison}) to a vault file.`
				);
				new Notice(`Could not add: ${potentialPath}`);
			}
		});

		if (filesAdded > 0) {
			console.log(
				"ProVibe: Files added, calling renderFilePills. Current attached files:",
				this.attachedFiles
			);
			this.renderFilePills();
		} else {
			console.log("ProVibe: No new files added from drop.");
		}
	};

	private renderFilePills() {
		console.log(
			"ProVibe: renderFilePills called. Attached files:",
			this.attachedFiles
		);
		this.filePillsContainer.empty();
		if (this.attachedFiles.length === 0) {
			console.log("ProVibe: No attached files, hiding pills container.");
			this.filePillsContainer.style.display = "none";
			return;
		}

		console.log("ProVibe: Rendering pills, showing container.");
		this.filePillsContainer.style.display = "flex";

		this.attachedFiles.forEach((filePath) => {
			console.log(`ProVibe: Creating pill for ${filePath}`);
			const pill = this.filePillsContainer.createDiv({
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
				this.removeFilePill(filePath)
			);
		});
	}

	private removeFilePill(filePath: string) {
		this.attachedFiles = this.attachedFiles.filter(
			(path) => path !== filePath
		);
		this.renderFilePills(); // Re-render after removal
	}

	// --- Modified handleSend for new slash command logic ---
	private handleSend = async () => {
		if (this.isLoading) return;

		// --- Check if suggestions are active and select if Enter is pressed ---
		if (
			this.suggestions.length > 0 &&
			this.activeSuggestionIndex !== -1 &&
			this.suggestionsContainer?.style.display !== "none"
		) {
			this.handleSuggestionSelect(this.activeSuggestionIndex);
			return;
		}
		// --- End Suggestion Check ---

		const originalMessageContent = this.getTextContent().trim(); // Get raw text

		// --- Transform message content for payload ---
		let payloadContent = originalMessageContent;
		const registeredEntries = this.plugin.getRegistryEntries();

		if (registeredEntries.length > 0) {
			// Create a map for quick lookup
			const triggerMap = new Map<string, string>();
			registeredEntries.forEach((entry) => {
				if (entry.slashCommandTrigger) {
					triggerMap.set(entry.slashCommandTrigger, entry.content);
				}
			});

			if (triggerMap.size > 0) {
				// Build regex to find all registered triggers
				const escapedTriggers = Array.from(triggerMap.keys()).map(
					(cmd) => cmd.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")
				);
				const commandRegex = new RegExp(
					`(${escapedTriggers.join("|")})(?=\\s|$)`,
					"g"
				);

				payloadContent = originalMessageContent.replace(
					commandRegex,
					(match) => {
						const commandName = match.substring(1); // Remove leading slash
						const content = triggerMap.get(match) ?? ""; // Get content from map
						return `${commandName}\n${content}`; // Substitute with command\ncontent
					}
				);
			}
		}
		// --- End Transformation ---

		// Prepare file content prefix
		const attachedFilesContent = this.attachedFiles
			.map((path) => `[File: ${path}]`)
			.join("\n");

		// Combine file prefix and transformed content
		let combinedPayload = payloadContent;
		if (attachedFilesContent) {
			combinedPayload =
				attachedFilesContent +
				(payloadContent ? "\n\n" + payloadContent : "");
		}

		// Don't send if nothing is attached and original message was empty
		if (!attachedFilesContent && !originalMessageContent) return;

		// Add *original* user message to UI for display
		this.addMessageToChat(
			"user",
			originalMessageContent || "(Sent with attached files)"
		);

		// Prepare payload for backend
		const payload: any = {
			message: combinedPayload, // Send the transformed content
		};
		if (this.conversationId) {
			payload.conversation_id = this.conversationId;
		}

		console.log("ProVibe: Sending payload:", payload); // Log the transformed payload

		// Clear input and pills AFTER preparing the message
		this.setTextContent("");
		this.attachedFiles = [];
		this.renderFilePills();
		this.setSuggestions([]); // Clear suggestions on send
		this.setLoadingState(true);

		try {
			await this.callBackend("/chat", payload);
		} catch (error: any) {
			console.error("Error sending message:", error);
			this.addMessageToChat(
				"system",
				`Error: ${error.message || "Failed to connect to backend"}`,
				true
			);
		} finally {
			// setLoadingState handled by callBackend response/error
			this.textInput.focus();
			this.textInput.style.height = "auto";
			this.textInput.dispatchEvent(new Event("input"));
		}
	};

	// --- Add handler for the Stop button ---
	private handleStop = async () => {
		if (!this.isLoading || !this.conversationId || !this.stopButton) return;

		console.log(
			`ProVibe: Stop requested for conversation ${this.conversationId}`
		);
		this.stopButton.textContent = "Stopping...";
		this.stopButton.disabled = true;

		const backendUrl = this.plugin.settings.backendUrl;
		if (!backendUrl) {
			new Notice("Backend URL is not configured.");
			this.stopButton.textContent = "Stop";
			this.stopButton.disabled = false;
			return;
		}

		const stopUrl = `${backendUrl}/stop/${this.conversationId}`;

		try {
			await requestUrl({
				url: stopUrl,
				method: "POST",
			});
			new Notice("Stop signal sent.");
		} catch (error: any) {
			console.error("Error sending stop signal:", error);
			new Notice(`Failed to send stop signal: ${error.message}`);
			if (this.isLoading && this.stopButton) {
				this.stopButton.textContent = "Stop";
				this.stopButton.disabled = false;
			}
		}
	};

	// --- Backend Communication ---

	private async callBackend(
		endpoint: "/chat" | "/tool_result",
		payload: any
	) {
		const backendUrl = this.plugin.settings.backendUrl;
		if (!backendUrl) {
			throw new Error(
				"Backend URL is not configured in ProVibe settings."
			);
		}

		const fullUrl = `${backendUrl}${endpoint}`;
		let responseData: BackendResponse | null = null;

		try {
			const response = await requestUrl({
				url: fullUrl,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			responseData = response.json;

			if (!responseData) {
				throw new Error(
					"Received empty or invalid JSON response from backend."
				);
			}

			console.log("Backend Response:", responseData);

			if (responseData.conversation_id) {
				this.conversationId = responseData.conversation_id;
				console.log(
					"ProVibe: Updated conversation ID to:",
					this.conversationId
				);
			} else {
				console.warn(
					"ProVibe: Backend response missing conversation_id!"
				);
			}

			if (responseData.agent_message?.content) {
				this.addMessageToChat(
					"agent",
					responseData.agent_message.content
				);
			}

			if (responseData.tool_calls && responseData.tool_calls.length > 0) {
				const toolNames = responseData.tool_calls
					.map((tc) => tc.tool)
					.join(", ");
				this.addMessageToChat(
					"system",
					`Agent requests actions using: ${toolNames}`
				);
				await this.processToolCalls(responseData.tool_calls);
			} else if (!responseData.agent_message?.content) {
				this.addMessageToChat(
					"system",
					"Received an empty or unexpected response from the agent.",
					true
				);
			}
		} catch (error: any) {
			console.error(`Error calling backend endpoint ${endpoint}:`, error);
			const errorMsg = error.message?.includes("Failed to fetch")
				? `Could not connect to backend at ${backendUrl}. Is it running?`
				: error.message || `Request to ${endpoint} failed.`;
			this.addMessageToChat("system", `Error: ${errorMsg}`, true);
			this.setLoadingState(false);
		} finally {
			if (
				endpoint === "/chat" &&
				(!responseData?.tool_calls ||
					responseData.tool_calls.length === 0)
			) {
				this.setLoadingState(false);
			}
			if (
				endpoint === "/tool_result" &&
				(!responseData?.tool_calls ||
					responseData.tool_calls.length === 0)
			) {
				this.setLoadingState(false);
			}
		}
	}

	// --- Tool Handling ---

	private async processToolCalls(toolCalls: BackendToolCall[]) {
		this.setLoadingState(true);
		console.log(`ProVibe: Processing ${toolCalls.length} tool calls.`);

		const executedResults: ToolResult[] = [];
		const pendingEdits: BackendToolCall[] = [];
		let immediateExecutionError = false;

		for (const toolCall of toolCalls) {
			if (toolCall.tool === "editFile") {
				pendingEdits.push(toolCall);
				this.addMessageToChat(
					"system",
					`Agent proposes changes to ${toolCall.params.path}. Review required.`
				);
			} else {
				let result: any;
				let errorOccurred = false;
				this.addMessageToChat(
					"system",
					`Executing immediate tool: ${toolCall.tool}...`
				);
				try {
					result = await this.executeSingleTool(toolCall);
				} catch (error: any) {
					console.error(
						`Error executing immediate tool ${toolCall.tool} (ID: ${toolCall.id}):`,
						error
					);
					result = `Error executing tool ${toolCall.tool}: ${error.message}`;
					errorOccurred = true;
					immediateExecutionError = true;
				}
				executedResults.push({ id: toolCall.id, result: result });

				const resultString =
					typeof result === "string"
						? result
						: JSON.stringify(result);
				const displayResult =
					resultString.length > 100
						? resultString.substring(0, 100) + "..."
						: resultString;
				this.addMessageToChat(
					"system",
					`Tool ${toolCall.tool} result: ${displayResult}`,
					errorOccurred
				);
			}
		}

		if (pendingEdits.length > 0) {
			try {
				const editResults = await this.reviewAndExecuteEdits(
					pendingEdits
				);
				executedResults.push(...editResults);
			} catch (reviewError: any) {
				console.error("Error during edit review process:", reviewError);
				this.addMessageToChat(
					"system",
					`Error processing proposed edits: ${reviewError.message}`,
					true
				);
				immediateExecutionError = true;
			}
		}

		if (executedResults.length > 0) {
			console.log(
				"ProVibe: Sending tool results back to backend:",
				executedResults
			);
			try {
				if (!this.conversationId) {
					throw new Error(
						"Cannot send tool results - conversation ID is missing!"
					);
				}
				await this.callBackend("/tool_result", {
					tool_results: executedResults,
					conversation_id: this.conversationId,
				});
			} catch (error: any) {
				this.setLoadingState(false);
			}
		} else if (!immediateExecutionError && pendingEdits.length === 0) {
			console.warn(
				"ProVibe: processToolCalls finished with no results to send."
			);
			this.setLoadingState(false);
		} else if (immediateExecutionError) {
			this.setLoadingState(false);
		}
	}

	private async reviewAndExecuteEdits(
		pendingEdits: BackendToolCall[]
	): Promise<ToolResult[]> {
		const results: ToolResult[] = [];
		for (const editCall of pendingEdits) {
			try {
				const result = await this.displayDiffModalForReview(editCall);

				if (result.applied && result.finalContent !== undefined) {
					this.addMessageToChat(
						"system",
						`Applying selected changes to ${editCall.params.path}...`
					);
					try {
						const applyMsg = await this.toolEditFile(
							editCall.params.path,
							result.finalContent,
							editCall.params.instructions
						);
						results.push({
							id: result.toolCallId,
							result: applyMsg,
						});
						this.addMessageToChat("system", applyMsg);
					} catch (applyError: any) {
						console.error(
							`Error applying reconstructed changes to ${editCall.params.path}:`,
							applyError
						);
						const errorMsg = `Failed to apply changes to ${editCall.params.path}: ${applyError.message}`;
						results.push({
							id: result.toolCallId,
							result: errorMsg,
						});
						this.addMessageToChat("system", errorMsg, true);
					}
				} else {
					results.push({
						id: result.toolCallId,
						result: result.message,
					});
					this.addMessageToChat(
						"system",
						result.message,
						!result.applied
					);
				}
			} catch (error: any) {
				console.error(
					`Error displaying diff modal for ${editCall.params.path}:`,
					error
				);
				const errorMsg = `Error processing edit for ${editCall.params.path}: ${error.message}`;
				results.push({
					id: editCall.id,
					result: errorMsg,
				});
				this.addMessageToChat(
					"system",
					`Failed to process proposed edit for ${editCall.params.path}.`,
					true
				);
			}
		}
		return results;
	}

	private displayDiffModalForReview(
		toolCall: BackendToolCall
	): Promise<DiffReviewResult> {
		return new Promise(async (resolve, reject) => {
			const { path, code_edit, instructions } = toolCall.params;
			const normalizedPath = path.startsWith("./")
				? path.substring(2)
				: path;

			try {
				const originalContent = await this.toolReadFile(normalizedPath);

				new DiffReviewModal(
					this.app,
					this.plugin,
					normalizedPath,
					originalContent,
					code_edit,
					instructions,
					toolCall.id,
					resolve
				).open();
			} catch (error: any) {
				console.error(
					`Error preparing data for diff modal ${normalizedPath}:`,
					error
				);
				reject(
					new Error(
						`Failed to read file for diff review: ${error.message}`
					)
				);
			}
		});
	}

	private async executeSingleTool(toolCall: BackendToolCall): Promise<any> {
		let result: any;
		switch (toolCall.tool) {
			case "readFile":
				result = await this.toolReadFile(toolCall.params.path);
				break;
			default:
				throw new Error(
					`Unknown immediate tool '${toolCall.tool}' requested.`
				);
		}
		return result;
	}

	// --- Tool Implementations ---

	private async toolReadFile(path: string): Promise<string> {
		const normalizedPath = path.startsWith("./") ? path.substring(2) : path;
		console.log(`Tool: Reading file ${normalizedPath} (Original: ${path})`);
		const file = this.app.vault.getAbstractFileByPath(normalizedPath);
		if (!file) {
			throw new Error(`File not found: ${normalizedPath}`);
		}
		if (!(file instanceof TFile)) {
			throw new Error(`Path is not a file: ${normalizedPath}`);
		}
		return await this.app.vault.read(file);
	}

	private async toolEditFile(
		path: string,
		final_content: string,
		instructions: string
	): Promise<string> {
		const normalizedPath = path.startsWith("./") ? path.substring(2) : path;
		console.log(
			`Tool: Applying final content to ${normalizedPath} (Instructions: ${instructions})`
		);
		const file = this.app.vault.getAbstractFileByPath(normalizedPath);
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
			await this.app.vault.modify(file, final_content);
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

	// --- Lifecycle Methods ---

	async onClose() {}

	// --- Helper Methods ---

	getTextContent(): string {
		return this.textInput?.value || "";
	}

	setTextContent(text: string): void {
		if (this.textInput) {
			this.textInput.value = text;
			this.textInput.dispatchEvent(new Event("input", { bubbles: true }));
		}
	}

	// --- Slash Command Methods ---

	private setSuggestions(newSuggestions: RegistryEntry[]) {
		this.suggestions = newSuggestions;
		this.activeSuggestionIndex = -1;
		this.renderSuggestions();
	}

	private renderSuggestions() {
		if (!this.suggestionsContainer) return;

		this.suggestionsContainer.empty();

		if (this.suggestions.length === 0) {
			this.suggestionsContainer.style.display = "none";
			this.currentTrigger = null;
			this.triggerStartIndex = -1;
			return;
		}

		this.suggestionsContainer.style.display = "block";

		this.suggestions.forEach((entry, index) => {
			const itemEl = this.suggestionsContainer.createDiv({
				cls: "provibe-suggestion-item p-1.5 cursor-pointer hover:bg-[var(--background-modifier-hover)] rounded-sm text-sm",
			});
			itemEl.id = `provibe-suggestion-${index}`;

			if (index === this.activeSuggestionIndex) {
				itemEl.addClass("bg-[var(--background-modifier-hover)]");
			}

			const triggerEl = itemEl.createEl("strong");
			triggerEl.textContent = entry.slashCommandTrigger ?? "";
			itemEl.createSpan({
				text: `: ${entry.description}`,
				cls: "text-[var(--text-muted)]",
			});

			itemEl.addEventListener("click", () => {
				this.handleSuggestionSelect(index);
			});
		});

		if (this.activeSuggestionIndex !== -1) {
			const activeEl = this.suggestionsContainer.querySelector(
				`#provibe-suggestion-${this.activeSuggestionIndex}`
			);
			activeEl?.scrollIntoView({ block: "nearest" });
		}
	}

	// --- Modified handleSuggestionSelect ---
	private handleSuggestionSelect(index: number) {
		if (
			index < 0 ||
			index >= this.suggestions.length ||
			!this.currentTrigger || // Need the trigger text that was being typed
			this.triggerStartIndex === -1
		) {
			this.setSuggestions([]);
			return;
		}

		const selectedEntry = this.suggestions[index];
		if (!selectedEntry?.slashCommandTrigger) return; // Need the command trigger itself

		const currentValue = this.textInput.value;
		const triggerEndIndex =
			this.triggerStartIndex + this.currentTrigger.length;

		// Replace the partially typed trigger with the full trigger text and a space
		const newValue =
			currentValue.substring(0, this.triggerStartIndex) +
			selectedEntry.slashCommandTrigger + // Insert the full trigger text
			" " + // Add a space after it
			currentValue.substring(triggerEndIndex); // Text after the original partial trigger

		this.textInput.value = newValue;
		this.setSuggestions([]); // Hide suggestions

		// Move cursor to the end of the inserted trigger + space
		const newCursorPos =
			this.triggerStartIndex +
			selectedEntry.slashCommandTrigger.length +
			1;
		this.textInput.focus();
		setTimeout(() => {
			this.textInput.setSelectionRange(newCursorPos, newCursorPos);
		}, 0);

		this.textInput.dispatchEvent(new Event("input", { bubbles: true }));
	}
	// --- End Modified handleSuggestionSelect ---

	private handleInputChange = () => {
		const value = this.textInput.value;
		const cursorPos = this.textInput.selectionStart;
		const textBeforeCursor = value.substring(0, cursorPos);

		const match = textBeforeCursor.match(/(?:\s|^)(\/([a-zA-Z0-9_-]*))$/);

		if (match) {
			const trigger = match[1];
			const triggerStart =
				match.index !== undefined
					? match.index + (match[0].startsWith("/") ? 0 : 1)
					: -1;

			const allEntries = this.plugin.getRegistryEntries();
			const matchingEntries = allEntries.filter(
				(entry) =>
					entry.slashCommandTrigger?.startsWith(trigger) &&
					entry.slashCommandTrigger !== "/"
			);

			if (matchingEntries.length > 0 && triggerStart !== -1) {
				this.currentTrigger = trigger; // Store the *typed* trigger (e.g., "/iss")
				this.triggerStartIndex = triggerStart;
				this.setSuggestions(matchingEntries);
			} else {
				this.setSuggestions([]);
			}
		} else {
			this.setSuggestions([]);
		}
	};

	private handleInputKeydown = (event: KeyboardEvent) => {
		if (
			this.suggestions.length > 0 &&
			this.suggestionsContainer?.style.display !== "none"
		) {
			switch (event.key) {
				case "ArrowUp":
					event.preventDefault();
					this.activeSuggestionIndex =
						(this.activeSuggestionIndex -
							1 +
							this.suggestions.length) %
						this.suggestions.length;
					this.renderSuggestions();
					break;
				case "ArrowDown":
					event.preventDefault();
					this.activeSuggestionIndex =
						(this.activeSuggestionIndex + 1) %
						this.suggestions.length;
					this.renderSuggestions();
					break;
				case "Enter":
				case "Tab":
					if (this.activeSuggestionIndex !== -1) {
						event.preventDefault();
						this.handleSuggestionSelect(this.activeSuggestionIndex);
					} else {
						this.setSuggestions([]);
						if (event.key === "Enter" && !event.shiftKey) {
							// Prevent default Enter if suggestions were visible but none selected
							event.preventDefault();
							this.handleSend();
						}
					}
					break;
				case "Escape":
					event.preventDefault();
					this.setSuggestions([]);
					break;
				default:
					break;
			}
		} else if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			this.handleSend();
		}
	};
}
