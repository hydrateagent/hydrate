import {
	MarkdownView,
	Notice,
	Plugin,
	TFile, // Added
	WorkspaceLeaf,
	ItemView,
} from "obsidian";

import {
	HydrateView,
	HYDRATE_VIEW_TYPE,
} from "./components/HydrateView/hydrateView";
import * as React from "react"; // Added
import {
	ReactViewProps,
	RegistryEntry,
	RuleEntry, // <<< ADDED IMPORT
	ChatHistory, // Added for chat history feature
} from "./types"; // Corrected path
import { ReactViewHost } from "./ReactViewHost"; // Corrected path
import IssueBoardView from "./components/IssueBoardView"; // Corrected path
import { HydrateSettingTab } from "./settings/HydrateSettingTab"; // Corrected path
// Styles are now compiled into styles.css via hydrate-styles.css

import {
	initializeVectorSystem, // Only loads local index now
	addOrUpdateDocumentsBatch, // Use this for bulk indexing
	deleteDocumentFromIndex, // Use this for delete (no remote call needed)
	shouldSkipPath, // Import shouldSkipPath from vectorIndex
} from "./vectorIndex"; // Updated imports

import { handleSearchProject } from "./toolHandlers"; // <<< ADD IMPORT

// MCP imports
import { MCPServerManager, MCPConfigStorage } from "./mcp/MCPServerManager";
import { devLog } from "./utils/logger";

// Remember to rename these classes and interfaces!

// --- React View Registry ---
const reactViewRegistry = new Map<
	string,
	React.ComponentType<ReactViewProps>
>();

export function registerReactView(
	key: string,
	component: React.ComponentType<ReactViewProps>,
): void {
	if (reactViewRegistry.has(key)) {
		devLog.warn(`Hydrate: Overwriting React view for key "${key}"`);
	}
	reactViewRegistry.set(key, component);
}

export function getReactViewComponent(
	key: string,
): React.ComponentType<ReactViewProps> | undefined {
	return reactViewRegistry.get(key);
}
// --- End React View Registry ---

// Define allowed model names (matches backend agent.py ModelName Literal)
export const ALLOWED_MODELS = [
	"gpt-4.1-mini", // Default
	"gpt-4.1",
	"o4-mini",
	"claude-3-7-sonnet-latest",
	"claude-3-5-haiku-latest",
	"claude-sonnet-4-0",
	"gemini-2.5-flash-preview-05-20",
	"gemini-2.5-pro-preview-05-06",
] as const; // Use const assertion for stricter typing

export type ModelName = (typeof ALLOWED_MODELS)[number]; // Create type from array values

export interface HydratePluginSettings {
	developmentPath: string;
	backendUrl: string;
	registryEntries: RegistryEntry[]; // Existing registry
	rulesRegistryEntries: RuleEntry[]; // <<< ADDED rules registry
	chatHistories: ChatHistory[]; // Chat history storage
	selectedModel: ModelName; // Add setting for selected LLM
	apiKey: string; // <<< ADDED default empty API Key (deprecated, kept for compatibility)

	// --- BYOK Subscription Settings ---
	licenseKey: string; // License key for paid subscriptions
	openaiApiKey: string; // User's OpenAI API key
	anthropicApiKey: string; // User's Anthropic API key
	googleApiKey: string; // User's Google API key

	// --- NEW: Settings for Remote Embeddings ---
	enableRemoteEmbeddings: boolean;
	remoteEmbeddingUrl: string;
	remoteEmbeddingApiKey: string;
	remoteEmbeddingModelName: string;
	indexFileExtensions: string; // New setting for file extensions
	mcpServers: any[]; // Added mcpServers property

	// --- MCP PATH Configuration ---
	mcpCustomPaths: string; // Comma-separated list of paths to add to PATH for MCP servers
}

// Default content for the /issue command
const DEFAULT_ISSUE_COMMAND_CONTENT = `When creating an issue, use the following guide exactly.  Otherwise the content will not be viewable. Items that are in [] must be verbatim  Items that are in {} should be replaced with content.  instructional comments below are in (), do not include them in your output.  The markdown structure must be followed exactly, including the yaml header:

---
hydrate-plugin: issue-board
---

# {Category} (not necessary for each Issue, groups multiple Issues)

## {New Issue Title} (give it a name)
- {issue-number-placeholder}  (assign a number)
### Items (must be this exact word)
- item 1 (content about the issue)
- item 2 (content about the issue)
### Status (must be this exact word, and everything below)
- [ ] Specced
- [ ] Built
- [ ] Tested
- [ ] Deployed
`;

