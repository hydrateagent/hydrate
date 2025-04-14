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
	private filePillsContainer: HTMLDivElement; // Container for file pills
	private history: HistoryMessage[] = []; // Store richer history
	private attachedFiles: string[] = []; // Store paths of attached files
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
			"ProVibe Agent view opened. Type your prompt or drop files."
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

		if (role === "agent" && content) {
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
			messageEl.setText(content);
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
	}

	// --- Event Handlers ---

	private handleClear = () => {
		this.textInput.value = "";
		this.chatContainer.empty(); // Clear chat display
		this.history = []; // Clear internal history
		this.attachedFiles = []; // Clear attached files state
		this.renderFilePills(); // Update UI
		this.addMessageToChat("system", "Chat cleared.");
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

		// Add combined content to history as the actual message sent
		const userMessage: HistoryMessage = {
			type: "human",
			content: combinedContent,
		};
		this.history.push(userMessage);

		// Clear input and pills AFTER preparing the message
		this.setTextContent("");
		this.attachedFiles = [];
		this.renderFilePills();

		this.setLoadingState(true);

		try {
			await this.callBackend("/chat", {
				message: combinedContent, // Send combined content
				history: this.history.slice(0, -1),
			});
		} catch (error: any) {
			console.error("Error sending message:", error);
			this.addMessageToChat(
				"system",
				`Error: ${error.message || "Failed to connect to backend"}`,
				true
			);
			// Remove the combined message from history
			const lastMsgIndex = this.history.findIndex(
				(msg) => msg === userMessage
			);
			if (lastMsgIndex > -1) {
				this.history.splice(lastMsgIndex, 1);
			}
		} finally {
			// setLoadingState(false) is handled by callBackend
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
