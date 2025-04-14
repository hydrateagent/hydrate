import {
	ItemView,
	WorkspaceLeaf,
	requestUrl,
	Notice,
	TFile,
	Editor,
	parseYaml,
} from "obsidian";
import ProVibePlugin from "./main"; // Import the plugin class to access settings

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
	tool_call?: BackendToolCall; // Explicit tool call structure
}

export class ProVibeView extends ItemView {
	private plugin: ProVibePlugin; // Store reference to the plugin
	private textInput: HTMLTextAreaElement;
	private chatContainer: HTMLDivElement; // Container for chat messages
	private history: HistoryMessage[] = []; // Store richer history
	private isLoading: boolean = false; // Flag to prevent multiple submissions

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

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("provibe-view-container");

		// Create a description for the pane
		container.createEl("p", {
			text: "Enter your prompt below. Agent responses and tool interactions will appear here.",
			cls: "provibe-description",
		});

		// Chat history container
		this.chatContainer = container.createEl("div", {
			cls: "provibe-chat-container",
		});

		// Input area container
		const inputArea = container.createEl("div", {
			cls: "provibe-input-area",
		});

		// Create textarea for text input
		this.textInput = inputArea.createEl("textarea", {
			cls: "provibe-textarea",
			attr: {
				placeholder: "Enter your prompt here...",
				rows: "4", // Adjust size as needed
			},
		});

		// Add buttons below the text input
		const buttonContainer = inputArea.createEl("div", {
			cls: "provibe-button-container",
		});

		const clearButton = buttonContainer.createEl("button", {
			text: "Clear",
			cls: "provibe-button provibe-clear-button",
		});

		const sendButton = buttonContainer.createEl("button", {
			text: "Send",
			cls: "provibe-button provibe-send-button",
		});

		// Add event listeners for buttons
		clearButton.addEventListener("click", this.handleClear);

		sendButton.addEventListener("click", this.handleSend);

