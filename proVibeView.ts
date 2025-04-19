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
import ProVibePlugin from "../../main"; // Adjusted path
import { DiffReviewModal, DiffReviewResult } from "./DiffReviewModal"; // Assuming this is in the same directory
import { ReactViewHost } from "../../src/ReactViewHost"; // Adjusted path
import { RegistryEntry } from "../../src/types"; // Adjusted path
import {
	toolReadFile,
	toolEditFile,
} from "./components/ProVibeView/toolImplementations"; // Path OK if proVibeView.ts is at root
import {
	addMessageToChat,
	renderFilePills,
	renderSuggestions,
	setLoadingState,
	setSuggestions as setDomSuggestions, // Alias to avoid name clash
	setTextContent,
} from "./components/ProVibeView/domUtils"; // Path OK if proVibeView.ts is at root
// Import the handlers
import {
	handleClear,
	handleDrop,
	handleSend,
	handleStop,
	handleSuggestionSelect,
	handleInputChange,
	handleInputKeydown,
	removeFilePill, // Also needed for rendering pills
} from "./components/ProVibeView/eventHandlers";

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
	plugin: ProVibePlugin; // Made public for utils
	textInput: HTMLTextAreaElement; // Made public for utils
	chatContainer: HTMLDivElement; // Made public for utils
	filePillsContainer: HTMLDivElement; // Made public for utils
	public attachedFiles: string[] = []; // Store paths of attached files - Already public
	isLoading: boolean = false; // Made public for utils
	conversationId: string | null = null; // Add state for conversation ID
	stopButton: HTMLButtonElement | null = null; // Made public for utils
	initialFilePathFromState: string | null = null; // Made public for utils
	wasInitiallyAttached: boolean = false; // Made public for utils
	currentRequestController: AbortController | null = null; // Track the current request
	loadingIndicator: HTMLDivElement; // Reference to the loading indicator element

	// --- Slash Command State (Made public for utils & handlers) ---
	suggestions: RegistryEntry[] = [];
	activeSuggestionIndex: number = -1;
	suggestionsContainer: HTMLDivElement | null = null;
	currentTrigger: string | null = null; // Store the trigger being suggested for
	triggerStartIndex: number = -1; // Store start index of the current trigger
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

	async setState(state: any, result: ViewStateResult): Promise<void> {
		console.log("ProVibeView setState called with state:", state);
		let fileToAttachPath: string | null = null;

		if (state?.sourceFilePath) {
			fileToAttachPath = state.sourceFilePath;
			console.log(
				"ProVibeView setState: Captured sourceFilePath:",
				fileToAttachPath
			);
		} else {
			console.log(
				"ProVibeView setState: No sourceFilePath found in state."
			);
		}

		await super.setState(state, result);

		if (fileToAttachPath && this.attachedFiles.length === 0) {
			console.log(
				"ProVibe [setState]: Attempting to auto-attach file from state:",
				fileToAttachPath
			);
			this.attachInitialFile(fileToAttachPath);
		} else if (fileToAttachPath && this.attachedFiles.length > 0) {
			console.log(
				"ProVibe [setState]: Files already attached, skipping auto-attach from state."
			);
		}
	}

	public attachInitialFile(filePath: string) {
		console.log("ProVibe [attachInitialFile]: Trying to attach:", filePath);
		console.log(
			"ProVibe [attachInitialFile]: Current attachedFiles BEFORE attach:",
			[...this.attachedFiles]
		);

		if (filePath && !this.attachedFiles.includes(filePath)) {
			const fileExists =
				this.app.vault.getAbstractFileByPath(filePath) instanceof TFile;
			if (fileExists) {
				console.log(
					`ProVibe [attachInitialFile]: Attaching ${filePath}...`
				);
				this.attachedFiles = [filePath];
				this.initialFilePathFromState = filePath;
				this.wasInitiallyAttached = true;
				console.log(
					"ProVibe [attachInitialFile]: attachedFiles after push:",
					[...this.attachedFiles]
				);
				if (this.filePillsContainer) {
					// Pass the remove callback correctly
					renderFilePills(
						this.filePillsContainer,
						this.attachedFiles
							.map(
								(p) =>
									this.app.vault.getAbstractFileByPath(
										p
									) as TFile
							)
							.filter((f) => f),
						(file) => removeFilePill(this, file) // Pass view instance
					);
				}
			} else {
				console.warn(
					`ProVibe [attachInitialFile]: File path '${filePath}' does not exist or is not a TFile. Not attaching.`
				);
			}
		} else if (filePath && this.attachedFiles.includes(filePath)) {
			console.log(
				`ProVibe [attachInitialFile]: File ${filePath} already attached.`
			);
		} else {
			console.log(
				"ProVibe [attachInitialFile]: File path variable was null/empty."
			);
		}
	}

	public handleActiveFileChange(newFilePath: string | null) {
		if (!this.containerEl.isShown()) {
			console.log(
				"ProVibe [handleActiveFileChange]: View not visible, ignoring file change."
			);
			return;
		}

		console.log(
			"ProVibe [handleActiveFileChange]: Received new file path:",
			newFilePath
		);
		console.log(
			"ProVibe [handleActiveFileChange]: Current attachedFiles:",
			[...this.attachedFiles]
		);
		console.log(
			"ProVibe [handleActiveFileChange]: wasInitiallyAttached:",
			this.wasInitiallyAttached
		);
		console.log(
			"ProVibe [handleActiveFileChange]: initialFilePathFromState:",
			this.initialFilePathFromState
		);

		if (
			this.attachedFiles.length === 1 &&
			this.wasInitiallyAttached &&
			this.attachedFiles[0] === this.initialFilePathFromState
		) {
			if (newFilePath && newFilePath !== this.initialFilePathFromState) {
				const fileExists =
					this.app.vault.getAbstractFileByPath(newFilePath) instanceof
					TFile;
				if (fileExists) {
					console.log(
						`ProVibe [handleActiveFileChange]: Replacing ${this.initialFilePathFromState} with ${newFilePath}`
					);
					this.attachedFiles = [newFilePath];
					this.initialFilePathFromState = newFilePath;
					this.wasInitiallyAttached = true;
					// Pass the remove callback correctly
					renderFilePills(
						this.filePillsContainer,
						this.attachedFiles
							.map(
								(p) =>
									this.app.vault.getAbstractFileByPath(
										p
									) as TFile
							)
							.filter((f) => f),
						(file) => removeFilePill(this, file) // Pass view instance
					);
				} else {
					console.warn(
						`ProVibe [handleActiveFileChange]: New file path '${newFilePath}' does not exist. Not replacing.`
					);
				}
			} else if (!newFilePath) {
				console.log(
					"ProVibe [handleActiveFileChange]: Switched to view without a file. Removing initial attachment."
				);
				this.attachedFiles = [];
				this.initialFilePathFromState = null;
				this.wasInitiallyAttached = false;
				// Pass the remove callback correctly
				renderFilePills(
					this.filePillsContainer,
					this.attachedFiles
						.map(
							(p) =>
								this.app.vault.getAbstractFileByPath(p) as TFile
						)
						.filter((f) => f),
					(file) => removeFilePill(this, file) // Pass view instance
				);
			} else {
				console.log(
					"ProVibe [handleActiveFileChange]: New file path is the same as the current attached file. No change."
				);
			}
		} else {
			console.log(
				"ProVibe [handleActiveFileChange]: Conditions not met for following active file. Stopping."
			);
		}
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

		// Assign DOM elements to class properties
		this.chatContainer = container.createEl("div", {
			cls: "provibe-chat-container flex-grow overflow-y-auto p-2 space-y-3",
		});

		const inputAreaContainer = container.createEl("div", {
			cls: "provibe-input-area-container relative pt-3 border-t border-[var(--background-modifier-border)] mb-4",
		});

		// Add Loading Indicator (initially hidden)
		this.loadingIndicator = inputAreaContainer.createEl("div", {
			cls: "provibe-loading-indicator absolute inset-x-0 top-0 h-1 bg-blue-500 animate-pulse hidden",
			attr: { role: "progressbar", "aria-busy": "false" },
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
				rows: "1", // Start with 1 row, auto-resize will handle it
			},
		});

		// Auto-Resizing Logic (modified to use inputContainer)
		const adjustTextareaHeight = () => {
			const minRows = 1;
			const maxRows = 15; // Increased max rows
			const inputEl = this.textInput; // Use the contenteditable div
			inputEl.style.height = "auto";
			const scrollHeight = inputEl.scrollHeight;
			const computedStyle = getComputedStyle(inputEl);
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
			inputEl.style.height = `${targetHeight}px`;
			inputEl.style.overflowY =
				scrollHeight > maxHeight ? "auto" : "hidden";
		};
		this.textInput.addEventListener("input", adjustTextareaHeight);
		setTimeout(adjustTextareaHeight, 0);

		// Buttons (assign to class property if needed by utils, e.g., stopButton)
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

		// Event Listeners (use imported handlers)
		clearButton.addEventListener("click", () => handleClear(this)); // Pass view instance
		sendButton.addEventListener("click", () => handleSend(this)); // Pass view instance
		this.stopButton.addEventListener("click", () => handleStop(this)); // Pass view instance
		this.textInput.addEventListener("input", () => handleInputChange(this)); // Pass view instance
		this.textInput.addEventListener("keydown", (e) =>
			handleInputKeydown(this, e)
		); // Pass view instance and event
		this.textInput.addEventListener("click", () => handleInputChange(this)); // Trigger suggestions check on click too
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
				handleInputChange(this);
			}
		});
		this.registerDomEvent(document, "click", (event) => {
			if (
				this.suggestionsContainer &&
				!inputAreaContainer.contains(event.target as Node)
			) {
				// Use the aliased setDomSuggestions to clear UI
				setDomSuggestions(this.suggestionsContainer, []);
			}
		});

		// Drag and Drop (use imported handler)
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
		this.registerDomEvent(inputAreaContainer, "drop", (e) =>
			handleDrop(this, e)
		); // Pass view instance and event

		// Initial UI setup using imported functions
		addMessageToChat(
			this.chatContainer,
			"system",
			"ProVibe Agent ready. Type your prompt, drop files, or type / for commands."
		);
		// Pass the remove callback correctly
		renderFilePills(
			this.filePillsContainer,
			this.attachedFiles
				.map((p) => this.app.vault.getAbstractFileByPath(p) as TFile)
				.filter((f) => f),
			(file) => removeFilePill(this, file) // Pass view instance
		);
	}

	// --- Backend Communication (Remains in the class) ---
	private async callBackend(
		message: string,
		files: TFile[],
		conversationId: string | null
	): Promise<void> {
		this.currentRequestController = new AbortController();
		const signal = this.currentRequestController.signal;

		const history: HistoryMessage[] = [];
		this.chatContainer
			.querySelectorAll(".provibe-message")
			.forEach((msgEl) => {
				const role = msgEl.getAttribute("data-role");
				const content = msgEl.querySelector(
					".provibe-message-content"
				)?.innerHTML; // Get rendered HTML
				if (content) {
					if (role === "user") {
						history.push({ type: "human", content });
					} else if (role === "agent") {
						// Attempt to reconstruct tool calls if necessary (basic example)
						const toolCallElements =
							msgEl.querySelectorAll(".provibe-tool-call");
						if (toolCallElements.length > 0) {
							const toolCalls: HistoryMessage["tool_calls"] = [];
							toolCallElements.forEach((tcEl) => {
								const id =
									tcEl.getAttribute("data-tool-id") ||
									"unknown";
								const name =
									tcEl.getAttribute("data-tool-name") ||
									"unknown";
								let args = {};
								try {
									args =
										JSON.parse(
											tcEl.getAttribute(
												"data-tool-args"
											) || "{}"
										) || {};
								} catch (e) {
									console.error(
										"Error parsing tool args from DOM",
										e
									);
								}
								toolCalls.push({ id, name, args });
							});
							history.push({
								type: "ai",
								content: content.replace(
									/<div class="provibe-tool-call".*?<\/div>/gs,
									""
								), // Remove tool call divs from main content
								tool_calls: toolCalls,
							});
						} else {
							history.push({ type: "ai", content });
						}
					} else if (role === "tool") {
						const toolCallId =
							msgEl.getAttribute("data-tool-call-id") ||
							"unknown";
						history.push({
							type: "tool",
							content,
							tool_call_id: toolCallId,
						});
					}
				}
			});

		const fileContents = await Promise.all(
			files.map(async (file) => ({
				name: file.path,
				content: await this.app.vault.read(file),
			}))
		);

		const requestBody = {
			message: message,
			attached_files: fileContents,
			history: history.slice(-10), // Limit history size
			conversation_id: conversationId,
		};

		try {
			const response = await requestUrl({
				url: `${this.plugin.settings.backendUrl}/chat`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(requestBody),
				throw: false, // Handle errors manually
			});

			if (signal.aborted) {
				console.log("Backend request aborted by user.");
				return; // Don't process response if aborted
			}

			if (response.status >= 400) {
				throw new Error(
					`Backend error (${response.status}): ${response.text}`
				);
			}

			const responseData: BackendResponse = response.json;
			this.conversationId = responseData.conversation_id; // Update conversation ID

			let agentResponseAdded = false;

			// Process tool calls FIRST if they exist
			if (responseData.tool_calls && responseData.tool_calls.length > 0) {
				// Optionally add the message containing the tool calls *before* execution
				if (responseData.agent_message) {
					addMessageToChat(
						this.chatContainer,
						"agent",
						responseData.agent_message.content,
						[], // No files attached to agent response
						responseData.agent_message.tool_calls // Pass tool calls for rendering
					);
					agentResponseAdded = true;
				}

				const toolResults = await this.processToolCalls(
					responseData.tool_calls
				);

				// Send results back to the backend
				if (toolResults.length > 0) {
					await this.sendToolResults(toolResults);
				}
			} else if (responseData.agent_message) {
				// If no tool calls, just add the agent's message
				addMessageToChat(
					this.chatContainer,
					"agent",
					responseData.agent_message.content
				);
				agentResponseAdded = true;
			}

			if (!agentResponseAdded && !responseData.tool_calls) {
				console.warn(
					"Received backend response with no message or tool calls"
				);
				addMessageToChat(
					this.chatContainer,
					"system",
					"Received an empty response from the agent."
				);
			}
		} catch (error) {
			if (error.name === "AbortError") {
				console.log("Fetch aborted.");
				addMessageToChat(
					this.chatContainer,
					"system",
					"Request cancelled."
				);
			} else {
				console.error("Error calling backend:", error);
				addMessageToChat(
					this.chatContainer,
					"error",
					`Error: ${error.message}`
				);
			}
		} finally {
			this.currentRequestController = null;
			setLoadingState(this.loadingIndicator, false);
		}
	}

	private async sendToolResults(results: ToolResult[]): Promise<void> {
		if (!this.conversationId) {
			console.error(
				"Cannot send tool results without a conversation ID."
			);
			addMessageToChat(
				this.chatContainer,
				"error",
				"Error: Missing conversation ID for tool results."
			);
			return;
		}

		setLoadingState(this.loadingIndicator, true);
		this.currentRequestController = new AbortController();
		const signal = this.currentRequestController.signal;

		// Add tool results to the chat visually
		results.forEach((result) => {
			addMessageToChat(
				this.chatContainer,
				"tool",
				`Tool Result (ID: ${result.id}): ${JSON.stringify(
					result.result,
					null,
					2
				)}`,
				[],
				undefined,
				result.id // Pass tool call ID for linking
			);
		});

		const requestBody = {
			tool_results: results,
			conversation_id: this.conversationId,
		};

		try {
			const response = await requestUrl({
				url: `${this.plugin.settings.backendUrl}/tool_result`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(requestBody),
				throw: false,
			});

			if (signal.aborted) {
				console.log("Tool result request aborted.");
				return;
			}

			if (response.status >= 400) {
				throw new Error(
					`Backend error sending tool results (${response.status}): ${response.text}`
				);
			}

			const responseData: BackendResponse = response.json;
			this.conversationId = responseData.conversation_id; // Ensure ID is kept

			// Expecting a final agent message after tool results
			if (responseData.agent_message) {
				addMessageToChat(
					this.chatContainer,
					"agent",
					responseData.agent_message.content
				);
			} else {
				console.warn(
					"No final agent message received after tool results."
				);
				// Optional: Add a system message indicating this?
				// addMessageToChat(this.chatContainer, "system", "Agent processing complete after tool use.");
			}
		} catch (error) {
			if (error.name === "AbortError") {
				console.log("Tool result fetch aborted.");
				addMessageToChat(
					this.chatContainer,
					"system",
					"Request cancelled."
				);
			} else {
				console.error("Error sending tool results:", error);
				addMessageToChat(
					this.chatContainer,
					"error",
					`Error sending tool results: ${error.message}`
				);
			}
		} finally {
			setLoadingState(this.loadingIndicator, false);
			this.currentRequestController = null;
		}
	}

	private async processToolCalls(
		toolCalls: BackendToolCall[]
	): Promise<ToolResult[]> {
		const results: ToolResult[] = [];
		const editToolCalls = toolCalls.filter((tc) => tc.tool === "edit_file");
		const otherToolCalls = toolCalls.filter(
			(tc) => tc.tool !== "edit_file"
		);

		// Execute non-edit tools first
		for (const toolCall of otherToolCalls) {
			try {
				const result = await this.executeSingleTool(toolCall);
				results.push({ id: toolCall.id, result });
			} catch (error) {
				console.error(`Error executing tool ${toolCall.tool}:`, error);
				results.push({
					id: toolCall.id,
					result: {
						error: `Failed to execute tool: ${error.message}`,
					},
				});
			}
		}

		// Handle edit tools with review
		if (editToolCalls.length > 0) {
			try {
				const editResults = await this.reviewAndExecuteEdits(
					editToolCalls
				);
				results.push(...editResults);
			} catch (error) {
				console.error("Error processing file edits:", error);
				// Add error results for all pending edits if the review process fails globally
				editToolCalls.forEach((tc) => {
					results.push({
						id: tc.id,
						result: {
							error: `Failed to process edits: ${error.message}`,
						},
					});
				});
			}
		}

		return results;
	}

	// --- Tool Execution (Modify to use imported tool implementations) ---

	private async reviewAndExecuteEdits(
		pendingEdits: BackendToolCall[]
	): Promise<ToolResult[]> {
		const results: ToolResult[] = [];
		for (const toolCall of pendingEdits) {
			if (toolCall.tool !== "edit_file") continue; // Should not happen, but safety check

			try {
				const reviewResult = await this.displayDiffModalForReview(
					toolCall
				);

				if (reviewResult.approved) {
					// Execute using the imported tool function
					const executionResult = await toolEditFile(
						this.app,
						toolCall.params.target_file,
						reviewResult.content // Use approved content
					);
					results.push({ id: toolCall.id, result: executionResult });
					new Notice(`File ${toolCall.params.target_file} updated.`);
				} else {
					results.push({
						id: toolCall.id,
						result: { message: "Edit rejected by user." },
					});
					new Notice("Edit rejected.");
				}
			} catch (error) {
				console.error(
					`Error processing edit for ${toolCall.params.target_file}:`,
					error
				);
				results.push({
					id: toolCall.id,
					result: { error: `Failed to apply edit: ${error.message}` },
				});
				new Notice(
					`Error applying edit to ${toolCall.params.target_file}.`
				);
			}
		}
		return results;
	}

	private displayDiffModalForReview(
		toolCall: BackendToolCall
	): Promise<DiffReviewResult> {
		return new Promise(async (resolve) => {
			const targetPath = toolCall.params.target_file;
			const proposedContent = toolCall.params.code_edit; // Assuming backend sends full proposed content
			let originalContent = "";
			const file = this.app.vault.getAbstractFileByPath(targetPath);

			if (file instanceof TFile) {
				originalContent = await this.app.vault.read(file);
			} else {
				// Handle case where file doesn't exist (treat as new file creation)
				originalContent = "";
			}

			new DiffReviewModal(
				this.app,
				targetPath,
				originalContent,
				proposedContent,
				(result) => {
					resolve(result);
				}
			).open();
		});
	}

	private async executeSingleTool(toolCall: BackendToolCall): Promise<any> {
		switch (toolCall.tool) {
			case "read_file":
				// Execute using the imported tool function
				return await toolReadFile(
					this.app,
					toolCall.params.target_file
				);
			// Add cases for other non-edit tools here if needed
			// case "another_tool":
			//   return await toolAnotherTool(this.app, toolCall.params);
			default:
				throw new Error(
					`Unknown or unsupported tool: ${toolCall.tool}`
				);
		}
	}

	// --- Lifecycle Methods ---

	async onClose() {
		// Any cleanup needed when the view is closed
	}

	// --- Text Content Helpers (No longer needed if using contenteditable div) ---
	/* REMOVED getTextContent */
	/* REMOVED setTextContent */

	// --- Slash Command Methods (REMOVED - now in eventHandlers/domUtils) ---
	/* REMOVED setSuggestions */
	/* REMOVED handleSuggestionSelect */
	/* REMOVED handleInputChange */
	/* REMOVED handleInputKeydown */
}
