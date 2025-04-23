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
import ProVibePlugin from "../../main"; // Corrected path to be relative to current dir
import { DiffReviewModal, DiffReviewResult } from "../DiffReviewModal"; // Corrected path (assuming same dir as view)
import { ReactViewHost } from "../../ReactViewHost"; // Corrected path
import { RegistryEntry, Patch } from "../../types"; // Corrected path
import {
	toolReadFile,
	toolEditFile,
	toolReplaceSelectionInFile,
	applyPatchesToFile as toolApplyPatchesToFile, // Corrected alias
} from "./toolImplementations"; // Corrected path
import {
	addMessageToChat,
	renderFilePills as renderDomFilePills, // Alias dom utils
	renderSuggestions as renderDomSuggestions, // Alias dom utils
	setLoadingState as setDomLoadingState, // Alias dom utils
	setSuggestions as setDomSuggestions, // Alias dom utils
	setTextContent,
} from "./domUtils"; // Corrected path
import {
	handleClear,
	handleDrop,
	handleSend,
	handleStop,
	handleSuggestionSelect,
	handleInputChange,
	handleInputKeydown,
	removeFilePill as removeEventHandlerFilePill, // Alias event handler
} from "./eventHandlers"; // Corrected path

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
	// Update field name to match backend
	tool_calls_prepared?: BackendToolCall[]; // <<< CHANGED from tool_calls
	conversation_id: string; // ID is always returned
}

// Interface for storing tool results with their IDs
interface ToolResult {
	id: string;
	result: any;
}

export class ProVibeView extends ItemView {
	plugin: ProVibePlugin;
	textInput: HTMLTextAreaElement;
	chatContainer: HTMLDivElement;
	filePillsContainer: HTMLDivElement;
	public attachedFiles: string[] = [];
	isLoading: boolean = false;
	conversationId: string | null = null;
	stopButton: HTMLButtonElement;
	initialFilePathFromState: string | null = null;
	wasInitiallyAttached: boolean = false;
	// Removed currentRequestController as it seems handled within callBackend now
	loadingIndicator: HTMLDivElement;

	// --- Slash Command State (Made public for utils & handlers) ---
	suggestions: RegistryEntry[] = [];
	activeSuggestionIndex: number = -1;
	suggestionsContainer: HTMLDivElement | null = null;
	currentTrigger: string | null = null;
	triggerStartIndex: number = -1;
	// --- End Slash Command State ---

	// --- Captured Selection State ---
	// capturedSelection: string | null = null; // <<< REMOVED
	capturedSelections: string[] = []; // <<< CHANGED to array
	// --- End Captured Selection State ---

	// --- State for Tracking Sent File Content ---
	sentFileContentRegistry: Set<string> = new Set(); // Stores "conversationId:filePath"
	// --- End State for Tracking Sent File Content ---

	// --- State for Tracking Applied Rules ---
	appliedRuleIds: Set<string> = new Set(); // Stores rule IDs applied in this conversation
	// --- End State for Tracking Applied Rules ---

	// --- Current API Request Controller ---
	abortController: AbortController | null = null; // For cancelling requests
	// --- End Current API Request Controller ---

