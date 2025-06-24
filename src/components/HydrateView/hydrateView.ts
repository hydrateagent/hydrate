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
import HydratePlugin from "../../main"; // Corrected path to be relative to current dir
import { DiffReviewModal, DiffReviewResult } from "../DiffReviewModal"; // Corrected path (assuming same dir as view)
import { ReactViewHost } from "../../ReactViewHost"; // Corrected path
import { RegistryEntry, Patch } from "../../types"; // Corrected path
import {
	toolReadFile,
	toolEditFile,
	toolReplaceSelectionInFile,
	applyPatchesToFile,
	toolUpdateHydrateManifest,
} from "./toolImplementations"; // Ensure this path is correct for your setup
import { handleSearchProject } from "../../toolHandlers"; // <<< ADD THIS IMPORT
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

export const HYDRATE_VIEW_TYPE = "hydrate-view";

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

interface MCPToolInfo {
	server_id: string;
	server_name: string;
	is_mcp_tool: boolean;
}

interface BackendToolCall {
	action: "tool_call";
	tool: string;
	params: any;
	id: string; // Tool call ID from the agent
	mcp_info?: MCPToolInfo; // Optional MCP routing information
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

export class HydrateView extends ItemView {
	plugin: HydratePlugin;
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

	constructor(leaf: WorkspaceLeaf, plugin: HydratePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return HYDRATE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Hydrate";
	}

	async setState(state: any, result: ViewStateResult): Promise<void> {
		console.log("HydrateView setState called with state:", state);
		let fileToAttachPath: string | null = null;

		if (state?.sourceFilePath) {
			fileToAttachPath = state.sourceFilePath;
			console.log(
				"HydrateView setState: Captured sourceFilePath:",
				fileToAttachPath
			);
		} else {
			console.log(
				"HydrateView setState: No sourceFilePath found in state."
			);
		}

		await super.setState(state, result);

		if (fileToAttachPath && this.attachedFiles.length === 0) {
			console.log(
				"Hydrate [setState]: Attempting to auto-attach file from state:",
				fileToAttachPath
			);
			this.attachInitialFile(fileToAttachPath);
		} else if (fileToAttachPath && this.attachedFiles.length > 0) {
			console.log(
				"Hydrate [setState]: Files already attached, skipping auto-attach from state."
			);
		}
	}

	public attachInitialFile(filePath: string) {
		console.log("Hydrate [attachInitialFile]: Trying to attach:", filePath);
		console.log(
			"Hydrate [attachInitialFile]: Current attachedFiles BEFORE attach:",
			[...this.attachedFiles]
		);

		if (filePath && !this.attachedFiles.includes(filePath)) {
			const fileExists =
				this.app.vault.getAbstractFileByPath(filePath) instanceof TFile;
			if (fileExists) {
				console.log(
					`Hydrate [attachInitialFile]: Attaching ${filePath}...`
				);
				this.attachedFiles = [filePath];
				this.initialFilePathFromState = filePath;
				this.wasInitiallyAttached = true;
				console.log(
					"Hydrate [attachInitialFile]: attachedFiles after push:",
					[...this.attachedFiles]
				);
				if (this.filePillsContainer) {
					// Call the aliased dom util function
					renderDomFilePills(this); // Pass the view instance
				}
			} else {
				console.warn(
					`Hydrate [attachInitialFile]: File path '${filePath}' does not exist or is not a TFile. Not attaching.`
				);
			}
		} else if (filePath && this.attachedFiles.includes(filePath)) {
			console.log(
				`Hydrate [attachInitialFile]: File ${filePath} already attached.`
			);
		} else {
			console.log(
				"Hydrate [attachInitialFile]: File path variable was null/empty."
			);
		}
	}

	// --- File Change Handling ---