// --- Default Rule Content ---
const DEFAULT_CONVERSATION_RULE_TEXT = `This rules controls how text can be added to this file.  Whenever the user asks for an edit to this file, he wants you to follow the following rules. This file is structured as a conversation between you and the user.  It must be structured with alternating headers, noting who is to speaking:


## User

<their questions go here>

## Agent

<your responses go here>


This alternating pattern should repeat down the page.  When the user makes their input, you answer with an edit that appends the new exchange to the end of the file:

1) First their question under a new User heading
2) Next your answer under a new Agent heading.`;

const DEFAULT_CONVERSATION_RULE: RuleEntry = {
	id: "default-conversation-rule", // The ID used in `hydrate-rule: [default-conversation-rule]` tag
	description: "Example rule: Structure file as User/Agent conversation.",
	ruleText: DEFAULT_CONVERSATION_RULE_TEXT,
	version: 1,
};
// --- End Default Rule Content ---

const DEFAULT_SETTINGS: HydratePluginSettings = {
	developmentPath: "", // <<< ADDED default empty developmentPath set dynamically
	backendUrl: "https://api.hydrateagent.com",
	registryEntries: [], // Existing initialization
	rulesRegistryEntries: [], // <<< Initialized as empty
	chatHistories: [], // Initialize chat histories as empty
	selectedModel: "gpt-4.1-mini", // Set default model
	apiKey: "", // <<< ADDED default empty API Key (deprecated, kept for compatibility)

	// --- BYOK Subscription Settings ---
	licenseKey: "", // Default to empty (free tier)
	openaiApiKey: "", // Default to empty
	anthropicApiKey: "", // Default to empty
	googleApiKey: "", // Default to empty

	// --- NEW: Default values for Remote Embeddings ---
	enableRemoteEmbeddings: false, // Default to disabled
	remoteEmbeddingUrl: "https://api.openai.com/v1/embeddings", // Default to OpenAI endpoint
	remoteEmbeddingApiKey: "", // Default to empty
	remoteEmbeddingModelName: "text-embedding-3-small", // Default to OpenAI's model
	indexFileExtensions: "md", // Default to only markdown
	mcpServers: [], // Initialize mcpServers
	mcpCustomPaths: "/usr/local/bin,/opt/homebrew/bin", // Default common paths
};

export const REACT_HOST_VIEW_TYPE = "hydrate-react-host"; // Define type for React host

// Define a type for the prepared tool calls received from the agent
interface AgentPreparedToolCall {
	id: string;
	tool: string;
	params: any; // Parameters for the tool
	// action: string; // Might also include 'action' field like 'tool_call'
}

// Define a type for the results to send back to the agent
interface ToolExecutionResult {
	id: string; // The ID of the original tool call
	result: string; // The result of the tool execution (stringified if complex)
}

export default class HydratePlugin extends Plugin {
	settings: HydratePluginSettings;
	isSwitchingToMarkdown: boolean = false;
	view: HydrateView | null = null; // Keep reference to the view instance
	isIndexing: boolean = false; // Flag to prevent concurrent indexing
	mcpManager: MCPServerManager | null = null; // MCP Server Manager