		// Allow sending with Enter key (Shift+Enter for newline)
		this.textInput.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault(); // Prevent default newline insertion
				this.handleSend();
			}
		});

		// --- Add this for initial load/debug ---
		this.addMessageToChat(
			"system",
			"ProVibe Agent view opened. Type your prompt."
		);
	}

	// --- UI Update Methods ---

	private addMessageToChat(
		role: "user" | "agent" | "system",
		content: string,
		isError: boolean = false
	) {
		const messageEl = this.chatContainer.createDiv({
			cls: `provibe-message provibe-${role}-message`,
		});
		if (isError) {
			messageEl.addClass("provibe-error-message");
		}
		// Basic text rendering for now, could use Markdown rendering later
		messageEl.setText(content);
		// Scroll to the bottom
		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
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
	}

	// --- Event Handlers ---

	private handleClear = () => {
		this.textInput.value = "";
		this.chatContainer.empty(); // Clear chat display
		this.history = []; // Clear internal history
		this.addMessageToChat("system", "Chat cleared."); // Add system message
		this.textInput.focus();
	};

	private handleSend = async () => {
		if (this.isLoading) return;

		const messageContent = this.getTextContent().trim();
		if (!messageContent) return;

		// Add user message to UI and history
		this.addMessageToChat("user", messageContent);
		const userMessage: HistoryMessage = {
			type: "human",
			content: messageContent,
		};
		this.history.push(userMessage);

		this.setTextContent("");
		this.setLoadingState(true);

		try {
			// Pass the full history
			await this.callBackend("/chat", {
				message: messageContent,
				history: this.history.slice(0, -1), // History *before* this user message
			});
		} catch (error: any) {
			console.error("Error sending message:", error);
			this.addMessageToChat(
				"system",
				`Error: ${error.message || "Failed to connect to backend"}`,
				true
			);
			// Remove user message from history if send failed
			const lastMsgIndex = this.history.findIndex(
				(msg) => msg === userMessage
			); // Find specific obj ref
			if (lastMsgIndex > -1) {
				this.history.splice(lastMsgIndex, 1);
			}
		} finally {
			this.setLoadingState(false);
			this.textInput.focus();
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

		let responseData: BackendResponse | null = null; // Declare outside try

		try {
			const response = await requestUrl({
				url: fullUrl,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			responseData = response.json; // Assign inside try

			// Add null/undefined check right after assignment
			if (!responseData) {
				throw new Error(
					"Received empty or invalid JSON response from backend."
				);
			}

			console.log("Backend Response:", responseData);

			// --- Response Handling ---

			let agentMessageToAdd: HistoryMessage | null = null;

			// Always process agent_message first, as it might accompany a tool_call
			if (responseData.agent_message) {
				agentMessageToAdd = responseData.agent_message;
				// Display only the content part for regular agent messages
				if (!responseData.tool_call) {
					this.addMessageToChat(
						"agent",
						responseData.agent_message.content
					);
				}
			}

			// Handle tool call if present
			if (responseData.tool_call) {
				// If agent_message was also present (containing the tool call), add it to history now
				if (agentMessageToAdd) {
					this.history.push(agentMessageToAdd);
					// Display a system message indicating tool use
					this.addMessageToChat(
						"system",
						`Agent wants to use tool: ${responseData.tool_call.tool}`
					);
				} else {
					// Should not happen if backend sends agent_message with tool_call, but handle defensively
					console.warn(
						"Received tool_call without accompanying agent_message"
					);
					this.addMessageToChat(
						"system",
						`Agent wants to use tool: ${responseData.tool_call.tool} (missing agent message)`
					);
				}
				await this.handleToolCall(responseData.tool_call);
				// setLoadingState(false) is handled by the *next* callBackend response after tool result
				return; // Exit early, as handleToolCall will trigger the next backend call
			}

			// If it was just a regular agent message, add it to history
			if (agentMessageToAdd && !responseData.tool_call) {
				this.history.push(agentMessageToAdd);
			}

			// If response was neither agent message nor tool call
			if (!responseData.agent_message && !responseData.tool_call) {
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
			// Don't modify history here as the error is in communication itself
			throw error; // Re-throw to be caught by handleSend if needed
		} finally {
			// Only set loading false if it wasn't a tool call (which triggers its own loading sequence)
			if (!responseData?.tool_call) {
				this.setLoadingState(false);
			}
		}
	}

	// --- Tool Handling ---

	private async handleToolCall(toolCall: BackendToolCall) {
		this.setLoadingState(true); // Keep loading while tool runs
		let result: any;
		let errorOccurred = false;

		try {
			switch (toolCall.tool) {
				case "readFile":
					result = await this.toolReadFile(toolCall.params.path);
					break;
				case "editFile":
					result = await this.toolEditFile(
						toolCall.params.path,
						toolCall.params.code_edit,
						toolCall.params.instructions
					);
					break;
				// Add cases for other tools here
				default:
					result = `Error: Unknown tool '${toolCall.tool}' requested.`;
					errorOccurred = true;
			}
		} catch (error: any) {
			console.error(`Error executing tool ${toolCall.tool}:`, error);
			result = `Error executing tool ${toolCall.tool}: ${error.message}`;
			errorOccurred = true;
		}

		this.addMessageToChat(
			"system",
			`Tool ${toolCall.tool} result: ${
				typeof result === "string" && result.length > 100
					? result.substring(0, 100) + "..."
					: JSON.stringify(result)
			}`,
			errorOccurred
		);

		// Create the ToolMessage for history
		const toolResultMessage: HistoryMessage = {
			type: "tool",
			content:
				typeof result === "string" ? result : JSON.stringify(result), // Ensure content is string
			tool_call_id: toolCall.id,
		};
		// We add this *before* calling the backend, but ideally it should only be added
		// if the backend call is successful. This logic might need refinement.
		this.history.push(toolResultMessage);

		// Send the result back to the backend
		try {
			await this.callBackend("/tool_result", {
				tool_result: {
					id: toolCall.id,
					result: result, // Send the actual result object/string
				},
				history: this.history.slice(0, -1), // Send history *before* this tool result message
			});
		} catch (error: any) {
			// Error displayed by callBackend already
			this.setLoadingState(false); // Ensure loading state is reset on error
			// Remove the optimistic tool result message from history on error
			const lastMsgIndex = this.history.findIndex(
				(msg) => msg === toolResultMessage
			);
			if (lastMsgIndex > -1) {
				this.history.splice(lastMsgIndex, 1);
			}
		}
		// setLoadingState(false) is handled by the final response from the subsequent callBackend call
	}

	// --- Tool Implementations using Obsidian API ---

	private async toolReadFile(path: string): Promise<string> {
		// Strip leading './' if present
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
		code_edit: string,
		instructions: string
	): Promise<string> {
		// Strip leading './' if present
		const normalizedPath = path.startsWith("./") ? path.substring(2) : path;
		console.log(
			`Tool: Editing file ${normalizedPath} (Original: ${path}) with instructions: ${instructions}`
		);
		const file = this.app.vault.getAbstractFileByPath(normalizedPath);
		if (!file) {
			throw new Error(`File not found: ${normalizedPath}`);
		}
		if (!(file instanceof TFile)) {
			throw new Error(`Path is not a file: ${normalizedPath}`);
		}

		// Implementation Note:
		// The agent is expected to provide the *complete* new file content in the code_edit parameter
		// when using this tool for full replacement.

		// --- Use Approach 1: Full file replacement (as requested) ---
		await this.app.vault.modify(file, code_edit);
		const successMsg = `Successfully replaced content of ${normalizedPath}`;
		new Notice(successMsg);
		return successMsg;

		/* --- Remove Approach 2 and Fallback --- 
		// --- Approach 2: Attempt edit in active editor if paths match (Less destructive but limited) ---
		const activeEditor = this.app.workspace.activeEditor;
		if (activeEditor && activeEditor.file?.path === normalizedPath) { // Check against normalized path
			// ... (previous editor logic removed) ...
		}

		// --- Fallback/Placeholder: Error --- //
		throw new Error(`Editing file \'${normalizedPath}\' not directly supported yet unless it\'s the active file. Full file replacement is risky.`);
		*/
	}

	// --- Obsidian View Lifecycle Methods ---

	async onClose() {
		// Clean up any event listeners or resources when the view is closed
		// (Listeners added with this.registerDomEvent are handled automatically)
	}

	// --- Helper Methods ---

	// Method to get the text content from the input
	getTextContent(): string {
		return this.textInput?.value || "";
	}

	// Method to set the text content of the input
	setTextContent(text: string): void {
		if (this.textInput) {
			this.textInput.value = text;
		}
	}
}