	public handleActiveFileChange(newFilePath: string | null) {
		// Determine the key for tracking this file's content inclusion
		const trackingKey = this.conversationId
			? `${this.conversationId}:${newFilePath}`
			: null;

		// Only auto-attach if:
		// 1. A file is active (newFilePath is not null)
		// 2. No files are currently attached (empty array)
		// 3. The file content hasn't been sent for this conversation yet
		if (
			newFilePath &&
			this.attachedFiles.length === 0 &&
			trackingKey &&
			!this.sentFileContentRegistry.has(trackingKey)
		) {
			console.log(
				`Hydrate [handleActiveFileChange]: Auto-attaching active file: ${newFilePath}`
			);
			this.attachedFiles = [newFilePath];

			if (this.filePillsContainer) {
				// Call the aliased dom util function
				renderDomFilePills(this); // Pass the view instance
			}
		} else if (newFilePath) {
			// Log why we didn't auto-attach
			if (this.attachedFiles.length > 0) {
				console.log(
					`Hydrate [handleActiveFileChange]: Not auto-attaching ${newFilePath} because files are already attached: ${this.attachedFiles}`
				);
			} else if (
				trackingKey &&
				this.sentFileContentRegistry.has(trackingKey)
			) {
				console.log(
					`Hydrate [handleActiveFileChange]: Not auto-attaching ${newFilePath} because its content was already sent in this conversation`
				);
			}
		} else {
			console.log(
				"Hydrate [handleActiveFileChange]: No active file to auto-attach."
			);
		}
	}

	// --- UI Creation and Event Binding ---

	async onOpen(): Promise<void> {
		console.log("HydrateView opening...");

		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("hydrate-view");

		// Apply pane styles
		const styleEl = document.createElement("style");
		styleEl.textContent = `
			.hydrate-view {
				display: flex;
				flex-direction: column;
				height: 100%;
				padding: 10px;
				box-sizing: border-box;
			}
			.hydrate-chat-container {
				flex: 1;
				overflow-y: auto;
				margin-bottom: 10px;
				border: 1px solid var(--background-modifier-border);
				border-radius: 5px;
				padding: 10px;
				background: var(--background-primary);
			}
			.hydrate-input-section {
				display: flex;
				flex-direction: column;
				gap: 10px;
			}
			.hydrate-file-pills {
				display: flex;
				flex-wrap: wrap;
				gap: 5px;
				min-height: 20px;
			}
			.hydrate-input-container {
				display: flex;
				gap: 10px;
				align-items: flex-end;
			}
			.hydrate-textarea {
				flex: 1;
				min-height: 40px;
				max-height: 200px;
				resize: vertical;
				padding: 8px;
				border: 1px solid var(--background-modifier-border);
				border-radius: 5px;
				background: var(--background-primary);
				color: var(--text-normal);
				font-family: var(--font-text);
			}
			.hydrate-button {
				padding: 8px 16px;
				background: var(--interactive-accent);
				color: var(--text-on-accent);
				border: none;
				border-radius: 5px;
				cursor: pointer;
				font-size: 14px;
			}
			.hydrate-button:hover {
				background: var(--interactive-accent-hover);
			}
			.hydrate-button:disabled {
				background: var(--background-modifier-border);
				cursor: not-allowed;
			}
		`;
		document.head.appendChild(styleEl);

		// Auto-adjust textarea height based on content
		const adjustTextareaHeight = () => {
			this.textInput.style.height = "auto";
			this.textInput.style.height = this.textInput.scrollHeight + "px";
		};

		// Create chat container
		this.chatContainer = container.createEl("div", {
			cls: "hydrate-chat-container",
		});

		// Create input section
		const inputSection = container.createEl("div", {
			cls: "hydrate-input-section",
		});

		// Create file pills container
		this.filePillsContainer = inputSection.createEl("div", {
			cls: "hydrate-file-pills",
		});

		// Create input container
		const inputContainer = inputSection.createEl("div", {
			cls: "hydrate-input-container",
		});

		// Create textarea
		this.textInput = inputContainer.createEl("textarea", {
			cls: "hydrate-textarea",
			attr: { placeholder: "Ask a question or request an action..." },
		});

		// Create send button
		const sendButton = inputContainer.createEl("button", {
			cls: "hydrate-button",
			text: "Send",
		});

		// Create stop button (initially hidden)
		this.stopButton = inputContainer.createEl("button", {
			cls: "hydrate-button",
			text: "Stop",
		});
		this.stopButton.style.display = "none";

		// Create clear button
		const clearButton = inputContainer.createEl("button", {
			cls: "hydrate-button",
			text: "Clear",
		});

		// Create loading indicator
		this.loadingIndicator = this.chatContainer.createEl("div", {
			cls: "hydrate-loading",
			text: "Processing...",
		});
		this.loadingIndicator.style.display = "none";

		// Bind event handlers using imported functions
		this.textInput.addEventListener("input", () => handleInputChange(this));
		this.textInput.addEventListener("keydown", (e) =>
			handleInputKeydown(this, e)
		);
		sendButton.addEventListener("click", () => handleSend(this));
		clearButton.addEventListener("click", () => handleClear(this));
		this.stopButton.addEventListener("click", () => handleStop(this));

		// Add drag and drop support
		container.addEventListener("dragover", (e) => e.preventDefault());
		container.addEventListener("drop", (e) =>
			handleDrop(this, e as DragEvent)
		);

		// Auto-adjust textarea height on input
		this.textInput.addEventListener("input", adjustTextareaHeight);

		// Initialize with current active file if available
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			this.handleActiveFileChange(activeFile.path);
		}