	constructor(leaf: WorkspaceLeaf, plugin: ProVibePlugin) {
		super(leaf);
		this.plugin = plugin;
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
					// Call the aliased dom util function
					renderDomFilePills(this); // Pass the view instance
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
					// Call the aliased dom util function
					renderDomFilePills(this); // Pass the view instance
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
				// Call the aliased dom util function
				renderDomFilePills(this); // Pass the view instance
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
				rows: "3", // Start with 3 rows
			},
		});

		// Auto-Resizing Logic
		const adjustTextareaHeight = () => {
			const minRows = 3; // Minimum 3 rows
			const maxRows = 15;
			const inputEl = this.textInput;
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

		// Event Listeners (use imported handlers)
		clearButton.addEventListener("click", () => handleClear(this));
		sendButton.addEventListener("click", () => handleSend(this));
		this.stopButton.addEventListener("click", () => handleStop(this));
		this.textInput.addEventListener("input", () => handleInputChange(this));
		this.textInput.addEventListener("keydown", (e) =>
			handleInputKeydown(this, e)
		);
		this.textInput.addEventListener("click", () => handleInputChange(this));
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
				setDomSuggestions(this, []);
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
		);

		// Initial UI setup using imported functions
		addMessageToChat(this, "system", "Agent Ready"); // Pass view instance now
		renderDomFilePills(this); // Use aliased function

		// Focus the text input after the next frame renders
		requestAnimationFrame(() => {
			this.textInput.focus();
		});
	}

	// --- Event Handlers (REMOVED - now in eventHandlers.ts) ---

	// --- Backend Communication (Remains in the class, simplified) ---
	async callBackend(endpoint: string, payload: any) {
		console.log(`ProVibe: Calling ${endpoint} with payload:`, payload);
		setDomLoadingState(this, true); // Use aliased function
		try {
			// If there's an existing request, abort it
			if (this.abortController) {
				console.log("ProVibe: Aborting previous request...");
				this.abortController.abort();
			}

			// Create a new AbortController for this request
			this.abortController = new AbortController();
			const signal = this.abortController.signal;

			const response = await requestUrl({
				url: `${this.plugin.settings.backendUrl}${endpoint}`,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
				throw: false,
				// signal, // <<< REMOVED - requestUrl doesn't support AbortSignal directly
			});

			if (response.status >= 400) {
				throw new Error(
					`Backend error (${response.status}): ${response.text}`
				);
			}

			const responseData: BackendResponse = response.json;
			this.conversationId = responseData.conversation_id;

			// --- Handle Agent Message --- //
			if (responseData.agent_message) {
				const agentContent = responseData.agent_message.content;
				const hasToolCalls =
					responseData.tool_calls_prepared &&
					responseData.tool_calls_prepared.length > 0;

				if (agentContent && agentContent.trim() !== "") {
					// Display content if it's not empty
					addMessageToChat(this, "agent", agentContent);
				} else if (hasToolCalls) {
					// If content is empty but there are tools, show a placeholder
					addMessageToChat(
						this,
						"agent",
						"_(Performing requested action(s)...)_"
					);
				}
				// If content is empty and no tools, nothing is displayed for the agent turn
			}

			// --- Handle Tool Calls --- //
			if (
				responseData.tool_calls_prepared &&
				responseData.tool_calls_prepared.length > 0
			) {
				await this.processToolCalls(responseData.tool_calls_prepared);
			} else {
				setDomLoadingState(this, false); // Stop loading if no tools to process
			}
		} catch (error: any) {
			if (error.name === "AbortError") {
				console.log("ProVibe: Request aborted by user.");
				// No notice needed, as it was user-initiated
				addMessageToChat(this, "agent", "Generation stopped.");
			} else {
				console.error(`Error calling ${endpoint}:`, error);
				addMessageToChat(
					this,
					"system",
					`Error: ${error.message}`,
					true
				);
			}
			setDomLoadingState(this, false); // Use aliased function
		}
	}

	private async sendToolResults(results: ToolResult[]) {
		// Construct payload for /tool_result
		const payload: any = {
			tool_results: results,
			conversation_id: this.conversationId,
			// Model is determined by the ongoing conversation state on the backend,
			// no need to send it again here unless we want to support overriding mid-turn.
		};

		await this.callBackend("/tool_result", payload);
	}

	private async processToolCalls(
		toolCalls: BackendToolCall[]
	): Promise<void> {
		const results: ToolResult[] = [];
		// Identify all tools that require review (edits or replacements)
		const reviewToolCalls = toolCalls.filter(
			(tc) =>
				tc.tool === "editFile" ||
				tc.tool === "replaceSelectionInFile" ||
				tc.tool === "applyPatchesToFile"
		);
		// Identify other tools that run directly
		const otherToolCalls = toolCalls.filter(
			(tc) =>
				tc.tool !== "editFile" &&
				tc.tool !== "replaceSelectionInFile" &&
				tc.tool !== "applyPatchesToFile"
		);

		addMessageToChat(
			this,
			"system",
			`Agent requests ${toolCalls.length} action(s)...`
		);

		// Execute non-edit tools first
		for (const toolCall of otherToolCalls) {
			try {
				addMessageToChat(
					this,
					"system",
					`Executing ${toolCall.tool}...`
				);
				const result = await this.executeSingleTool(toolCall);
				results.push({ id: toolCall.id, result });
				addMessageToChat(
					this,
					"system",
					`Result for ${toolCall.tool}: ${JSON.stringify(
						result
					).substring(0, 100)}...`
				);
			} catch (error) {
				console.error(`Error executing tool ${toolCall.tool}:`, error);
				const errorMsg = `Failed to execute tool ${toolCall.tool}: ${error.message}`;
				results.push({
					id: toolCall.id,
					result: { error: errorMsg },
				});
				addMessageToChat(this, "system", errorMsg, true);
			}
		}

		// Handle tools requiring review
		if (reviewToolCalls.length > 0) {
			try {
				addMessageToChat(
					this,
					"system",
					`Review required for changes to ${reviewToolCalls
						.map((tc) => tc.params.path)
						.join(", ")}`
				);
				const editResults = await this.reviewAndExecuteEdits(
					reviewToolCalls
				);
				results.push(...editResults);
			} catch (error) {
				console.error("Error processing file edits:", error);
				const errorMsg = `Failed to process edits: ${error.message}`;
				reviewToolCalls.forEach((tc) => {
					results.push({
						id: tc.id,
						result: { error: errorMsg },
					});
				});
				addMessageToChat(this, "system", errorMsg, true);
			}
		}

		// Send all results back if any were generated
		if (results.length > 0) {
			await this.sendToolResults(results);
		} else {
			setDomLoadingState(this, false); // Stop loading if no results to send
		}
	}

	// --- Tool Execution (Uses imported tool implementations) ---

	private async reviewAndExecuteEdits(
		pendingEdits: BackendToolCall[]
	): Promise<ToolResult[]> {
		const results: ToolResult[] = [];
		for (const toolCall of pendingEdits) {
			try {
				const reviewResult = await this.displayDiffModalForReview(
					toolCall
				);

				// Check the 'applied' property from DiffReviewResult
				if (reviewResult.applied) {
					let executionResult: any;
					if (toolCall.tool === "editFile") {
						// Use the 'finalContent' property if available for editFile
						if (reviewResult.finalContent !== undefined) {
							addMessageToChat(
								this,
								"system",
								`Applying changes to ${toolCall.params.path}... (editFile)`
							);
							executionResult = await toolEditFile(
								this.app,
								toolCall.params.path,
								reviewResult.finalContent,
								toolCall.params.instructions
							);
						} else {
							throw new Error(
								"Edit applied but final content was missing."
							);
						}
					} else if (toolCall.tool === "replaceSelectionInFile") {
						addMessageToChat(
							this,
							"system",
							`Applying changes to ${toolCall.params.path}... (replaceSelectionInFile)`
						);
						// For replaceSelection, call the specific tool with its required params
						// It handles finding the selection and replacing internally
						executionResult = await toolReplaceSelectionInFile(
							this.app,
							toolCall.params.path,
							toolCall.params.original_selection,
							toolCall.params.new_content
						);
					} else if (toolCall.tool === "applyPatchesToFile") {
						// If approved, apply the finalContent generated during the successful simulation
						if (reviewResult.finalContent !== undefined) {
							addMessageToChat(
								this,
								"system",
								`Applying changes to ${toolCall.params.path}... (applyPatchesToFile)`
							);
							const file = this.app.vault.getAbstractFileByPath(
								toolCall.params.path
							);
							if (file instanceof TFile) {
								try {
									await this.app.vault.modify(
										file,
										reviewResult.finalContent
									);
									executionResult = `Successfully applied patches to ${toolCall.params.path}`;
									new Notice(executionResult);
								} catch (e) {
									console.error(
										"Error applying simulated patch content:",
										e
									);
									executionResult = {
										error: `Failed to write patched file: ${e.message}`,
									};
								}
							} else {
								executionResult = {
									error: `Target file not found or invalid: ${toolCall.params.path}`,
								};
							}
						} else {
							// This shouldn't happen if simulation succeeded, but handle defensively
							executionResult = {
								error: "Edit applied but final patch content was missing.",
							};
							console.error(
								"Patch review approved, but finalContent missing from reviewResult."
							);
						}
					} else {
						// Should not happen if filtering in processToolCalls is correct
						throw new Error(
							`Unhandled tool type in reviewAndExecuteEdits: ${toolCall.tool}`
						);
					}

					// Common result handling
					results.push({
						id: toolCall.id,
						result: executionResult,
					});
					new Notice(
						`File ${toolCall.params.path} updated via ${toolCall.tool}.`
					);
				} else {
					results.push({
						id: toolCall.id,
						result: { message: reviewResult.message }, // Use message from result
					});
					addMessageToChat(this, "system", reviewResult.message);
					new Notice("Edit rejected.");
				}
			} catch (error) {
				console.error(
					`Error processing edit for ${toolCall.params.path}:`,
					error
				);
				const errorMsg = `Failed to apply edit: ${error.message}`;
				results.push({
					id: toolCall.id,
					result: { error: errorMsg },
				});
				addMessageToChat(this, "system", errorMsg, true);
				new Notice(`Error applying edit to ${toolCall.params.path}.`);
			}
		}
		return results;
	}

	private displayDiffModalForReview(
		toolCall: BackendToolCall
	): Promise<DiffReviewResult> {
		return new Promise(async (resolve) => {
			// Extract common parameters
			const { path, instructions } = toolCall.params;
			const targetPath = path.startsWith("./") ? path.substring(2) : path;
			let proposedContent = "";
			let originalContent = "";
			const file = this.app.vault.getAbstractFileByPath(targetPath);
			let simulationErrors: string[] = []; // Store simulation errors

			try {
				// Wrap file reading and content generation in try-catch
				if (file instanceof TFile) {
					originalContent = await this.app.vault.read(file);
				} else {
					originalContent = ""; // Treat as new file creation
				}

				// Determine proposed content based on the tool type
				if (toolCall.tool === "editFile") {
					proposedContent = toolCall.params.code_edit || ""; // Assuming code_edit holds the full proposed content
				} else if (toolCall.tool === "replaceSelectionInFile") {
					const { original_selection, new_content } = toolCall.params;
					if (!originalContent.includes(original_selection)) {
						// If original selection isn't found, maybe show modal with error or just the new content?
						// For now, let's show the diff against the original, highlighting the intended change might fail.
						console.warn(
							`Original selection for replaceSelectionInFile not found in ${targetPath}. Diff may be inaccurate.`
						);
						// Fallback: show the new content as the proposed change for review, although tool execution might fail later.
						// Alternatively, we could reject here? Let's show the diff for now.
						proposedContent = originalContent.replace(
							original_selection,
							new_content
						);
					} else {
						proposedContent = originalContent.replace(
							original_selection,
							new_content
						);
					}
				} else if (toolCall.tool === "applyPatchesToFile") {
					const patches = toolCall.params.patches as Patch[];
					if (!Array.isArray(patches)) {
						throw new Error(
							"Invalid patches data for applyPatchesToFile."
						);
					}
					// Simulate applying patches to get proposed content
					let simulatedContent = originalContent;
					for (const patch of patches) {
						const before = patch.before ?? "";
						const oldText = patch.old;
						const after = patch.after ?? "";
						const newText = patch.new;
						const contextString = before + oldText + after;
						if (!contextString) continue; // Skip empty context
						const contextIndex =
							simulatedContent.indexOf(contextString);
						if (contextIndex === -1) {
							console.error(
								`Context not found during simulation. Searching for:\n${JSON.stringify(
									contextString
								)}\nin content:\n${JSON.stringify(
									simulatedContent
								)}`
							);
							console.warn(
								`Context for patch not found during simulation: ${JSON.stringify(
									patch
								)}`
							);
							simulationErrors.push(
								"Context not found for patch."
							); // Record error
							continue;
						}
						// Simple ambiguity check for simulation
						if (
							simulatedContent.indexOf(
								contextString,
								contextIndex + 1
							) !== -1
						) {
							console.warn(
								`Ambiguous context for patch found during simulation: ${JSON.stringify(
									patch
								)}`
							);
							simulationErrors.push(
								"Ambiguous context for patch."
							); // Record error
							continue;
						}
						const startIndex = contextIndex + before.length;
						const endIndex = startIndex + oldText.length;
						simulatedContent =
							simulatedContent.substring(0, startIndex) +
							newText +
							simulatedContent.substring(endIndex);
					}
					proposedContent = simulatedContent;
				} else {
					// Handle unexpected tool types if necessary, though filtering should prevent this
					proposedContent = `Error: Unexpected tool type '${toolCall.tool}' for diff review.`;
				}

				// Check for simulation errors before opening modal
				if (simulationErrors.length > 0) {
					console.error(
						"Simulation failed, cannot show diff modal reliably.",
						simulationErrors
					);
					resolve({
						applied: false,
						message: `Could not apply patches due to context errors: ${simulationErrors.join(
							", "
						)}`,
						finalContent: originalContent, // Return original content
						toolCallId: toolCall.id,
					});
					return; // Stop before opening modal
				}

				// Call constructor with all 8 arguments
				new DiffReviewModal(
					this.app,
					this.plugin, // Pass plugin instance
					targetPath,
					originalContent,
					proposedContent, // Use the determined proposed content
					instructions,
					toolCall.id,
					(result: DiffReviewResult) => {
						// Add type to result
						resolve(result);
					}
				).open();
			} catch (error) {
				console.error(
					`Error preparing data for DiffReviewModal for ${targetPath}:`,
					error
				);
				// Log the original content and tool call on error for debugging
				console.log(
					"Original Content during error:",
					JSON.stringify(originalContent)
				);
				console.log(
					"Tool Call during error:",
					JSON.stringify(toolCall)
				);
				// Resolve the promise with a rejected state if we can't even show the modal
				resolve({
					applied: false,
					message: `Error preparing diff review: ${error.message}`,
					finalContent: originalContent, // Return original content on error
					toolCallId: toolCall.id,
				});
			}
		});
	}

	private async executeSingleTool(toolCall: BackendToolCall): Promise<any> {
		switch (toolCall.tool) {
			case "readFile": // Match tool name from backend
				return await toolReadFile(this.app, toolCall.params.path);
			case "replaceSelectionInFile": // <<< KEPT CASE (but now also goes through review)
				// This case should ideally not be hit directly anymore if filtering is correct,
				// but kept for safety. Review logic handles execution.
				console.warn(
					"executeSingleTool called for replaceSelectionInFile - should go through review."
				);
				// Fallback to direct execution if somehow called directly (not ideal)
				return await toolReplaceSelectionInFile(
					this.app,
					toolCall.params.path,
					toolCall.params.original_selection,
					toolCall.params.new_content
				);
			default:
				throw new Error(
					`Unknown or unsupported tool for direct execution: ${toolCall.tool}`
				);
		}
	}

	// --- Lifecycle Methods ---

	async onClose() {
		// Any cleanup needed when the view is closed
	}

	// --- Helper Methods (REMOVED) ---

	// --- Slash Command Methods (REMOVED) ---
}