	async onload() {
		await this.loadSettings();
		// Set developmentPath dynamically based on the actual config directory
		this.settings.developmentPath = this.manifest.dir || "";

		// --- Initialize Vector System (Only if embeddings are enabled) ---
		// Don't initialize vector system for new users or when embeddings are disabled
		// This prevents unnecessary directory creation and setup for users who haven't configured embeddings
		if (
			this.settings.enableRemoteEmbeddings &&
			this.settings.remoteEmbeddingUrl &&
			this.settings.remoteEmbeddingApiKey
		) {
			await initializeVectorSystem(this.app);
		} else {
			devLog.warn(
				"Embeddings are disabled or not configured, skipping vector system initialization.",
			);
		}

		// --- Initialize MCP Server Manager ---
		try {
			// Create MCP server manager
			const plugin = this; // Capture reference for use in config storage
			const configStorage: MCPConfigStorage = {
				async saveConfig(config: any): Promise<void> {
					// Store MCP config in plugin settings
					plugin.settings.mcpServers = config.servers || [];
					await plugin.saveSettings();
				},
				async loadConfig(): Promise<any> {
					// Load MCP config from plugin settings
					return {
						servers: plugin.settings.mcpServers || [],
					};
				},
			};

			this.mcpManager = new MCPServerManager();
			this.mcpManager.setStorage(configStorage);

			// Set custom paths from settings
			if (this.settings.mcpCustomPaths) {
				const paths = this.settings.mcpCustomPaths
					.split(",")
					.map((p) => p.trim())
					.filter((p) => p.length > 0);
				this.mcpManager.setCustomPaths(paths);
			}

			// Debug: Check what MCP servers are in settings

			// Load existing MCP servers from settings
			if (
				this.settings.mcpServers &&
				this.settings.mcpServers.length > 0
			) {
				let loadedCount = 0;
				let failedCount = 0;

				for (const serverConfig of this.settings.mcpServers) {
					try {
						await this.mcpManager.addServer(
							serverConfig.id,
							serverConfig,
						);
						loadedCount++;
					} catch (error) {
						devLog.error(
							`✗ Failed to load server ${serverConfig.id} (${serverConfig.name}):`,
							error,
						);
						failedCount++;
					}
				}

				// Verify servers are actually in the manager
				const managerServerIds = this.mcpManager.getServerIds();

				// Trigger tool discovery for any servers that are already running
				let discoveryCount = 0;
				for (const serverId of managerServerIds) {
					const server = this.mcpManager.getServer(serverId);
					const status = this.mcpManager.getServerStatus(serverId);
					if (server && status === "running") {
						try {
							const tools =
								await this.mcpManager.refreshServerTools(
									serverId,
								);
							discoveryCount++;
						} catch (error) {
							devLog.error(
								`✗ Tool discovery failed for ${serverId}:`,
								error,
							);
						}
					}
				}
			} else {
				devLog.warn("No MCP servers configured in settings");
			}
		} catch (error) {
			devLog.error("Failed to initialize MCP Server Manager:", error);
			new Notice(
				"Failed to initialize MCP Server Manager. MCP tools will not be available.",
			);
		}

		// Custom styles are now loaded automatically from styles.css

		// Register the custom view
		this.registerView(HYDRATE_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
			// Store the view instance when created
			this.view = new HydrateView(leaf, this);
			return this.view;
		});

		// Register example component (we'll create this later)
		registerReactView("issue-board", IssueBoardView); // <<< ADD THIS REGISTRATION

		// --- Event Listeners for File Changes ---
		// REMOVED: Automatic indexing on file create/modify to prevent unwanted indexing on startup
		// Users must manually trigger indexing via settings panel