		console.log("HydrateView opened successfully");
	}

	// --- Backend Communication ---

	async callBackend(endpoint: string, payload: any) {
		console.log(`Calling backend: ${endpoint}`, payload);

		// Cancel any existing request
		if (this.abortController) {
			this.abortController.abort();
		}

		// Create new abort controller for this request
		this.abortController = new AbortController();

		try {
			const response = await requestUrl({
				url: `${this.plugin.settings.backendUrl}${endpoint}`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-API-Key": this.plugin.settings.apiKey,
				},
				body: JSON.stringify(payload),
				throw: false, // Don't throw on HTTP errors, handle them manually
			});

			// Reset abort controller after successful completion
			this.abortController = null;

			if (response.status >= 400) {
				throw new Error(
					`HTTP ${response.status}: ${
						response.text || "Unknown error"
					}`
				);
			}

			const responseData: BackendResponse = response.json;

			console.log("Backend response:", responseData);

			// Update conversation ID from response
			if (responseData.conversation_id) {
				this.conversationId = responseData.conversation_id;
			}

			// Check for tool calls that need to be processed
			if (
				responseData.tool_calls_prepared &&
				responseData.tool_calls_prepared.length > 0
			) {
				console.log(
					"Tool calls detected:",
					responseData.tool_calls_prepared
				);
				await this.processToolCalls(responseData.tool_calls_prepared);
			} else {
				// No tool calls, just display the agent message
				if (responseData.agent_message) {
					addMessageToChat(
						this,
						"agent",
						responseData.agent_message.content
					);
				}
				setDomLoadingState(this, false);
			}
		} catch (error: any) {
			// Reset abort controller on error
			this.abortController = null;

			if (error.name === "AbortError") {
				console.log("Request was cancelled");
				addMessageToChat(this, "agent", "Request cancelled by user.");
			} else {
				console.error("Backend call failed:", error);
				new Notice(`Backend error: ${error.message}`);
				addMessageToChat(this, "agent", `Error: ${error.message}`);
			}
			setDomLoadingState(this, false);
		}
	}

	private async sendToolResults(results: ToolResult[]) {
		// Collect MCP tools from running servers
		let mcpTools: any[] = [];
		if (this.plugin.mcpManager) {
			try {
				console.log(
					"[sendToolResults] MCP Manager found, checking servers..."
				);
				console.log(
					"[sendToolResults] Number of servers:",
					this.plugin.mcpManager.getServerCount()
				);
				console.log(
					"[sendToolResults] Server statuses:",
					this.plugin.mcpManager.getServerStatuses()
				);

				mcpTools = await this.plugin.mcpManager.getAllDiscoveredTools();
				console.log(
					`[sendToolResults] Collected ${mcpTools.length} MCP tools for backend:`,
					mcpTools
				);
			} catch (error) {
				console.warn(
					"Error collecting MCP tools for tool result:",
					error
				);
			}
		} else {
			console.warn("[sendToolResults] No MCP Manager found!");
		}

		const payload: any = {
			tool_results: results,
			conversation_id: this.conversationId,
			mcp_tools: mcpTools, // Include MCP tools in tool result request
		};

		console.log("[sendToolResults] Calling backend: /tool_result", payload);
		await this.callBackend("/tool_result", payload);
	}

	private async processToolCalls(
		toolCalls: BackendToolCall[]
	): Promise<void> {
		console.log(`Processing ${toolCalls.length} tool call(s)`);

		// Add tool call indication to chat for each tool being called
		for (const toolCall of toolCalls) {
			const toolDisplayName = toolCall.mcp_info?.server_name
				? `${toolCall.tool} (${toolCall.mcp_info.server_name})`
				: toolCall.tool;
			addMessageToChat(
				this,
				"system",
				`🔧 Calling tool: ${toolDisplayName}`
			);
		}

		// Separate tool calls that need review from those that can execute directly
		const editToolCalls = toolCalls.filter((call) =>
			[
				"editFile",
				"replaceSelectionInFile",
				"applyPatchesToFile",
			].includes(call.tool)
		);
		const otherToolCalls = toolCalls.filter(
			(call) =>
				![
					"editFile",
					"replaceSelectionInFile",
					"applyPatchesToFile",
				].includes(call.tool)
		);

		const results: ToolResult[] = [];

		// Process edit tools through review modal
		if (editToolCalls.length > 0) {
			console.log(
				`Processing ${editToolCalls.length} edit tool call(s) through review modal`
			);
			try {
				const editResults = await this.reviewAndExecuteEdits(
					editToolCalls
				);
				results.push(...editResults);
			} catch (error) {
				console.error("Error processing edit tools:", error);
				// Add error results for failed edit tools
				for (const call of editToolCalls) {
					results.push({
						id: call.id,
						result: `Error: ${
							error instanceof Error
								? error.message
								: String(error)
						}`,
					});
				}
			}
		}

		// Process other tools directly
		for (const toolCall of otherToolCalls) {
			try {
				console.log(`Executing tool: ${toolCall.tool}`);
				const result = await this.executeSingleTool(toolCall);
				results.push({ id: toolCall.id, result });
				console.log(`Tool ${toolCall.tool} completed successfully`);
			} catch (error) {
				console.error(`Error executing tool ${toolCall.tool}:`, error);
				results.push({
					id: toolCall.id,
					result: `Error: ${
						error instanceof Error ? error.message : String(error)
					}`,
				});
			}
		}

		// Send all results back to backend
		console.log(`Sending ${results.length} tool result(s) to backend`);
		await this.sendToolResults(results);
	}

	private async reviewAndExecuteEdits(
		pendingEdits: BackendToolCall[]
	): Promise<ToolResult[]> {
		const results: ToolResult[] = [];

		for (const toolCall of pendingEdits) {
			try {
				console.log(`Reviewing edit for tool: ${toolCall.tool}`);

				// Show diff modal for review
				const reviewResult = await this.displayDiffModalForReview(
					toolCall
				);

				if (reviewResult.applied) {
					console.log(
						`Edit approved and applied for tool: ${toolCall.tool}`
					);
					// If the modal applied the changes, use the final content as the result
					results.push({
						id: toolCall.id,
						result: `Successfully applied changes to ${
							toolCall.params.path
						}. ${reviewResult.message || ""}`,
					});
				} else {
					console.log(
						`Edit rejected for tool: ${toolCall.tool}. Reason: ${reviewResult.message}`
					);
					// If the user rejected the changes, return an error result
					results.push({
						id: toolCall.id,
						result: `Edit rejected: ${
							reviewResult.message || "User declined changes"
						}`,
					});
				}
			} catch (error) {
				console.error(
					`Error in review process for ${toolCall.tool}:`,
					error
				);
				results.push({
					id: toolCall.id,
					result: `Error during review: ${
						error instanceof Error ? error.message : String(error)
					}`,
				});
			}
		}

		return results;
	}

	private displayDiffModalForReview(
		toolCall: BackendToolCall
	): Promise<DiffReviewResult> {
		return new Promise(async (resolve) => {
			console.log(`Preparing diff modal for tool: ${toolCall.tool}`);

			// Determine the target file path
			const targetPath = toolCall.params.path;
			const instructions =
				toolCall.params.instructions ||
				`Apply ${toolCall.tool} to ${targetPath}`;

			// Prepare content based on tool type
			let originalContent = "";
			let proposedContent = "";
			const simulationErrors: string[] = [];

			try {
				// Wrap file reading and content generation in try-catch
				const file = this.app.vault.getAbstractFileByPath(targetPath);
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
						// Simple ambiguity check for simulation - only if context is not empty
						if (
							contextString &&
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
		// Check if this is an MCP tool
		if (toolCall.mcp_info && toolCall.mcp_info.is_mcp_tool) {
			return await this.executeMCPTool(toolCall);
		}

		// Handle native tools
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
			case "search_project": // <<< ADD THIS CASE
				return await handleSearchProject(
					toolCall,
					this.app,
					this.plugin.settings
				);
			case "update_hydrate_manifest":
				return await toolUpdateHydrateManifest(
					this.plugin, // Pass the plugin instance
					toolCall.params
				);
			default:
				throw new Error(
					`Unknown or unsupported tool for direct execution: ${toolCall.tool}`
				);
		}
	}

	private async executeMCPTool(toolCall: BackendToolCall): Promise<any> {
		console.log(`Executing MCP tool: ${toolCall.tool}`, toolCall.mcp_info);

		if (!toolCall.mcp_info) {
			throw new Error("MCP tool call missing routing information");
		}

		// Check if MCPServerManager is available
		if (!this.plugin.mcpManager) {
			throw new Error("MCP Server Manager not available");
		}

		try {
			// Validate parameters
			if (!toolCall.params || typeof toolCall.params !== "object") {
				throw new Error("Invalid parameters for MCP tool call");
			}

			// Execute the tool via MCPServerManager
			const result = await this.plugin.mcpManager.executeToolCall(
				toolCall.mcp_info.server_id,
				toolCall.tool,
				toolCall.params
			);

			console.log(
				`MCP tool ${toolCall.tool} executed successfully:`,
				result
			);
			return result;
		} catch (error) {
			console.error(
				`MCP tool execution failed for ${toolCall.tool}:`,
				error
			);

			// Provide more specific error messages
			if (error instanceof Error) {
				if (error.message.includes("Server not found")) {
					throw new Error(
						`MCP server '${toolCall.mcp_info.server_name}' (${toolCall.mcp_info.server_id}) is not available. Please check server configuration.`
					);
				} else if (error.message.includes("Tool not found")) {
					throw new Error(
						`Tool '${toolCall.tool}' not found on MCP server '${toolCall.mcp_info.server_name}'. The tool may have been removed or the server may need to be restarted.`
					);
				} else if (error.message.includes("timeout")) {
					throw new Error(
						`MCP tool '${toolCall.tool}' timed out. The operation may be taking longer than expected.`
					);
				}
			}

			throw new Error(
				`MCP tool execution failed: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
	}

	// --- Lifecycle Methods ---

	async onClose() {
		// Cancel any pending requests
		if (this.abortController) {
			this.abortController.abort();
		}
		// Any cleanup needed when the view is closed
	}

	// --- Helper Methods (REMOVED) ---

	// --- Slash Command Methods (REMOVED) ---
}
