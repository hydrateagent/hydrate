import {
	ItemView,
	WorkspaceLeaf,
	requestUrl,
	Notice,
	TFile,
	Editor,
	parseYaml,
	MarkdownRenderer,
} from "obsidian";
import ProVibePlugin from "./main"; // Import the plugin class to access settings
import { DiffReviewModal, DiffReviewResult } from "./DiffReviewModal"; // Import the new modal

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

		// Chat history container
		this.chatContainer = container.createEl("div", {
			cls: "provibe-chat-container",
		});

		// Input area container (will hold pills and textarea+buttons)
		const inputAreaContainer = container.createEl("div", {
			cls: "provibe-input-area-container",
		});

		// File pills container (above the text area)
		this.filePillsContainer = inputAreaContainer.createEl("div", {
			cls: "provibe-file-pills-container",
		});

		// Text input and buttons area
		const inputControlsArea = inputAreaContainer.createEl("div", {
			cls: "provibe-input-controls-area",
		});

		// Create textarea for text input
		this.textInput = inputControlsArea.createEl("textarea", {
			cls: "provibe-textarea",
			attr: {
				placeholder: "Enter your prompt or drop files here...",
				rows: "4",
			},
		});

		// Add buttons below the text input
		const buttonContainer = inputControlsArea.createEl("div", {
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

		// Add the Stop button (initially hidden or disabled)
		this.stopButton = buttonContainer.createEl("button", {
			text: "Stop",
			cls: "provibe-button provibe-stop-button",
		});
		this.stopButton.style.display = "none"; // Start hidden

		// Add event listeners for buttons
		clearButton.addEventListener("click", this.handleClear);

		sendButton.addEventListener("click", this.handleSend);

		// Add event listener for the Stop button
		this.stopButton.addEventListener("click", this.handleStop);

		// Allow sending with Enter key (Shift+Enter for newline)
		this.textInput.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault(); // Prevent default newline insertion
				this.handleSend();
			}
		});

		// --- Add Drag and Drop Listeners to the *input area container* ---
		this.registerDomEvent(
			inputAreaContainer,
			"dragover",
			(event: DragEvent) => {
				// Log the dataTransfer object and types during dragover
				console.log(
					"ProVibe: dragover - dataTransfer:",
					event.dataTransfer
				);
				console.log(
					"ProVibe: dragover - types:",
					event.dataTransfer?.types
				);

				// Allow drop if any dataTransfer is happening
				// The drop handler will verify if files are actually present.
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
			"ProVibe Agent ready. Type your prompt or drop files."
		);

		// --- Auto-attach active file on open --- //
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile instanceof TFile) {
			// Check if it's a real file
			const activeFilePath = activeFile.path;
			// Check if it's not already attached (e.g., from a previous session state if implemented)
			if (!this.attachedFiles.includes(activeFilePath)) {
				console.log(
					`ProVibe: Auto-attaching active file on open: ${activeFilePath}`
				);
				this.attachedFiles.push(activeFilePath);
			}
		}
		// Render pills after potentially adding the active file
		this.renderFilePills();
		// --- End Auto-attach on open ---
	}

	// --- UI Update Methods ---

	private addMessageToChat(
		role: "user" | "agent" | "system",
		content: string | HTMLElement, // Allow HTML content for diffs
		isError: boolean = false
	) {
		const messageEl = this.chatContainer.createDiv({
			cls: `provibe-message provibe-${role}-message`,
		});
		if (isError) {
			messageEl.addClass("provibe-error-message");
		}

		if (content instanceof HTMLElement) {
			messageEl.appendChild(content); // Append HTML content directly
		} else if (role === "agent" && content) {
			// Use MarkdownRenderer for agent messages
			try {
				MarkdownRenderer.render(
					this.plugin.app, // Pass the App instance
					content,
					messageEl,
					"", // sourcePath can be empty or a relevant file path
					this.plugin // Component context for cleanup
				);
			} catch (renderError) {
				console.error("Markdown rendering error:", renderError);
				messageEl.setText(`(Error rendering message) ${content}`); // Fallback to text
			}
		} else {
			// Use basic text for user and system messages
			messageEl.createSpan({ text: content });
		}

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
		// Add null check for stopButton
		if (this.stopButton) {
			this.stopButton.textContent = loading ? "Stop" : "Stop"; // Text might not need changing
			// Show stop button only when loading, hide otherwise
			this.stopButton.style.display = loading ? "inline-block" : "none";
			this.stopButton.disabled = !loading; // Disable if not loading (redundant with display: none but safer)
		}
	}

	// --- Event Handlers ---

	private handleClear = () => {
		this.textInput.value = "";
		this.chatContainer.empty(); // Clear chat display
		this.attachedFiles = [];
		this.renderFilePills();
		this.conversationId = null; // Reset conversation ID on clear
		this.addMessageToChat(
			"system",
			"Chat cleared. New conversation started."
		);
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

		// --- Attempt to get path from dataTransfer data ---
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

		// --- Process the extracted path data ---
		// Assuming pathData might contain one or more paths/URIs, potentially newline-separated
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

			// --- Resolve potentialPath to a normalized path for comparison ---
			if (
				potentialPath.startsWith("obsidian://open?vault=") ||
				potentialPath.startsWith("obsidian://vault/")
			) {
				// Very basic URI parsing - needs improvement for robustness
				try {
					const url = new URL(potentialPath);
					const filePathParam = url.searchParams.get("file");
					if (filePathParam) {
						vaultPath = filePathParam;
						console.log(
							`ProVibe: Extracted path from Obsidian URI: ${vaultPath}`
						);
					} else {
						// Handle vault path URI style if needed (more complex)
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
					vaultPath = null; // Reset vaultPath, we need to verify it exists
				}
			} else if (potentialPath.startsWith("file://")) {
				// Handle file URI - convert to OS path and then try to map to vault
				try {
					let osPath = decodeURIComponent(potentialPath.substring(7)); // Remove 'file://' and decode
					// Remove leading slash on Windows if present (e.g., /C:/Users...)
					if (/^\/[a-zA-Z]:/.test(osPath)) {
						osPath = osPath.substring(1);
					}
					const normalizedOsPath = osPath.replace(/\\\\/g, "/");
					console.log(
						`ProVibe: Decoded file URI to OS path: ${normalizedOsPath}`
					);

					// Find corresponding vault file (using existing logic)
					let foundVaultFile: TFile | null = null;
					const directMatch =
						this.app.vault.getAbstractFileByPath(normalizedOsPath);
					// Add instanceof check here too
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
				// Assume direct path (vault or OS)
				normalizedPathForComparison = potentialPath.replace(
					/\\\\/g,
					"/"
				);
				console.log(
					`ProVibe: Treating potential path as direct/OS path: ${normalizedPathForComparison}`
				);
			}

			// --- Find the TFile using the normalized path ---
			if (normalizedPathForComparison) {
				// Strategy 1: Exact match using getAbstractFileByPath
				const directMatch = this.app.vault.getAbstractFileByPath(
					normalizedPathForComparison
				);
				// Check if it's specifically a TFile
				if (directMatch instanceof TFile) {
					foundVaultFile = directMatch;
					console.log(
						`ProVibe: Found vault file by exact path: ${foundVaultFile.path}`
					);
				}

				// Strategy 2: Check if OS path ends with a vault file path (heuristic)
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

				// Strategy 3: Check if vault path starts with normalized path + dot (missing extension heuristic)
				if (!foundVaultFile) {
					const possibleMatches = allVaultFiles.filter((vf) =>
						vf.path.startsWith(normalizedPathForComparison + ".")
					);
					if (possibleMatches.length === 1) {
						// Only use if unambiguous
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

			// If we found a vault file, use its path
			if (foundVaultFile) {
				vaultPath = foundVaultFile.path;
			}

			// If we resolved a vault path, add it
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

		// Update UI if files were added
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
				cls: "provibe-file-pill",
			});
			const fileName = filePath.split("/").pop() || filePath;
			pill.createSpan({ text: fileName, cls: "provibe-pill-text" });

			const removeBtn = pill.createEl("button", {
				text: "✕",
				cls: "provibe-pill-remove",
			});
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

	private handleSend = async () => {
		if (this.isLoading) return;

		const messageContent = this.getTextContent().trim();

		const attachedFilesContent = this.attachedFiles
			.map((path) => `[File: ${path}]`)
			.join("\n");

		// Combine attached files and message content
		let combinedContent = messageContent;
		if (attachedFilesContent) {
			combinedContent =
				attachedFilesContent +
				(messageContent ? "\n\n" + messageContent : "");
		}

		if (!combinedContent) return; // Don't send if nothing is attached and message is empty

		// Add user message to UI (only the typed part)
		// Decide if we should show the [File: ...] part in the user message bubble or just the typed text.
		// Let's show just the typed text for now.
		this.addMessageToChat(
			"user",
			messageContent || "(Sent with attached files)"
		);

		// Prepare payload - include conversationId if it exists
		const payload: any = {
			message: combinedContent,
		};
		if (this.conversationId) {
			payload.conversation_id = this.conversationId;
		}

		// Clear input and pills AFTER preparing the message
		this.setTextContent("");
		this.attachedFiles = [];
		this.renderFilePills();
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
			// No history to roll back here
		} finally {
			// setLoadingState(false) handled by callBackend
			this.textInput.focus();
		}
	};

	// --- Add handler for the Stop button ---
	private handleStop = async () => {
		if (!this.isLoading || !this.conversationId || !this.stopButton) return;

		console.log(
			`ProVibe: Stop requested for conversation ${this.conversationId}`
		);
		this.stopButton.textContent = "Stopping..."; // Indicate stopping action
		this.stopButton.disabled = true; // Prevent multiple clicks while stopping

		const backendUrl = this.plugin.settings.backendUrl;
		if (!backendUrl) {
			new Notice("Backend URL is not configured.");
			this.stopButton.textContent = "Stop"; // Reset button on error
			this.stopButton.disabled = false;
			return;
		}

		const stopUrl = `${backendUrl}/stop/${this.conversationId}`;

		try {
			await requestUrl({
				url: stopUrl,
				method: "POST",
				// No body needed for stop request
			});
			new Notice("Stop signal sent.");
			// Don't immediately set isLoading to false here.
			// The agent response (from the original /chat or /tool_result call)
			// will eventually return, potentially with a "stopped" message.
			// The setLoadingState(false) will happen in the finally block of callBackend
			// or when the stopped message is received.

			// Optionally, add a visual cue that stop was sent but generation might still finish
			// this.addMessageToChat("system", "Stop request sent. Waiting for current step to finish...");
			// Keep the button disabled until loading is fully false
		} catch (error: any) {
			console.error("Error sending stop signal:", error);
			new Notice(`Failed to send stop signal: ${error.message}`);
			// Re-enable the stop button if the stop request itself failed
			if (this.isLoading && this.stopButton) {
				// Only re-enable if still in loading state
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

			// Add null/undefined check right after assignment
			if (!responseData) {
				throw new Error(
					"Received empty or invalid JSON response from backend."
				);
			}

			console.log("Backend Response:", responseData);

			// --- Store/Update Conversation ID ---
			if (responseData.conversation_id) {
				this.conversationId = responseData.conversation_id;
				console.log(
					"ProVibe: Updated conversation ID to:",
					this.conversationId
				);
			} else {
				// This shouldn't happen if backend always returns it
				console.warn(
					"ProVibe: Backend response missing conversation_id!"
				);
			}

			// --- Response Handling ---
			// Display agent message first, if present (even if tools are called)
			if (responseData.agent_message?.content) {
				this.addMessageToChat(
					"agent",
					responseData.agent_message.content
				);
			}

			if (responseData.tool_calls && responseData.tool_calls.length > 0) {
				// Handle tool calls (might involve user interaction for edits)
				const toolNames = responseData.tool_calls
					.map((tc) => tc.tool)
					.join(", ");
				this.addMessageToChat(
					"system",
					`Agent requests actions using: ${toolNames}`
				);
				// Process tools, potentially involving review
				await this.processToolCalls(responseData.tool_calls);
				// Don't return here; further actions happen in processToolCalls
			} else if (!responseData.agent_message?.content) {
				// Handle empty response only if no tool calls AND no agent message
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
			this.setLoadingState(false); // Ensure loading state is reset on error
			// Re-throw might not be needed if setLoadingState is handled here
		} finally {
			// Loading state is now managed within processToolCalls or after non-tool responses
			// Only set loading false if no tools were called AND we are not in the tool result flow
			if (
				endpoint === "/chat" &&
				(!responseData?.tool_calls ||
					responseData.tool_calls.length === 0)
			) {
				this.setLoadingState(false);
			}
			// If endpoint is /tool_result, the final response from the backend (after tools)
			// will not have tool_calls, so we reset loading state then.
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

	// New function to process incoming tool calls, separating edits for review
	private async processToolCalls(toolCalls: BackendToolCall[]) {
		this.setLoadingState(true); // Ensure loading state is active
		console.log(`ProVibe: Processing ${toolCalls.length} tool calls.`);

		const executedResults: ToolResult[] = [];
		const pendingEdits: BackendToolCall[] = [];
		let immediateExecutionError = false;

		// Separate immediate tools from edits requiring review
		for (const toolCall of toolCalls) {
			if (toolCall.tool === "editFile") {
				pendingEdits.push(toolCall);
				this.addMessageToChat(
					"system",
					`Agent proposes changes to ${toolCall.params.path}. Review required.`
				);
			} else {
				// Execute immediate tools (e.g., readFile)
				let result: any;
				let errorOccurred = false;
				this.addMessageToChat(
					"system",
					`Executing immediate tool: ${toolCall.tool}...`
				);
				try {
					result = await this.executeSingleTool(toolCall); // Executes readFile, etc.
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

				// Display truncated result
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

		// If there are edits requiring review, handle them
		if (pendingEdits.length > 0) {
			try {
				// Process edits sequentially, awaiting user confirmation for each
				const editResults = await this.reviewAndExecuteEdits(
					pendingEdits
				);
				executedResults.push(...editResults); // Add results from edits
			} catch (reviewError: any) {
				// Handle errors during the review process itself (e.g., failed file read for diff)
				console.error("Error during edit review process:", reviewError);
				this.addMessageToChat(
					"system",
					`Error processing proposed edits: ${reviewError.message}`,
					true
				);
				// We might still want to send back results of successfully executed immediate tools
				immediateExecutionError = true; // Mark overall error
			}
		}

		// Send results back ONLY if there were executed tools or reviewed edits
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
				// Error sending results is handled by callBackend
				this.setLoadingState(false); // Ensure loading resets if sending fails
			}
			// Loading state will be reset by the *response* from /tool_result in callBackend
		} else if (!immediateExecutionError && pendingEdits.length === 0) {
			// If there were no tools to execute and no edits to review (shouldn't happen if tool_calls > 0)
			console.warn(
				"ProVibe: processToolCalls finished with no results to send."
			);
			this.setLoadingState(false);
		} else if (immediateExecutionError) {
			// If an immediate tool failed, we might have already sent its error result. Reset loading.
			// Or if review process failed.
			this.setLoadingState(false);
		}
		// If only pending edits existed and were cancelled, setLoadingState(false) happens in callBackend response.
	}

	// New function to handle review and execution of pending edits
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

	// Executes a single tool call (for tools not requiring review, e.g., readFile)
	private async executeSingleTool(toolCall: BackendToolCall): Promise<any> {
		let result: any;
		switch (toolCall.tool) {
			case "readFile":
				result = await this.toolReadFile(toolCall.params.path);
				break;
			// editFile is now handled by reviewAndExecuteEdits -> displayDiffModalForReview -> toolEditFile
			// case "editFile":
			// 	result = await this.toolEditFile(
			// 		toolCall.params.path,
			// 		toolCall.params.code_edit,
			// 		toolCall.params.instructions
			// 	);
			// 	break;
			default:
				// Throw error for unknown immediate tool
				console.warn(
					`Encountered potentially unknown immediate tool: ${toolCall.tool}. Trying to execute...`
				);
				// Attempt to execute anyway, maybe more tools exist?
				// This is risky, better to have explicit cases or a check.
				// For now, let's throw an error for safety.
				throw new Error(
					`Unknown immediate tool '${toolCall.tool}' requested.`
				);
		}
		return result;
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

	// toolEditFile now takes the final reconstructed content
	private async toolEditFile(
		path: string,
		final_content: string,
		instructions: string
	): Promise<string> {
		// Strip leading './' if present
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
