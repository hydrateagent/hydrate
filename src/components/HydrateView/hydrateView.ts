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
import { RegistryEntry, Patch, ChatHistory, ChatTurn } from "../../types"; // Corrected path
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
import { ChatHistoryModal } from "./ChatHistoryModal";

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

	// --- Note Search State (for [[ note linking) ---
	noteSearchActive: boolean = false;
	noteSearchResults: TFile[] = [];
	noteSearchQuery: string = "";
	noteSearchStartIndex: number = -1;
	// --- End Note Search State ---

	// --- Input State Tracking ---
	lastInputLength: number = 0;
	isDeleting: boolean = false;
	// --- End Input State Tracking ---

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

	// --- Chat History State ---
	currentChatTurns: ChatTurn[] = []; // Track current conversation turns
	currentChatId: string | null = null; // ID of current saved chat if loaded from history
	isRestoringFromHistory: boolean = false; // Flag to prevent duplicate tracking during restoration

	// Chat Context Suggestions Properties
	suggestedNotes: Array<{ filePath: string; score: number; reason: string }> =
		[];
	suggestionPillsContainer: HTMLDivElement | null = null;
	lastSuggestionRefresh: number = 0; // Timestamp to avoid too frequent refreshes
	activePopup: HTMLDivElement | null = null; // Track active popup
	// --- End Chat History State ---

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

	getIcon(): string {
		return "droplet";
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
		if (!newFilePath) {
			console.log(
				"Hydrate [handleActiveFileChange]: No active file to auto-attach."
			);
			return;
		}

		// Auto-attach the new active file if:
		// 1. There are no files currently attached, OR
		// 2. There's only one file attached and it was initially attached (not manually added)
		const shouldAutoAttach =
			this.attachedFiles.length === 0 ||
			(this.attachedFiles.length === 1 && this.wasInitiallyAttached);

		if (shouldAutoAttach && !this.attachedFiles.includes(newFilePath)) {
			console.log(
				`Hydrate [handleActiveFileChange]: Auto-attaching active file: ${newFilePath}`
			);
			this.attachedFiles = [newFilePath];
			this.wasInitiallyAttached = true;

			if (this.filePillsContainer) {
				// Call the aliased dom util function
				renderDomFilePills(this); // Pass the view instance
			}
		} else {
			// Log why we didn't auto-attach
			if (this.attachedFiles.includes(newFilePath)) {
				console.log(
					`Hydrate [handleActiveFileChange]: File ${newFilePath} is already attached`
				);
			} else if (this.attachedFiles.length > 1) {
				console.log(
					`Hydrate [handleActiveFileChange]: Not auto-attaching ${newFilePath} because multiple files are manually attached: ${this.attachedFiles}`
				);
			} else if (
				this.attachedFiles.length === 1 &&
				!this.wasInitiallyAttached
			) {
				console.log(
					`Hydrate [handleActiveFileChange]: Not auto-attaching ${newFilePath} because a file was manually attached: ${this.attachedFiles}`
				);
			}
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
				gap: 6px;
				min-height: 20px;
			}
			.hydrate-file-pill {
				background: linear-gradient(135deg, var(--color-blue-rgb), var(--color-cyan-rgb));
				color: var(--text-normal);
				padding: 3px 8px;
				border-radius: 12px;
				font-size: 11px;
				border: none;
				transition: all 0.2s ease;
				box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
				position: relative;
				overflow: hidden;
				line-height: 1.2;
				display: flex;
				align-items: center;
				gap: 4px;
				height: 20px;
				max-width: 200px;
			}
			.hydrate-file-pill:hover {
				transform: translateY(-1px);
				box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
				filter: brightness(1.1);
			}
			.hydrate-pill-text {
				flex: 1;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}
			.hydrate-pill-remove {
				background: transparent !important;
				border: none !important;
				outline: none !important;
				box-shadow: none !important;
				color: var(--text-normal);
				padding: 1px 4px;
				border-radius: 0 !important;
				font-size: 10px;
				cursor: pointer;
				transition: all 0.2s ease;
				line-height: 1;
				display: flex;
				align-items: center;
				justify-content: center;
				min-width: 14px;
				height: 14px;
			}
			.hydrate-pill-remove:hover {
				background: transparent !important;
				outline: none !important;
				box-shadow: none !important;
				border: none !important;
				transform: scale(1.1);
				opacity: 0.7;
			}
			.hydrate-pill-remove:focus {
				background: transparent !important;
				outline: none !important;
				box-shadow: none !important;
				border: none !important;
			}
			.hydrate-suggestion-pills {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
				margin-bottom: 10px;
				padding: 8px 0;
				border-bottom: 1px solid var(--background-modifier-border);
				min-height: 0;
				transition: all 0.2s ease;
			}
			.hydrate-suggestion-pills:empty {
				display: none;
			}
			.hydrate-suggestion-pill {
				background: linear-gradient(135deg, var(--color-blue-rgb), var(--color-cyan-rgb));
				color: var(--text-normal);
				padding: 3px 8px;
				border-radius: 12px;
				font-size: 11px;
				cursor: pointer;
				border: none;
				transition: all 0.2s ease;
				box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
				position: relative;
				overflow: hidden;
				line-height: 1.2;
				display: flex;
				align-items: center;
				height: 20px;
				max-width: 200px;
				white-space: nowrap;
				text-overflow: ellipsis;
			}
			.hydrate-suggestion-pill:before {
				content: "";
				margin-right: 0;
			}
			.hydrate-suggestion-pill:hover {
				transform: translateY(-1px);
				box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
				filter: brightness(1.1);
			}
			.hydrate-suggestion-pill:active {
				transform: translateY(0);
				box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
			}
			.hydrate-input-container {
				position: relative;
				width: 100%;
			}
			.hydrate-textarea {
				width: 100%;
				min-height: 120px;
				max-height: 300px;
				resize: vertical;
				padding: 12px 120px 12px 12px;
				border: 1px solid var(--background-modifier-border);
				border-radius: 8px;
				background: var(--background-primary);
				color: var(--text-normal);
				font-family: var(--font-text);
				font-size: 14px;
				line-height: 1.4;
				box-sizing: border-box;
			}
			.hydrate-button-overlay {
				position: absolute;
				bottom: 8px;
				right: 8px;
				display: flex;
				gap: 4px;
				align-items: center;
			}
			.hydrate-overlay-button {
				background: var(--background-secondary);
				border: none;
				color: var(--text-muted);
				padding: 6px 12px;
				border-radius: 6px;
				font-size: 12px;
				cursor: pointer;
				transition: all 0.2s;
				opacity: 0.8;
				box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
				white-space: nowrap;
			}
			.hydrate-overlay-button:hover {
				background: var(--background-modifier-hover);
				color: var(--text-normal);
				opacity: 1;
				box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);
			}
			.hydrate-overlay-button:active {
				transform: translateY(1px);
				box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
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
			.hydrate-chat-history-controls {
				display: flex;
				gap: 5px;
				justify-content: flex-end;
				margin-bottom: 5px;
			}
			.hydrate-icon-button {
				width: 32px;
				height: 32px;
				padding: 4px;
				display: flex;
				align-items: center;
				justify-content: center;
				font-size: 16px;
				line-height: 1;
			}
			.chat-preview {
				font-style: italic;
				opacity: 0.7;
			}
			.chat-history-delete-button {
				background: transparent;
				border: 1px solid var(--background-modifier-border);
				color: var(--text-muted);
				padding: 4px 8px;
				border-radius: 3px;
				cursor: pointer;
				font-size: 12px;
				line-height: 1;
				transition: all 0.2s;
				flex-shrink: 0;
			}
			.chat-history-delete-button:hover {
				background: var(--background-modifier-error);
				color: var(--text-error);
				border-color: var(--background-modifier-error);
			}
			.hydrate-drag-over {
				background: var(--background-modifier-active);
				border: 2px dashed var(--text-accent);
				border-radius: 8px;
			}
			
			/* Chat message styling improvements */
			.hydrate-message {
				overflow: hidden;
				word-wrap: break-word;
				box-sizing: border-box;
			}
			
			/* Ensure all content within agent messages stays contained */
			.hydrate-agent-message * {
				max-width: 100%;
				box-sizing: border-box;
			}
			
			/* Fix ordered and unordered lists in chat bubbles */
			.hydrate-agent-message ol,
			.hydrate-agent-message ul {
				margin: 0.5em 0;
				padding-left: 1.5em;
				box-sizing: border-box;
				overflow: hidden;
			}
			
			.hydrate-agent-message li {
				margin: 0.25em 0;
				word-wrap: break-word;
				overflow-wrap: break-word;
			}
			
			/* Fix paragraphs and other block elements */
			.hydrate-agent-message p {
				margin: 0.5em 0;
				word-wrap: break-word;
				overflow-wrap: break-word;
			}
			
			/* Fix code blocks */
			.hydrate-agent-message pre {
				overflow-x: auto;
				max-width: 100%;
				box-sizing: border-box;
			}
			
			.hydrate-agent-message code {
				word-wrap: break-word;
				overflow-wrap: break-word;
			}
			
			/* Fix headings */
			
			/* Reusable popup component */
			.hydrate-popup {
				position: absolute;
				background: var(--background-primary);
				border: 1px solid var(--background-modifier-border);
				border-radius: 8px;
				box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
				z-index: 1000;
				padding: 8px;
				display: flex;
				gap: 8px;
				min-width: 200px;
			}
			
			.hydrate-popup-button {
				background: var(--background-secondary);
				border: 1px solid var(--background-modifier-border);
				color: var(--text-normal);
				padding: 8px 12px;
				border-radius: 4px;
				cursor: pointer;
				font-size: 12px;
				transition: all 0.2s;
				flex: 1;
				text-align: center;
			}
			
			.hydrate-popup-button:hover {
				background: var(--background-modifier-hover);
				border-color: var(--text-accent);
			}
			
			.hydrate-popup-button:active {
				transform: translateY(1px);
			}
			.hydrate-agent-message h1,
			.hydrate-agent-message h2,
			.hydrate-agent-message h3,
			.hydrate-agent-message h4,
			.hydrate-agent-message h5,
			.hydrate-agent-message h6 {
				margin: 0.5em 0;
				word-wrap: break-word;
				overflow-wrap: break-word;
			}
			
			/* Fix links to prevent overflow */
			.hydrate-agent-message a {
				word-wrap: break-word;
				overflow-wrap: break-word;
				text-decoration: underline;
			}
		`;
		document.head.appendChild(styleEl);

		// Auto-adjust textarea height based on content
		const adjustTextareaHeight = () => {
			this.textInput.style.height = "auto";
			const newHeight = Math.min(
				Math.max(this.textInput.scrollHeight, 120), // min 120px
				300 // max 300px
			);
			this.textInput.style.height = newHeight + "px";
		};

		// Create suggestion pills container (above chat area)
		this.suggestionPillsContainer = container.createEl("div", {
			cls: "hydrate-suggestion-pills",
		});

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

		// Create chat history controls container
		const chatHistoryContainer = inputSection.createEl("div", {
			cls: "hydrate-chat-history-controls",
		});

		// Create new chat button (plus icon)
		const newChatButton = chatHistoryContainer.createEl("button", {
			cls: "hydrate-button hydrate-icon-button",
			attr: { title: "New chat" },
		});
		newChatButton.createEl("span", { text: "+" });

		// Create chat history button (history icon)
		const chatHistoryButton = chatHistoryContainer.createEl("button", {
			cls: "hydrate-button hydrate-icon-button",
			attr: { title: "Chat history" },
		});
		chatHistoryButton.createEl("span", { text: "↺" });

		// Create export chat button (download icon)
		const exportChatButton = chatHistoryContainer.createEl("button", {
			cls: "hydrate-button hydrate-icon-button",
			attr: { title: "Export chat as note" },
		});
		exportChatButton.createEl("span", { text: "↓" });

		// Create input container with relative positioning for button overlay
		const inputContainer = inputSection.createEl("div", {
			cls: "hydrate-input-container",
		});

		// Create textarea that fills the container
		this.textInput = inputContainer.createEl("textarea", {
			cls: "hydrate-textarea",
			attr: { placeholder: "Ask a question or request an action..." },
		});

		// Create suggestions container (dropdown for slash commands and note search)
		this.suggestionsContainer = inputContainer.createEl("div", {
			cls: "hydrate-suggestions-container",
		});
		this.suggestionsContainer.style.display = "none"; // Initially hidden
		this.suggestionsContainer.style.position = "absolute";
		this.suggestionsContainer.style.top = "100%";
		this.suggestionsContainer.style.left = "0";
		this.suggestionsContainer.style.right = "0";
		this.suggestionsContainer.style.backgroundColor =
			"var(--background-primary)";
		this.suggestionsContainer.style.border =
			"1px solid var(--background-modifier-border)";
		this.suggestionsContainer.style.borderRadius = "4px";
		this.suggestionsContainer.style.boxShadow =
			"0 2px 8px rgba(0, 0, 0, 0.15)";
		this.suggestionsContainer.style.zIndex = "1000";
		this.suggestionsContainer.style.maxHeight = "200px";
		this.suggestionsContainer.style.overflowY = "auto";

		// Create button container positioned inside the textarea
		const buttonContainer = inputContainer.createEl("div", {
			cls: "hydrate-button-overlay",
		});

		// Create send button
		const sendButton = buttonContainer.createEl("button", {
			cls: "hydrate-button hydrate-overlay-button",
			text: "Send",
		});

		// Create stop button (initially hidden)
		this.stopButton = buttonContainer.createEl("button", {
			cls: "hydrate-button hydrate-overlay-button",
			text: "Stop",
		});
		this.stopButton.style.display = "none";

		// Create clear button
		const clearButton = buttonContainer.createEl("button", {
			cls: "hydrate-button hydrate-overlay-button",
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
		newChatButton.addEventListener("click", () => this.handleNewChat());
		chatHistoryButton.addEventListener("click", () =>
			this.handleChatHistory()
		);
		exportChatButton.addEventListener("click", () =>
			this.handleExportChat()
		);

		// Add drag and drop support
		container.addEventListener("dragover", (e) => e.preventDefault());
		container.addEventListener("dragenter", (e) => {
			e.preventDefault();
			const inputSection = container.querySelector(
				".hydrate-input-section"
			);
			if (inputSection) {
				inputSection.classList.add("hydrate-drag-over");
			}
		});
		container.addEventListener("dragleave", (e) => {
			e.preventDefault();
			const dragEvent = e as DragEvent;
			// Only remove the class if we're leaving the container entirely
			if (!container.contains(dragEvent.relatedTarget as Node)) {
				const inputSection = container.querySelector(
					".hydrate-input-section"
				);
				if (inputSection) {
					inputSection.classList.remove("hydrate-drag-over");
				}
			}
		});
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

		// Update loading message based on endpoint
		let loadingMessage = "Processing request";
		if (endpoint === "/chat") {
			loadingMessage = "Agent is thinking";
		} else if (endpoint === "/tool_result") {
			loadingMessage = "Processing tool results";
		}

		// Set loading state with appropriate message
		setDomLoadingState(this, true, loadingMessage);

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
				`Calling tool: ${toolDisplayName}`
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

					// Actually apply the changes to the file
					try {
						const file = this.app.vault.getAbstractFileByPath(
							toolCall.params.path
						);
						if (file instanceof TFile) {
							await this.app.vault.modify(
								file,
								reviewResult.finalContent || ""
							);
							console.log(
								`Successfully wrote changes to ${toolCall.params.path}`
							);
						} else {
							// File doesn't exist, create it
							await this.app.vault.create(
								toolCall.params.path,
								reviewResult.finalContent || ""
							);
							console.log(
								`Successfully created new file ${toolCall.params.path}`
							);
						}

						results.push({
							id: toolCall.id,
							result: `Successfully applied changes to ${
								toolCall.params.path
							}. ${reviewResult.message || ""}`,
						});
					} catch (writeError) {
						console.error(
							`Failed to write changes to ${toolCall.params.path}:`,
							writeError
						);
						results.push({
							id: toolCall.id,
							result: `Error writing changes to ${
								toolCall.params.path
							}: ${
								writeError instanceof Error
									? writeError.message
									: String(writeError)
							}`,
						});
					}
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

			// Unwrap kwargs if present (LangChain wraps MCP tool parameters in kwargs)
			let actualParams = toolCall.params;
			if (
				toolCall.params.kwargs &&
				typeof toolCall.params.kwargs === "object"
			) {
				console.log("Unwrapping kwargs for MCP tool:", toolCall.tool);
				actualParams = toolCall.params.kwargs;
			}

			// Execute the tool via MCPServerManager
			const result = await this.plugin.mcpManager.executeToolCall(
				toolCall.mcp_info.server_id,
				toolCall.tool,
				actualParams
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

		// Close any active popup
		this.closeActivePopup();

		// Any cleanup needed when the view is closed
	}

	// --- Helper Methods (REMOVED) ---

	// --- Slash Command Methods (REMOVED) ---

	// --- Chat History Methods ---

	/**
	 * Handles the "New Chat" button click
	 */
	private async handleNewChat(): Promise<void> {
		// Save current chat if it has content
		if (this.currentChatTurns.length > 0) {
			await this.saveCurrentChat();
		}

		// Clear the current chat
		this.clearCurrentChat();
	}

	/**
	 * Handles the "Chat History" button click
	 */
	private handleChatHistory(): void {
		const modal = new ChatHistoryModal(this.app, this, (chatHistory) => {
			this.loadChatHistory(chatHistory);
		});
		modal.open();
	}

	/**
	 * Handles the "Export Chat" button click
	 */
	private async handleExportChat(): Promise<void> {
		if (this.currentChatTurns.length === 0) {
			new Notice("No chat content to export");
			return;
		}

		try {
			await this.exportChatAsNote();
			new Notice("Chat exported successfully");
		} catch (error) {
			console.error("Error exporting chat:", error);
			new Notice(`Failed to export chat: ${error.message}`);
		}
	}

	/**
	 * Saves the current chat to the plugin settings
	 */
	private async saveCurrentChat(): Promise<void> {
		if (this.currentChatTurns.length === 0) {
			return; // Nothing to save
		}

		// Generate title from first user message
		const firstUserTurn = this.currentChatTurns.find(
			(turn) => turn.role === "user"
		);
		const title = firstUserTurn
			? firstUserTurn.content.length > 50
				? firstUserTurn.content.substring(0, 50) + "..."
				: firstUserTurn.content
			: "Untitled Chat";

		const now = new Date().toISOString();

		const chatHistory: ChatHistory = {
			id: this.currentChatId || this.generateChatId(),
			title,
			turns: [...this.currentChatTurns],
			conversationId: this.conversationId,
			attachedFiles: [...this.attachedFiles],
			created: this.currentChatId
				? this.plugin.getChatHistoryById(this.currentChatId)?.created ||
				  now
				: now,
			lastModified: now,
		};

		await this.plugin.saveChatHistory(chatHistory);
		this.currentChatId = chatHistory.id;

		console.log(`Chat saved with ID: ${chatHistory.id}`);
	}

	/**
	 * Loads a chat history and restores the conversation
	 */
	private async loadChatHistory(chatHistory: ChatHistory): Promise<void> {
		// Save current chat if it has content and is different from the one being loaded
		if (
			this.currentChatTurns.length > 0 &&
			this.currentChatId !== chatHistory.id
		) {
			await this.saveCurrentChat();
		}

		// Clear current chat
		this.clearCurrentChat();

		// Load the selected chat
		this.currentChatId = chatHistory.id;
		this.currentChatTurns = [...chatHistory.turns];
		this.conversationId = chatHistory.conversationId;
		this.attachedFiles = [...chatHistory.attachedFiles];

		// Treat restored files as initially attached to allow auto-switching
		this.wasInitiallyAttached = this.attachedFiles.length === 1;

		// Restore the UI
		this.restoreChatUI();

		console.log(`Chat loaded with ID: ${chatHistory.id}`);
	}

	/**
	 * Clears the current chat state
	 */
	private clearCurrentChat(): void {
		// Clear chat display
		this.chatContainer.empty();

		// Clear input
		this.textInput.value = "";

		// Clear state
		this.currentChatTurns = [];
		this.currentChatId = null;
		this.conversationId = null;
		this.attachedFiles = [];
		this.wasInitiallyAttached = false;
		this.sentFileContentRegistry.clear();
		this.appliedRuleIds.clear();
		this.capturedSelections = [];

		// Update UI
		renderDomFilePills(this);

		// Clear suggestions
		this.suggestedNotes = [];
		this.renderSuggestionPills();
	}

	/**
	 * Restores the chat UI from saved chat turns
	 */
	private restoreChatUI(): void {
		// Clear the chat container
		this.chatContainer.empty();

		// Set flag to prevent duplicate tracking during restoration
		this.isRestoringFromHistory = true;

		// Restore all messages
		for (const turn of this.currentChatTurns) {
			addMessageToChat(this, turn.role, turn.content);
		}

		// Reset flag
		this.isRestoringFromHistory = false;

		// Update file pills
		renderDomFilePills(this);

		// Refresh suggestions based on loaded conversation
		setTimeout(() => {
			this.refreshContextSuggestions();
		}, 2000);
	}

	/**
	 * Generates a unique chat ID
	 */
	private generateChatId(): string {
		return `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	// --- Chat Context Suggestions Methods ---

	/**
	 * Generates search queries from recent chat content and finds relevant notes
	 */
	private async refreshContextSuggestions(): Promise<void> {
		// Throttle calls to avoid excessive API usage
		const now = Date.now();
		const timeSinceLastRefresh = now - this.lastSuggestionRefresh;
		if (timeSinceLastRefresh < 5000) {
			// Wait at least 5 seconds between refreshes
			return;
		}
		this.lastSuggestionRefresh = now;

		// Check if remote embeddings are enabled and configured
		if (!this.plugin.settings.enableRemoteEmbeddings) {
			this.suggestedNotes = [];
			this.renderSuggestionPills();
			return;
		}

		if (
			!this.plugin.settings.remoteEmbeddingUrl ||
			!this.plugin.settings.remoteEmbeddingApiKey ||
			!this.plugin.settings.remoteEmbeddingModelName
		) {
			this.suggestedNotes = [];
			this.renderSuggestionPills();
			return;
		}

		// Get recent chat content to generate search queries
		const searchQueries = this.generateSearchQueriesFromChat();
		if (searchQueries.length === 0) {
			this.suggestedNotes = [];
			this.renderSuggestionPills();
			return;
		}

		try {
			// Search for relevant content using each query
			const allSuggestions = new Map<
				string,
				{ filePath: string; score: number; reason: string }
			>();

			for (const queryInfo of searchQueries) {
				try {
					const { searchIndexRemote } = await import(
						"../../vectorIndex"
					);
					const searchResults = await searchIndexRemote(
						queryInfo.query,
						this.plugin.settings as any, // VectorIndexSettings compatible
						3 // Limit results per query
					);

					for (const result of searchResults) {
						// Skip files that are already attached
						if (this.attachedFiles.includes(result.filePath)) {
							continue;
						}

						// Use the highest score if file appears in multiple queries
						const existingSuggestion = allSuggestions.get(
							result.filePath
						);
						if (
							!existingSuggestion ||
							result.score! > existingSuggestion.score
						) {
							allSuggestions.set(result.filePath, {
								filePath: result.filePath,
								score: result.score || 0,
								reason: queryInfo.reason,
							});
						}
					}
				} catch (error) {
					console.warn(
						`Search failed for query "${queryInfo.query}":`,
						error
					);
				}
			}

			// Convert to array and sort by score
			this.suggestedNotes = Array.from(allSuggestions.values())
				.sort((a, b) => b.score - a.score)
				.slice(0, 5); // Limit to top 5 suggestions

			this.renderSuggestionPills();
		} catch (error) {
			console.error("Error refreshing context suggestions:", error);
			this.suggestedNotes = [];
			this.renderSuggestionPills();
		}
	}

	/**
	 * Generates search queries from recent chat turns
	 */
	private generateSearchQueriesFromChat(): Array<{
		query: string;
		reason: string;
	}> {
		const queries: Array<{ query: string; reason: string }> = [];

		// Get the last few chat turns (recent context)
		const recentTurns = this.currentChatTurns.slice(-6); // Last 6 turns

		if (recentTurns.length === 0) {
			return queries;
		}

		// Extract text from recent user messages
		const userMessages = recentTurns
			.filter((turn) => turn.role === "user")
			.map((turn) => turn.content)
			.slice(-3); // Last 3 user messages

		// Extract text from recent agent messages
		const agentMessages = recentTurns
			.filter((turn) => turn.role === "agent")
			.map((turn) => turn.content)
			.slice(-2); // Last 2 agent messages

		// Generate queries from user messages
		userMessages.forEach((message, index) => {
			if (message.length > 10) {
				// Skip very short messages
				queries.push({
					query: message.substring(0, 200), // Limit query length
					reason: `Related to recent question`,
				});
			}
		});

		// Generate queries from agent messages (extract key topics)
		agentMessages.forEach((message, index) => {
			// Extract key phrases/topics from agent responses
			const topics = this.extractTopicsFromText(message);
			topics.forEach((topic) => {
				if (topic.length > 5) {
					queries.push({
						query: topic,
						reason: `Related to discussed topic`,
					});
				}
			});
		});

		return queries.slice(0, 4); // Limit total queries to avoid too many API calls
	}

	/**
	 * Simple topic extraction from text (could be improved with NLP)
	 */
	private extractTopicsFromText(text: string): string[] {
		// Simple approach: extract phrases with important words
		const importantWords =
			/\b(implement|create|build|design|analyze|explain|configure|setup|install|debug|fix|optimize|improve|manage|handle|process|generate|develop|code|function|method|class|component|feature|system|application|service|tool|library|framework|api|database|file|project|workflow|automation|integration|testing|deployment|performance|security|authentication|authorization|validation|error|exception|logging|monitoring|documentation|tutorial|guide|example|pattern|best|practice|solution|approach|strategy|architecture|structure|organization|planning|requirement|specification|design|interface|user|experience|frontend|backend|server|client|browser|mobile|web|app|software|hardware|network|cloud|infrastructure|devops|ci|cd|git|repository|version|control|branch|merge|commit|pull|request|issue|bug|task|ticket|milestone|release|deploy|environment|staging|production|development|test|unit|integration|end|to|end|manual|automated|script|command|terminal|shell|bash|powershell|linux|windows|macos|docker|kubernetes|aws|azure|gcp|terraform|ansible|jenkins|github|gitlab|bitbucket|jira|confluence|slack|teams|email|notification|alert|dashboard|metrics|analytics|report|chart|graph|visualization|data|analysis|machine|learning|ai|artificial|intelligence|natural|language|processing|computer|vision|deep|learning|neural|network|algorithm|model|training|inference|prediction|classification|regression|clustering|recommendation|search|query|filter|sort|pagination|cache|session|cookie|token|jwt|oauth|saml|ldap|active|directory|role|permission|access|control|audit|compliance|gdpr|hipaa|sox|iso|pci|dss)\b/gi;

		const matches = text.match(importantWords) || [];
		const topics = new Set<string>();

		// Add individual important words
		matches.forEach((match) => {
			if (match.length > 3) {
				topics.add(match.toLowerCase());
			}
		});

		// Extract noun phrases (simple pattern matching)
		const nounPhrases =
			text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
		nounPhrases.forEach((phrase) => {
			if (phrase.length > 5 && phrase.length < 50) {
				topics.add(phrase);
			}
		});

		return Array.from(topics).slice(0, 8); // Return top 8 topics
	}

	/**
	 * Creates a reusable popup with custom buttons
	 */
	private createPopup(
		anchorElement: HTMLElement,
		buttons: Array<{ text: string; action: () => void }>
	): HTMLDivElement {
		// Close any existing popup
		this.closeActivePopup();

		const popup = document.createElement("div");
		popup.className = "hydrate-popup";

		// Add buttons first
		buttons.forEach((button) => {
			const btn = popup.createEl("button", {
				cls: "hydrate-popup-button",
				text: button.text,
			});
			btn.addEventListener("click", () => {
				button.action();
				this.closeActivePopup();
			});
		});

		// Add to document body for proper positioning
		document.body.appendChild(popup);
		this.activePopup = popup;

		// Position popup near the anchor element after adding to DOM
		const rect = anchorElement.getBoundingClientRect();
		popup.style.position = "fixed";
		popup.style.top = `${rect.bottom + 5}px`;
		popup.style.left = `${rect.left}px`;
		popup.style.zIndex = "9999";

		// Close on outside click
		const closeOnOutsideClick = (e: MouseEvent) => {
			if (!popup.contains(e.target as Node)) {
				this.closeActivePopup();
				document.removeEventListener("click", closeOnOutsideClick);
			}
		};
		setTimeout(() => {
			document.addEventListener("click", closeOnOutsideClick);
		}, 0);

		return popup;
	}

	/**
	 * Closes the active popup if it exists
	 */
	private closeActivePopup(): void {
		if (this.activePopup) {
			this.activePopup.remove();
			this.activePopup = null;
		}
	}

	/**
	 * Renders the suggestion pills in the UI
	 */
	private renderSuggestionPills(): void {
		if (!this.suggestionPillsContainer) return;

		// Clear existing pills and close any popup
		this.suggestionPillsContainer.empty();
		this.closeActivePopup();

		if (this.suggestedNotes.length === 0) {
			return; // Container will be hidden by CSS when empty
		}

		this.suggestedNotes.forEach((suggestion) => {
			const pill = this.suggestionPillsContainer!.createEl("button", {
				cls: "hydrate-suggestion-pill",
				attr: {
					title: `${
						suggestion.reason
					} (score: ${suggestion.score.toFixed(3)})`,
				},
			});

			// Get just the filename for display
			const filename =
				suggestion.filePath.split("/").pop()?.replace(/\.md$/, "") ||
				suggestion.filePath;
			pill.createEl("span", { text: filename });

			// Add click handler to show popup with options
			pill.addEventListener("click", (e) => {
				e.stopPropagation();
				this.createPopup(pill, [
					{
						text: "Add to Chat",
						action: () =>
							this.addSuggestionToContext(suggestion.filePath),
					},
					{
						text: "Navigate to Note",
						action: () => this.navigateToNote(suggestion.filePath),
					},
				]);
			});
		});
	}

	/**
	 * Adds a suggested note to the attached files context
	 */
	private addSuggestionToContext(filePath: string): void {
		// Check if already attached
		if (this.attachedFiles.includes(filePath)) {
			new Notice(`${filePath} is already attached`);
			return;
		}

		// Add to attached files
		this.attachedFiles.push(filePath);
		this.wasInitiallyAttached = false; // User manually added

		// Update file pills display
		renderDomFilePills(this);

		// Remove from suggestions since it's now attached
		this.suggestedNotes = this.suggestedNotes.filter(
			(s) => s.filePath !== filePath
		);
		this.renderSuggestionPills();

		new Notice(`Added ${filePath.split("/").pop()} to context`);
	}

	/**
	 * Navigates to a note in the main Obsidian view
	 */
	private async navigateToNote(filePath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!file || !(file instanceof TFile)) {
			new Notice(`Could not find file: ${filePath}`);
			return;
		}

		// Open the file in the main workspace
		await this.app.workspace.getLeaf(false).openFile(file);
		new Notice(`Opened ${file.name}`);
	}

	/**
	 * Exports the current chat as a formatted note
	 */
	private async exportChatAsNote(): Promise<void> {
		// Ensure the hydrate-chats folder exists
		const folderPath = "hydrate-chats";
		const folder = this.app.vault.getAbstractFileByPath(folderPath);

		if (!folder) {
			await this.app.vault.createFolder(folderPath);
		}

		// Generate filename from first user message or timestamp
		const firstUserTurn = this.currentChatTurns.find(
			(turn) => turn.role === "user"
		);
		let baseTitle = firstUserTurn
			? firstUserTurn.content
					.substring(0, 50)
					.replace(/[^\w\s-]/g, "")
					.replace(/\s+/g, " ")
					.trim()
			: "Chat Export";

		// Ensure baseTitle is not empty
		if (!baseTitle) {
			baseTitle = "Chat Export";
		}

		const timestamp = new Date()
			.toISOString()
			.slice(0, 19)
			.replace(/:/g, "-");
		const filename = `${baseTitle} ${timestamp}.md`;
		const filepath = `${folderPath}/${filename}`;

		// Check if file already exists and append number if needed
		let finalFilepath = filepath;
		let counter = 1;
		while (this.app.vault.getAbstractFileByPath(finalFilepath)) {
			const nameWithoutExt = filename.replace(".md", "");
			finalFilepath = `${folderPath}/${nameWithoutExt} (${counter}).md`;
			counter++;
		}

		// Build frontmatter
		const selectedModel = this.plugin.getSelectedModel();
		const frontmatter = [
			"---",
			`model: "${selectedModel} (via Hydrate)"`,
			`timestamp: ${new Date().toISOString()}`,
			`conversation_id: ${this.conversationId || "unknown"}`,
			`attached_files: ${this.attachedFiles.length}`,
			"---",
			"",
		].join("\n");

		// Build dialogue content
		let dialogueContent = "";
		for (const turn of this.currentChatTurns) {
			if (turn.role === "user") {
				dialogueContent += `## User:\n\n${turn.content}\n\n`;
			} else if (turn.role === "agent") {
				dialogueContent += `## Agent:\n\n${turn.content}\n\n`;
			}
		}

		// Build references section
		let referencesContent = "### References:\n\n";
		if (this.attachedFiles.length > 0) {
			referencesContent +=
				this.attachedFiles
					.map((filepath) => `- [[${filepath}]]`)
					.join("\n") + "\n";
		} else {
			referencesContent +=
				"- No reference files were used in this conversation\n";
		}

		// Combine all content
		const noteContent = frontmatter + dialogueContent + referencesContent;

		// Create the note
		await this.app.vault.create(finalFilepath, noteContent);

		console.log(`Chat exported to: ${finalFilepath}`);
	}

	// --- End Chat History Methods ---
}