		// Keep only the delete event listener to clean up deleted files from index
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				// Only attempt to remove from index if embeddings are enabled
				// This prevents unnecessary operations when vector indexing is not being used
				if (this.settings.enableRemoteEmbeddings) {
					// No need to await, let it run in the background
					deleteDocumentFromIndex(this.app, file.path).catch(
						(err: any) =>
							devLog.error(
								`Error removing deleted file ${file.path} from index:`,
								err,
							),
					);
				}
			}),
		);

		// --- Event Listener for File Open (Re-enabled for file attachment logic) ---
		this.registerEvent(
			this.app.workspace.on("file-open", this.handleFileOpen),
		);

		// --- Toggle Command ---
		this.addCommand({
			id: "toggle-hydrate-react-view",
			name: "Toggle Markdown / React View",
			checkCallback: this.checkToggleReactView,
		});

		// --- Add Layout Change Handler ---
		this.registerEvent(
			this.app.workspace.on("layout-change", this.handleLayoutChange),
		);

		// This creates an icon in the left ribbon to open the Hydrate pane
		const ribbonIconEl = this.addRibbonIcon(
			"droplet", // Water droplet icon for Hydrate
			"Open Hydrate Pane",
			async (evt: MouseEvent) => {
				// Open the pane when the icon is clicked
				await this.activateView();
			},
		);
		// Perform additional things with the ribbon
		ribbonIconEl.addClass("hydrate-ribbon-class");

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new HydrateSettingTab(this.app, this)); // <<< USE IMPORTED SETTING TAB

		// --- React View Host Registration ---
		this.registerView(REACT_HOST_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
			return new ReactViewHost(leaf, this);
		});

		// --- Add Selection Command ---
		this.addCommand({
			id: "add-selection-to-hydrate",
			name: "Add selection to context",
			callback: () => {
				// 1. Get active editor and selection
				const activeMdView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!activeMdView || !activeMdView.editor) {
					new Notice("No active Markdown editor found.");
					return;
				}
				const selection = activeMdView.editor.getSelection();
				if (!selection) {
					new Notice("No text selected.");
					return;
				}

				// 2. Find the Hydrate view instance
				const leaves =
					this.app.workspace.getLeavesOfType(HYDRATE_VIEW_TYPE);
				if (
					leaves.length === 0 ||
					!(leaves[0].view instanceof HydrateView)
				) {
					new Notice("Hydrate pane not found or is not active.");
					// Optionally, activate the view here if desired?
					// this.activateView(); // Consider if this makes sense
					return;
				}
				const hydrateView = leaves[0].view as HydrateView;

				// 3. Store selection and update input
				hydrateView.capturedSelections.push(selection); // Push to array
				const index = hydrateView.capturedSelections.length; // Get the new length (which is the index+1)
				const formattedIndex = index.toString().padStart(2, "0"); // Zero-pad
				const token = `/select${formattedIndex}`; // Create token like /select01

				// Append the token to the current text
				const currentText = hydrateView.textInput.value;
				const separator =
					currentText.length > 0 && !currentText.endsWith(" ")
						? " "
						: ""; // Add space if needed
				const newValue = `${currentText}${separator}${token} `;
				hydrateView.textInput.value = newValue;

				// Trigger input event for potential UI updates (like textarea resize)
				hydrateView.textInput.dispatchEvent(
					new Event("input", { bubbles: true }),
				);

				// Focus the input area
				hydrateView.textInput.focus();

				new Notice(
					"Selected text captured and /select added to Hydrate.",
				);
			},
		});

		// --- Add Context Menu for Text Selection ---
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				// Only add menu item if there's a text selection
				if (editor.getSelection()) {
					menu.addItem((item) => {
						item.setTitle("Capture Selection for Hydrate")
							.setIcon("droplet")
							.onClick(() => {
								// Execute the same logic as the command
								(this.app as any).commands.executeCommandById(
									"add-selection-to-hydrate",
								);
							});
					});
				}
			}),
		);
		// --- End Add Selection Command ---

		/**
		 * Conceptual function to process tool calls from the agent.
		 * You would call this function when your plugin receives a response from the agent
		 * that includes tool_calls_prepared.
		 *
		 * @param preparedCalls An array of tool calls from the agent.
		 * @returns A promise that resolves to an array of tool execution results.
		 */
		this.addCommand({
			id: "process-agent-tool-calls",
			name: "Process agent tool calls",
			callback: async () => {
				const toolCalls = await this.processAgentToolCalls([]);
				new Notice(`Processed ${toolCalls.length} tool calls.`);
			},
		});
	}

	// --- Activate/Deactivate View ---
	async activateView() {
		const { workspace } = this.app;
		let sourceFilePath: string | null = null;

		// Get active file path BEFORE activating Hydrate view
		const currentActiveLeaf = workspace.activeLeaf;
		if (currentActiveLeaf) {
			const currentView = currentActiveLeaf.view;
			// Get path from MarkdownView or ReactViewHost (if applicable)
			if (currentView instanceof MarkdownView && currentView.file) {
				sourceFilePath = currentView.file.path;
			} else if (
				currentView instanceof ReactViewHost &&
				currentView.currentFilePath
			) {
				sourceFilePath = currentView.currentFilePath;
			} else if (
				currentView instanceof ItemView &&
				currentView.getViewType() !== HYDRATE_VIEW_TYPE
			) {
				// Try to get file from generic ItemView if possible (might not always work)
				const state = currentView.getState();
				if (state?.file) {
					const file = this.app.vault.getAbstractFileByPath(
						state.file,
					);
					if (file instanceof TFile) {
						sourceFilePath = file.path;
					}
				}
			} else {
				devLog.warn(
					`Hydrate activateView: Active view is not Markdown or ReactViewHost or did not yield a file path.`,
				);
			}
		} else {
			devLog.warn(`Hydrate activateView: No active leaf found.`);
		}

		// If view is already open in a leaf, reveal that leaf
		const existingLeaves = workspace.getLeavesOfType(HYDRATE_VIEW_TYPE);
		if (existingLeaves.length > 0) {
			const existingLeaf = existingLeaves[0];
			workspace.revealLeaf(existingLeaf);
			// If a source file was found *now*, and the existing view has no files attached, attach it.
			if (
				sourceFilePath &&
				existingLeaf.view instanceof HydrateView &&
				existingLeaf.view.attachedFiles.length === 0
			) {
				(existingLeaf.view as HydrateView).attachInitialFile(
					sourceFilePath,
				);
			} else {
				devLog.warn(
					`Hydrate activateView: Existing view revealed. Source file: ${sourceFilePath}. View state not modified.`,
				);
			}
			return;
		}

		// Open the view in the right sidebar
		const leaf = workspace.getRightLeaf(false);

		if (!leaf) {
			devLog.error("Hydrate: Could not get right sidebar leaf");
			return;
		}

		// Pass the source file path in the state when opening the view
		const viewStateToSet: any = {
			// Use 'any' temporarily if strict type causes issues
			type: HYDRATE_VIEW_TYPE,
			active: true,
			state: {}, // Initialize empty state object
		};
		if (sourceFilePath) {
			viewStateToSet.state.sourceFilePath = sourceFilePath; // Add sourceFilePath if found
		}

		await leaf.setViewState(viewStateToSet);

		// 'this.view' will be set by the view factory function registered earlier
		if (leaf.view instanceof HydrateView) {
			this.view = leaf.view; // Ensure our reference is correct
		}
		workspace.revealLeaf(leaf); // Reveal after setting state
	}

	async deactivateView() {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(HYDRATE_VIEW_TYPE);
		leaves.forEach((leaf) => leaf.detach());
		this.view = null; // Clear the reference
	}

	// --- File Open Handler (Simplified for File Attachment Logic) ---
	handleFileOpen = async (file: TFile | null) => {
		// --- Part 1: Notify the Hydrate Pane (Keep this logic) ---
		if (this.view && this.view.containerEl.isShown()) {
			// Pass the new file path (or null) to the view instance
			this.view.handleActiveFileChange(file?.path ?? null);
		} else {
			devLog.warn(
				`Hydrate [file-open]: Hydrate view is not open or not visible, ignoring file change.`,
			);
		}

		// --- Part 2: Handle Main Editor View Switching (Uncommented and Refined) ---
		const leaf = this.app.workspace.getActiveViewOfType(ItemView)?.leaf; // Get active leaf first
		if (!leaf) {
			devLog.warn(
				"Hydrate [file-open]: No active leaf found. Cannot switch view.",
			);
			return; // Exit if no active leaf
		}

		const currentView = leaf.view;

		// Handle case where file becomes null (e.g., closing last tab)
		if (!file) {
			if (currentView instanceof ReactViewHost) {
				devLog.warn(
					"Hydrate [file-open]: File is null, switching React Host back to Markdown.",
				);
				// Check if ReactViewHost expects a file path; might need adjustment if it crashes on null
				// Assuming switchToMarkdownView handles the transition gracefully
				if (!this.isSwitchingToMarkdown) {
					currentView.switchToMarkdownView();
				} else {
					devLog.warn(
						"Hydrate [file-open]: Already switching to markdown, skipping.",
					);
				}
			} else {
				devLog.warn(
					"Hydrate [file-open]: File is null, current view is not React Host. No action needed.",
				);
			}
			return; // Stop processing if file is null
		}

		// File is guaranteed non-null from here onwards

		// ---- VIEW SWITCHING LOGIC REMOVED ----
		// The handleLayoutChange listener is now responsible for enforcing the correct view type.
		// Attempting to switch views directly within file-open proved unreliable.
		// We keep the file-open listener primarily to notify the separate Hydrate pane if needed.
	};
	// --- End File Open Handler ---

	// --- Toggle Command Check Callback ---
	checkToggleReactView = (checking: boolean): boolean => {
		const leaf = this.app.workspace.activeLeaf;
		if (!leaf) return false;

		const currentView = leaf.view;

		if (currentView instanceof ReactViewHost) {
			// Can always toggle back to Markdown from React Host
			if (!checking) {
				currentView.switchToMarkdownView(); // Use the host's method
			}
			return true;
		} else if (currentView instanceof MarkdownView && currentView.file) {
			// Check if the Markdown view *should* have a React view
			const file = currentView.file;
			const fileCache = this.app.metadataCache.getFileCache(file);
			const frontmatter = fileCache?.frontmatter;
			const triggerKey = "hydrate-plugin"; // Consistent key
			const viewKey = frontmatter?.[triggerKey] as string | undefined;
			const ReactComponent = viewKey
				? getReactViewComponent(viewKey)
				: undefined;

			if (ReactComponent) {
				// Can toggle to React view
				if (!checking && viewKey) {
					// Ensure viewKey is valid before setting state
					leaf.setViewState({
						type: REACT_HOST_VIEW_TYPE,
						state: { filePath: file.path, viewKey: viewKey },
						active: true, // Ensure the leaf becomes active
					} as any);
				}
				return true;
			}
		}

		// Cannot toggle in other cases
		return false;
	};
	// --- End Toggle Command Check Callback ---

	// --- Layout Change Handler (Re-enabled and Refined) ---
	handleLayoutChange = async () => {
		// Check if we are intentionally switching back to markdown
		if (this.isSwitchingToMarkdown) {
			this.isSwitchingToMarkdown = false; // Reset the flag *after* skipping the check
			return;
		}

		const leaf = this.app.workspace.activeLeaf;
		if (!leaf) {
			devLog.debug("Hydrate [layout-change]: No active leaf.");
			return;
		}

		const currentView = leaf.view;

		// Scenario 1: Active view is Markdown, but should it be React?
		if (currentView instanceof MarkdownView && currentView.file) {
			const file = currentView.file;
			const fileCache = this.app.metadataCache.getFileCache(file);
			if (!fileCache) {
				devLog.debug(
					"Hydrate [layout-change]: File cache not ready, skipping check.",
				);
				return;
			}
			const frontmatter = fileCache.frontmatter;
			const triggerKey = "hydrate-plugin";
			const viewKey = frontmatter?.[triggerKey] as string | undefined;
			const ReactComponent = viewKey
				? getReactViewComponent(viewKey)
				: undefined;

			if (ReactComponent && viewKey) {
				// It should be a React view, but it's currently Markdown.
				const currentMode = currentView.getMode();
				const currentState = currentView.getState();
				const isSourceMode = currentState.source === true; // Explicitly check source state

				// Switch if in Reading ("preview") or Live Preview (mode=="source" AND state.source==false)
				if (currentMode === "preview" || !isSourceMode) {
					try {
						await leaf.setViewState({
							type: REACT_HOST_VIEW_TYPE,
							state: { filePath: file.path, viewKey: viewKey },
							active: true,
						});
					} catch (error) {
						devLog.error(
							"Hydrate [layout-change]: Error switching Markdown to React:",
							error,
						);
					}
				}
			}
		}
		// Scenario 2: Active view is React, but should it be Markdown?
		else if (currentView instanceof ReactViewHost) {
			const filePath = currentView.currentFilePath;
			if (!filePath) {
				await currentView.switchToMarkdownView();
				return;
			}

			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) {
				devLog.warn(
					`Hydrate [layout-change]: ReactHost has path ${filePath}, but it's not a valid file. Switching to Markdown.`,
				);
				await currentView.switchToMarkdownView();
				return;
			}

			const fileCache = this.app.metadataCache.getFileCache(file);
			if (!fileCache) {
				devLog.debug(
					"Hydrate [layout-change]: File cache not ready for ReactHost file, skipping check.",
				);
				return;
			}
			const frontmatter = fileCache.frontmatter;
			const triggerKey = "hydrate-plugin";
			const viewKey = frontmatter?.[triggerKey] as string | undefined;
			const ReactComponent = viewKey
				? getReactViewComponent(viewKey)
				: undefined;

			if (!ReactComponent || !viewKey) {
				devLog.debug(
					`Hydrate [layout-change]: Active view is React for ${filePath}, but should be Markdown (key missing or invalid). Switching back...`,
				);
				await currentView.switchToMarkdownView();
			}
		}
	};
	// --- End Layout Change Handler ---

	onunload() {
		// Clean up when the plugin is disabled
		this.deactivateView(); // This will also detach leaves
		this.view = null; // Ensure reference is cleared

		// Clean up MCP Server Manager
		if (this.mcpManager) {
			try {
				// Stop all servers
				this.mcpManager.stopAllServers();
				this.mcpManager = null;
			} catch (error) {
				devLog.error(
					"Error during MCP Server Manager shutdown:",
					error,
				);
			}
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);

		// --- Initialize Default Format Registry Entry ---
		// Ensure array exists
		if (
			!this.settings.registryEntries ||
			!Array.isArray(this.settings.registryEntries)
		) {
			// If empty or not an array, initialize it with the default entry
			this.settings.registryEntries = [
				{
					id: "default-issue-board",
					description:
						"Default template for creating an issue board.",
					version: 1,
					contentType: "markdown",
					content: DEFAULT_ISSUE_COMMAND_CONTENT,
					slashCommandTrigger: "/issue",
				},
			];
		} else {
			// If it exists as an array, check if the default entry is present
			const defaultIssueExists = this.settings.registryEntries.some(
				(entry) =>
					entry.id === "default-issue-board" ||
					entry.slashCommandTrigger === "/issue",
			);
			if (!defaultIssueExists) {
				// Add it if missing
				this.settings.registryEntries.push({
					id: "default-issue-board",
					description:
						"Default template for creating an issue board.",
					version: 1,
					contentType: "markdown",
					content: DEFAULT_ISSUE_COMMAND_CONTENT,
					slashCommandTrigger: "/issue",
				});
			}
		}
		// --- End Initialize Default Format Registry Entry ---

		// --- Initialize Default Rules Registry Entry ---
		// Ensure array exists
		if (
			!this.settings.rulesRegistryEntries ||
			!Array.isArray(this.settings.rulesRegistryEntries)
		) {
			// Initialize with the default rule if empty or invalid
			this.settings.rulesRegistryEntries = [DEFAULT_CONVERSATION_RULE];
		} else {
			// Check if the default conversation rule is present if array already exists
			const defaultConversationRuleExists =
				this.settings.rulesRegistryEntries.some(
					(rule) => rule.id === DEFAULT_CONVERSATION_RULE.id,
				);
			if (!defaultConversationRuleExists) {
				this.settings.rulesRegistryEntries.push(
					DEFAULT_CONVERSATION_RULE,
				);
			}
		}
		// --- End Initialize Default Rules Registry Entry ---

		// --- Initialize Chat Histories Array ---
		if (
			!this.settings.chatHistories ||
			!Array.isArray(this.settings.chatHistories)
		) {
			this.settings.chatHistories = [];
		}
		// --- End Initialize Chat Histories Array ---
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// --- Helper function to get registry entries (for agent/slash commands) ---
	getRegistryEntries(): RegistryEntry[] {
		// Ensure array exists, return empty array if not
		return this.settings.registryEntries || [];
	}

	getRegistryEntryByTrigger(trigger: string): RegistryEntry | undefined {
		// Ensure array exists before searching
		return this.settings.registryEntries?.find(
			(entry) => entry.slashCommandTrigger === trigger,
		);
	}

	getRegistryEntryById(id: string): RegistryEntry | undefined {
		// Ensure array exists before searching
		return this.settings.registryEntries?.find((entry) => entry.id === id);
	}
	// --- End Helper functions ---

	// --- Helper functions for Rules Registry --- <<< ADDED
	getRulesRegistryEntries(): RuleEntry[] {
		// Ensure array exists, return empty array if not
		return this.settings.rulesRegistryEntries || [];
	}

	getRuleById(id: string): RuleEntry | undefined {
		// Ensure array exists before searching
		return this.settings.rulesRegistryEntries?.find(
			(entry) => entry.id === id,
		);
	}
	// --- End Rules Registry Helper functions ---

	// --- Helper function to get selected model --- // <<< ADDED
	getSelectedModel(): ModelName {
		// Ensure the stored value is valid, otherwise return default
		return ALLOWED_MODELS.includes(this.settings.selectedModel)
			? this.settings.selectedModel
			: "gpt-4.1-mini";
	}

	// NOTE: __HYDRATE_DEV__ must be set by the bundler at build time (true for dev, false for prod)
	getBackendUrl(): string {
		// Only use the user-configured backend in true development builds
		if (
			typeof __HYDRATE_DEV__ !== "undefined" &&
			(__HYDRATE_DEV__ === true || __HYDRATE_DEV__ === "true")
		) {
			return this.settings.backendUrl || "http://localhost:8000";
		}
		// In all other cases, always use the production backend
		return "https://api.hydrateagent.com";
	}

	private isDevelopmentMode(): boolean {
		// Only use the build-time NODE_ENV
		return process.env.NODE_ENV === "development";
	}
	// --- End Helper function --- // <<< ADDED

	// --- Helper functions for Chat History Management ---
	getChatHistories(): ChatHistory[] {
		return this.settings.chatHistories || [];
	}

	getChatHistoryById(id: string): ChatHistory | undefined {
		return this.settings.chatHistories?.find((chat) => chat.id === id);
	}

	async saveChatHistory(chatHistory: ChatHistory): Promise<void> {
		if (!this.settings.chatHistories) {
			this.settings.chatHistories = [];
		}

		const existingIndex = this.settings.chatHistories.findIndex(
			(chat) => chat.id === chatHistory.id,
		);

		if (existingIndex >= 0) {
			// Update existing chat
			this.settings.chatHistories[existingIndex] = chatHistory;
		} else {
			// Add new chat
			this.settings.chatHistories.push(chatHistory);
		}

		await this.saveSettings();
	}

	async deleteChatHistory(id: string): Promise<void> {
		if (!this.settings.chatHistories) return;

		this.settings.chatHistories = this.settings.chatHistories.filter(
			(chat) => chat.id !== id,
		);

		await this.saveSettings();
	}
	// --- End Chat History Helper functions ---

	// --- Add method to initialize vector system from settings ---
	async initializeVectorSystemIfNeeded() {
		if (
			this.settings.enableRemoteEmbeddings &&
			this.settings.remoteEmbeddingUrl &&
			this.settings.remoteEmbeddingApiKey
		) {
			await initializeVectorSystem(this.app);
		}
	}

	// --- Add Initial Indexing Function ---
	async triggerInitialIndexing(forceRebuild: boolean = false) {
		if (!this.settings.enableRemoteEmbeddings) {
			new Notice(
				"Remote embeddings are disabled in settings. Cannot start indexing.",
			);
			return;
		}
		// Add check for incomplete remote embedding config before starting
		if (
			!this.settings.remoteEmbeddingUrl ||
			!this.settings.remoteEmbeddingApiKey ||
			!this.settings.remoteEmbeddingModelName
		) {
			new Notice(
				"Remote embedding configuration is incomplete. Please check settings in Hydrate plugin options.",
			);
			return;
		}

		if (this.isIndexing) {
			new Notice("Indexing is already in progress.");
			return;
		}

		this.isIndexing = true;

		if (forceRebuild) {
			new Notice("Rebuilding vector index from scratch...");
			// Reinitialize with force rebuild to clear corrupted data
			await initializeVectorSystem(this.app, true);
		} else {
			new Notice(
				"Starting vault indexing... This will be much faster with batch processing.",
			);
		}

		const allFiles = this.app.vault.getFiles();

		// Pre-filter files to avoid processing obviously irrelevant files
		const fileExtension = this.settings.indexFileExtensions || "";
		const allowedExtensions = fileExtension
			.split(",")
			.map((ext) => ext.trim().toLowerCase())
			.filter((ext) => ext.length > 0);

		const filteredFiles = allFiles.filter((file) => {
			// CRITICAL: Extension check is mandatory - only process configured extensions
			if (allowedExtensions.length === 0) {
				// If no extensions configured, don't process ANY files
				return false;
			}

			const fileExt = file.extension.toLowerCase();
			if (!allowedExtensions.includes(fileExt)) {
				// File extension not in allowed list - skip
				return false;
			}

			// Path filtering using shouldSkipPath (which blocks ALL hidden files)
			const shouldSkip = shouldSkipPath(file.path);
			return !shouldSkip;
		});

		try {
			const result = await addOrUpdateDocumentsBatch(
				this.app,
				filteredFiles,
				this.settings,
			);

			const completionMessage = `Vault indexing completed! Processed: ${result.processed}, Indexed: ${result.indexed}, Skipped: ${result.skipped}, Errors: ${result.errors}`;

			if (result.errors > 0) {
				devLog.warn(completionMessage);
			}

			new Notice(completionMessage);
		} catch (error) {
			devLog.error("Vault indexing failed:", error);
			new Notice("Vault indexing failed. Check console for details.");
		}

		this.isIndexing = false;
	}

	// Add a function to potentially stop indexing if needed
	stopIndexing() {
		if (this.isIndexing) {
			this.isIndexing = false; // Set flag to stop loop
		}
	}

	/**
	 * Conceptual function to process tool calls from the agent.
	 * You would call this function when your plugin receives a response from the agent
	 * that includes tool_calls_prepared.
	 *
	 * @param preparedCalls An array of tool calls from the agent.
	 * @returns A promise that resolves to an array of tool execution results.
	 */
	async processAgentToolCalls(
		preparedCalls: AgentPreparedToolCall[],
	): Promise<ToolExecutionResult[]> {
		const toolResults: ToolExecutionResult[] = [];

		if (!preparedCalls || preparedCalls.length === 0) {
			return toolResults;
		}

		for (const call of preparedCalls) {
			if (call.tool === "search_project") {
				// Ensure params structure matches what handleSearchProject expects for its 'call' argument
				const searchCall = {
					id: call.id,
					tool: call.tool,
					params: call.params, // handleSearchProject will cast this to SearchProjectParams
				};
				const searchResult = await handleSearchProject(
					searchCall,
					this.app,
					this.settings,
				);
				toolResults.push(searchResult);
			}
			// --- Add other tool handlers here as else if (call.tool === "anotherTool") ---
			// Example for readFile (conceptual, actual implementation would be similar)
			// else if (call.tool === "readFile") {
			//     const path = call.params.path as string;
			//     try {
			//         const content = await this.app.vault.adapter.read(path);
			//         toolResults.push({ id: call.id, result: content });
			//     } catch (error) {
			//         devLog.error(`Error reading file ${path}:`, error);
			//         toolResults.push({ id: call.id, result: `Error reading file: ${error.message}` });
			//     }
			// }
			else {
				devLog.warn(
					`[Hydrate Plugin] Unknown tool call received: ${call.tool}`,
				);
				toolResults.push({
					id: call.id,
					result: `Error: Unknown tool '${call.tool}' requested by agent.`,
				});
			}
		}

		devLog.debug(
			"[Hydrate Plugin] Sending tool results back to agent:",
			toolResults,
		);
		// Here, you would typically send these toolResults back to your FastAPI /tool_result endpoint.
		// For example, via another fetch/requestUrl call if this is not already part of that flow.
		return toolResults;
	}
}

// --- REMOVED RegistryEditModal class definition (moved to src/settings/RegistryEditModal.ts) ---

// --- REMOVED HydrateSettingTab class definition (moved to src/settings/HydrateSettingTab.ts) ---
