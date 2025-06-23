import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	TFile, // Added
	TFolder, // <<< ADD THIS IMPORT
	ViewStateResult, // Added
	MetadataCache, // Added
	FrontMatterCache, // Added
	PluginSettingTab, // Keep this for HydratePlugin base class if needed, but SettingTab itself is moved
	Setting, // Keep for potential direct use, though unlikely now
	WorkspaceLeaf,
	ItemView,
	ViewCreator,
	TextComponent, // Keep for potential direct use
	TextAreaComponent, // Keep for potential direct use
	DropdownComponent, // Keep for potential direct use
} from "obsidian";

import {
	HydrateView,
	HYDRATE_VIEW_TYPE,
} from "./components/HydrateView/hydrateView";
import * as React from "react"; // Added
import { Root, createRoot } from "react-dom/client"; // Added
import {
	ReactViewProps,
	RegistryEntry,
	RegistryEntryContentType, // Keep this as it's used in settings default
	RuleEntry, // <<< ADDED IMPORT
} from "./types"; // Corrected path
import { ReactViewHost } from "./ReactViewHost"; // Corrected path
import IssueBoardView from "./components/IssueBoardView"; // Corrected path
import { HydrateSettingTab } from "./settings/HydrateSettingTab"; // Corrected path
import { injectSettingsStyles } from "./styles/settingsStyles"; // Corrected path
import { injectPaneStyles } from "./styles/paneStyles"; // <<< ADDED IMPORT

import {
	initializeVectorSystem, // Only loads local index now
	addOrUpdateDocumentRemote, // Use this for create/modify
	deleteDocumentFromIndex, // Use this for delete (no remote call needed)
	searchIndexRemote, // Use this for search
} from "./vectorIndex"; // Updated imports

import { handleSearchProject } from "./toolHandlers"; // <<< ADD IMPORT

import { ManifestFile, DirectoryManifest } from "./manifestUtils"; // Assuming manifestUtils.ts is in the same directory

// MCP imports
import { MCPServerManager } from "./mcp/MCPServerManager";
import { MCPConfigStorage } from "./mcp/index";

// Remember to rename these classes and interfaces!

// --- React View Registry ---
const reactViewRegistry = new Map<
	string,
	React.ComponentType<ReactViewProps>
>();

export function registerReactView(
	key: string,
	component: React.ComponentType<ReactViewProps>
): void {
	if (reactViewRegistry.has(key)) {
		console.warn(`Hydrate: Overwriting React view for key "${key}"`);
	}
	reactViewRegistry.set(key, component);
	console.log(`Hydrate: Registered React view for key "${key}"`);
}

export function getReactViewComponent(
	key: string
): React.ComponentType<ReactViewProps> | undefined {
	return reactViewRegistry.get(key);
}
// --- End React View Registry ---

// Define allowed model names (matches backend agent.py ModelName Literal)
export const ALLOWED_MODELS = [
	"gpt-4.1-mini", // Default
	"gpt-4.1",
	"claude-3-7-sonnet-latest",
	"claude-3-5-haiku-latest",
	"gemini-2.5-flash-preview-04-17",
	"gemini-2.5-pro-exp-03-25",
] as const; // Use const assertion for stricter typing

export type ModelName = (typeof ALLOWED_MODELS)[number]; // Create type from array values

export interface HydratePluginSettings {
	mySetting: string;
	developmentPath: string;
	backendUrl: string;
	paneOrientation: "Bottom" | "Right";
	registryEntries: RegistryEntry[]; // Existing registry
	rulesRegistryEntries: RuleEntry[]; // <<< ADDED rules registry
	selectedModel: ModelName; // Add setting for selected LLM
	apiKey: string; // <<< ADDED default empty API Key

	// --- NEW: Settings for Remote Embeddings ---
	enableRemoteEmbeddings: boolean;
	remoteEmbeddingUrl: string;
	remoteEmbeddingApiKey: string;
	remoteEmbeddingModelName: string;
	indexFileExtensions: string; // New setting for file extensions
	mcpServers: any[]; // Added mcpServers property
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
	mySetting: "default",
	developmentPath: ".obsidian/plugins/hydrate",
	backendUrl: "http://localhost:8000",
	paneOrientation: "Bottom",
	registryEntries: [], // Existing initialization
	rulesRegistryEntries: [], // <<< Initialized as empty
	selectedModel: "gpt-4.1-mini", // Set default model
	apiKey: "", // <<< ADDED default empty API Key

	// --- NEW: Default values for Remote Embeddings ---
	enableRemoteEmbeddings: false, // Default to disabled
	remoteEmbeddingUrl: "https://api.openai.com/v1/embeddings", // Default to OpenAI endpoint
	remoteEmbeddingApiKey: "", // Default to empty
	remoteEmbeddingModelName: "text-embedding-3-small", // Default to OpenAI's model
	indexFileExtensions: "md", // Default to only markdown
	mcpServers: [], // Initialize mcpServers
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

const HYDRATE_DOCS_FOLDER_NAME = "hydrate-docs";
const MANIFEST_FILE_NAME = ".hydrate-manifest.md";

export default class HydratePlugin extends Plugin {
	settings: HydratePluginSettings;
	isSwitchingToMarkdown: boolean = false;
	view: HydrateView | null = null; // Keep reference to the view instance
	isIndexing: boolean = false; // Flag to prevent concurrent indexing
	mcpManager: MCPServerManager | null = null; // MCP Server Manager

	async onload() {
		console.log("Loading Hydrate plugin...");

		await this.loadSettings();

		// --- Initialize Vector System (Loads Local Index) ---
		await initializeVectorSystem(this.app);

		// --- Initialize MCP Server Manager ---
		console.log("Initializing MCP Server Manager...");
		try {
			// Create a simple config storage implementation
			const configStorage: MCPConfigStorage = {
				async saveConfig(config: any): Promise<void> {
					// Store MCP config in plugin settings
					this.settings.mcpServers = config.servers || [];
					await this.saveSettings();
				},
				async loadConfig(): Promise<any> {
					// Load MCP config from plugin settings
					return {
						servers: this.settings.mcpServers || [],
					};
				},
			};

			this.mcpManager = new MCPServerManager();
			this.mcpManager.setStorage(configStorage);
			console.log("MCP Server Manager initialized successfully");
		} catch (error) {
			console.error("Failed to initialize MCP Server Manager:", error);
			new Notice(
				"Failed to initialize MCP Server Manager. MCP tools will not be available."
			);
		}

		// Inject custom styles
		injectSettingsStyles(this);
		injectPaneStyles(this); // <<< CALL NEW FUNCTION

		// Custom styles will be loaded automatically from styles.css

		// Register the custom view
		this.registerView(HYDRATE_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
			// Store the view instance when created
			this.view = new HydrateView(leaf, this);
			return this.view;
		});

		// Register example component (we'll create this later)
		registerReactView("issue-board", IssueBoardView); // <<< ADD THIS REGISTRATION

		// --- Event Listeners for File Changes (Using Remote Embedding Logic) ---
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (
					file instanceof TFile &&
					this.settings.enableRemoteEmbeddings
				) {
					console.log(
						`File created: ${file.path}, triggering remote indexing.`
					);
					// No need to await, let it run in the background
					addOrUpdateDocumentRemote(
						this.app,
						file,
						this.settings
					).catch((err: any) =>
						console.error(
							`Error indexing created file ${file.path}:`,
							err
						)
					);
				} else if (file instanceof TFile) {
					console.log(
						`File created: ${file.path}, remote embeddings disabled, skipping indexing.`
					);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (
					file instanceof TFile &&
					this.settings.enableRemoteEmbeddings
				) {
					console.log(
						`File modified: ${file.path}, triggering remote indexing.`
					);
					// No need to await, let it run in the background
					addOrUpdateDocumentRemote(
						this.app,
						file,
						this.settings
					).catch((err: any) =>
						console.error(
							`Error indexing modified file ${file.path}:`,
							err
						)
					);
				} else if (file instanceof TFile) {
					console.log(
						`File modified: ${file.path}, remote embeddings disabled, skipping indexing.`
					);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				console.log(
					`File/folder deleted: ${file.path}, triggering index removal.`
				);
				// Deleting from index doesn't require remote settings
				// No need to await, let it run in the background
				deleteDocumentFromIndex(this.app, file.path).catch((err: any) =>
					console.error(
						`Error removing deleted file ${file.path} from index:`,
						err
					)
				);
				// Note: This simple delete only handles the exact file path.
				// Folder deletion cleanup would require iterating through the index.
			})
		);

		// --- Event Listener for File Open (Re-enabled for file attachment logic) ---
		this.registerEvent(
			this.app.workspace.on("file-open", this.handleFileOpen)
		);

		// --- Toggle Command ---
		this.addCommand({
			id: "toggle-hydrate-react-view",
			name: "Toggle Markdown/Hydrate React View",
			checkCallback: this.checkToggleReactView,
		});

		// --- Add Layout Change Handler ---
		this.registerEvent(
			this.app.workspace.on("layout-change", this.handleLayoutChange)
		);

		// This creates an icon in the left ribbon to toggle the Hydrate pane
		const ribbonIconEl = this.addRibbonIcon(
			"text-cursor-input", // Changed icon for better representation
			"Toggle Hydrate Pane",
			async (evt: MouseEvent) => {
				// Toggle the pane when the icon is clicked
				await this.togglePane(); // Use helper function
			}
		);
		// Perform additional things with the ribbon
		ribbonIconEl.addClass("hydrate-ribbon-class");

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		// const statusBarItemEl = this.addStatusBarItem();
		// statusBarItemEl.setText("Hydrate Ready"); // Example status

		// This adds a command to toggle the Hydrate pane
		this.addCommand({
			id: "toggle-hydrate-pane",
			name: "Toggle Hydrate pane",
			callback: async () => {
				await this.togglePane(); // Use helper function
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new HydrateSettingTab(this.app, this)); // <<< USE IMPORTED SETTING TAB

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		// this.registerInterval(
		//  window.setInterval(() => console.log("setInterval"), 5 * 60 * 1000)
		// );

		// --- React View Host Registration ---
		console.log(`Hydrate: Registering view type: ${REACT_HOST_VIEW_TYPE}`);
		this.registerView(REACT_HOST_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
			console.log(
				`Hydrate: Factory function called for view type: ${REACT_HOST_VIEW_TYPE}`
			);
			return new ReactViewHost(leaf, this);
		});

		// --- Add Selection Command ---
		this.addCommand({
			id: "add-selection-to-hydrate",
			name: "Hydrate: Add selection to context",
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
				hydrateView.textInput.value += `${separator}${token} `;

				// Trigger input event for potential UI updates (like textarea resize)
				hydrateView.textInput.dispatchEvent(
					new Event("input", { bubbles: true })
				);

				// Focus the input area
				hydrateView.textInput.focus();

				new Notice(
					"Selected text captured and /select added to Hydrate."
				);
			},
		});
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
			name: "Hydrate: Process agent tool calls",
			callback: async () => {
				const toolCalls = await this.processAgentToolCalls([]);
				new Notice(`Processed ${toolCalls.length} tool calls.`);
			},
		});

		this.addRibbonIcon(
			"folder-sync",
			"Generate Hydrate Manifests",
			async (evt: MouseEvent) => {
				await this.generateManifestsInHydrateDocs();
			}
		);

		this.addCommand({
			id: "generate-hydrate-manifests",
			name: "Generate Manifests in hydrate-docs",
			callback: async () => {
				await this.generateManifestsInHydrateDocs();
			},
		});
	}

	// --- Helper to Toggle Pane ---
	async togglePane() {
		const leaves = this.app.workspace.getLeavesOfType(HYDRATE_VIEW_TYPE);
		if (leaves.length > 0) {
			await this.deactivateView();
		} else {
			await this.activateView();
		}
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
				console.log(
					`Hydrate activateView: Found source file from MarkdownView: ${sourceFilePath}`
				);
			} else if (
				currentView instanceof ReactViewHost &&
				currentView.currentFilePath
			) {
				sourceFilePath = currentView.currentFilePath;
				console.log(
					`Hydrate activateView: Found source file from ReactViewHost: ${sourceFilePath}`
				);
			} else if (
				currentView instanceof ItemView &&
				currentView.getViewType() !== HYDRATE_VIEW_TYPE
			) {
				// Try to get file from generic ItemView if possible (might not always work)
				const state = currentView.getState();
				if (state?.file) {
					const file = this.app.vault.getAbstractFileByPath(
						state.file
					);
					if (file instanceof TFile) {
						sourceFilePath = file.path;
						console.log(
							`Hydrate activateView: Found source file from generic ItemView state: ${sourceFilePath}`
						);
					}
				}
			} else {
				console.log(
					`Hydrate activateView: Active view is not Markdown or ReactViewHost or did not yield a file path.`
				);
			}
		} else {
			console.log(`Hydrate activateView: No active leaf found.`);
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
				console.log(
					`Hydrate activateView: Existing view revealed. Attaching current file: ${sourceFilePath}`
				);
				(existingLeaf.view as HydrateView).attachInitialFile(
					sourceFilePath
				);
			} else {
				console.log(
					`Hydrate activateView: Existing view revealed. Source file: ${sourceFilePath}. View state not modified.`
				);
			}
			return;
		}

		// Determine split direction based on setting
		const direction =
			this.settings.paneOrientation === "Right"
				? "vertical"
				: "horizontal";

		// Open the view in a new leaf
		const leaf = workspace.getLeaf("split", direction);

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

		console.log(
			`Hydrate activateView: Setting state for new leaf:`,
			JSON.stringify(viewStateToSet)
		);
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
		console.log(
			`Hydrate [file-open]: File changed to: ${file?.path ?? "null"}`
		);

		// --- Part 1: Notify the Hydrate Pane (Keep this logic) ---
		if (this.view && this.view.containerEl.isShown()) {
			console.log(
				`Hydrate [file-open]: Hydrate view is open, notifying it of file change.`
			);
			// Pass the new file path (or null) to the view instance
			this.view.handleActiveFileChange(file?.path ?? null);
		} else {
			console.log(
				`Hydrate [file-open]: Hydrate view is not open or not visible, ignoring file change.`
			);
		}

		// --- Part 2: Handle Main Editor View Switching (Uncommented and Refined) ---
		const leaf = this.app.workspace.getActiveViewOfType(ItemView)?.leaf; // Get active leaf first
		if (!leaf) {
			console.log(
				"Hydrate [file-open]: No active leaf found. Cannot switch view."
			);
			return; // Exit if no active leaf
		}

		const currentView = leaf.view;

		// Handle case where file becomes null (e.g., closing last tab)
		if (!file) {
			if (currentView instanceof ReactViewHost) {
				console.log(
					"Hydrate [file-open]: File is null, switching React Host back to Markdown."
				);
				// Check if ReactViewHost expects a file path; might need adjustment if it crashes on null
				// Assuming switchToMarkdownView handles the transition gracefully
				if (!this.isSwitchingToMarkdown) {
					currentView.switchToMarkdownView();
				} else {
					console.log(
						"Hydrate [file-open]: Already switching to markdown, skipping."
					);
				}
			} else {
				console.log(
					"Hydrate [file-open]: File is null, current view is not React Host. No action needed."
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
		console.log("Hydrate [layout-change]: Layout change detected.");

		// Check if we are intentionally switching back to markdown
		if (this.isSwitchingToMarkdown) {
			console.log(
				"Hydrate [layout-change]: Intentional switch to markdown detected, skipping checks and resetting flag."
			);
			this.isSwitchingToMarkdown = false; // Reset the flag *after* skipping the check
			return;
		}

		const leaf = this.app.workspace.activeLeaf;
		if (!leaf) {
			console.log("Hydrate [layout-change]: No active leaf.");
			return;
		}

		const currentView = leaf.view;

		// Scenario 1: Active view is Markdown, but should it be React?
		if (currentView instanceof MarkdownView && currentView.file) {
			const file = currentView.file;
			const fileCache = this.app.metadataCache.getFileCache(file);
			if (!fileCache) {
				console.log(
					"Hydrate [layout-change]: File cache not ready, skipping check."
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
					console.log(
						`Hydrate [layout-change]: Active view is Markdown (mode: ${currentMode}, sourceState: ${currentState.source}) for ${file.path}, but should be React (${viewKey}). Switching...`
					);
					try {
						await leaf.setViewState({
							type: REACT_HOST_VIEW_TYPE,
							state: { filePath: file.path, viewKey: viewKey },
							active: true,
						});
					} catch (error) {
						console.error(
							"Hydrate [layout-change]: Error switching Markdown to React:",
							error
						);
					}
				} else {
					// This condition implies mode=="source" AND state.source==true (True Source Mode)
					console.log(
						`Hydrate [layout-change]: Active view is Markdown for ${file.path} (IN TRUE SOURCE MODE). File should be React, but respecting source mode. NO SWITCH.`
					);
				}
			} else {
				// console.log("Hydrate [layout-change]: Active view is Markdown, and it should be (no valid hydrate-plugin key). No switch needed.");
			}
		}
		// Scenario 2: Active view is React, but should it be Markdown?
		else if (currentView instanceof ReactViewHost) {
			const filePath = currentView.currentFilePath;
			if (!filePath) {
				console.log(
					"Hydrate [layout-change]: Active view is ReactHost, but has no file path. Switching to Markdown."
				);
				await currentView.switchToMarkdownView();
				return;
			}

			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) {
				console.warn(
					`Hydrate [layout-change]: ReactHost has path ${filePath}, but it's not a valid file. Switching to Markdown.`
				);
				await currentView.switchToMarkdownView();
				return;
			}

			const fileCache = this.app.metadataCache.getFileCache(file);
			if (!fileCache) {
				console.log(
					"Hydrate [layout-change]: File cache not ready for ReactHost file, skipping check."
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
				console.log(
					`Hydrate [layout-change]: Active view is React for ${filePath}, but should be Markdown (key missing or invalid). Switching back...`
				);
				await currentView.switchToMarkdownView();
			} else {
				// console.log("Hydrate [layout-change]: Active view is React, and it should be. No switch needed.");
			}
		} else {
			// console.log("Hydrate [layout-change]: Active view is neither Markdown nor ReactHost, no action needed.");
		}
	};
	// --- End Layout Change Handler ---

	onunload() {
		// Clean up when the plugin is disabled
		this.deactivateView(); // This will also detach leaves
		this.view = null; // Ensure reference is cleared

		// Clean up MCP Server Manager
		if (this.mcpManager) {
			console.log("Shutting down MCP Server Manager...");
			try {
				// Stop all servers
				this.mcpManager.stopAllServers();
				this.mcpManager = null;
				console.log("MCP Server Manager shut down successfully");
			} catch (error) {
				console.error(
					"Error during MCP Server Manager shutdown:",
					error
				);
			}
		}

		console.log("Hydrate Plugin Unloaded");
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);

		// --- Initialize Default Format Registry Entry ---
		// Ensure array exists
		if (
			!this.settings.registryEntries ||
			!Array.isArray(this.settings.registryEntries)
		) {
			console.log(
				"Hydrate: Format Registry empty or invalid, initializing with default /issue command."
			);
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
					entry.slashCommandTrigger === "/issue"
			);
			if (!defaultIssueExists) {
				console.log(
					"Hydrate: Default '/issue' command missing from existing registry, adding it."
				);
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
			console.log(
				"Hydrate: Rules Registry empty or invalid, initializing with default conversation rule."
			);
			// Initialize with the default rule if empty or invalid
			this.settings.rulesRegistryEntries = [DEFAULT_CONVERSATION_RULE];
		} else {
			// Check if the default conversation rule is present if array already exists
			const defaultConversationRuleExists =
				this.settings.rulesRegistryEntries.some(
					(rule) => rule.id === DEFAULT_CONVERSATION_RULE.id
				);
			if (!defaultConversationRuleExists) {
				console.log(
					"Hydrate: Default conversation rule missing from existing registry, adding it."
				);
				this.settings.rulesRegistryEntries.push(
					DEFAULT_CONVERSATION_RULE
				);
			}
		}
		// --- End Initialize Default Rules Registry Entry ---
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
			(entry) => entry.slashCommandTrigger === trigger
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
			(entry) => entry.id === id
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
	// --- End Helper function --- // <<< ADDED

	// --- Add Initial Indexing Function ---
	async triggerInitialIndexing() {
		if (!this.settings.enableRemoteEmbeddings) {
			new Notice(
				"Remote embeddings are disabled in settings. Cannot start indexing."
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
				"Remote embedding configuration is incomplete. Please check settings in Hydrate plugin options."
			);
			return;
		}

		if (this.isIndexing) {
			new Notice("Indexing is already in progress.");
			return;
		}

		this.isIndexing = true;
		new Notice("Starting initial vault indexing... This may take a while.");
		console.log("Starting initial vault indexing...");

		// Fetch ALL files, not just markdown. Filtering will happen in addOrUpdateDocumentRemote.
		const allFiles = this.app.vault.getFiles();
		const totalFiles = allFiles.length;
		let processedFilesCount = 0; // Count files actually sent to addOrUpdateDocumentRemote
		let successfullyIndexedCount = 0; // Count files confirmed indexed by addOrUpdate (if we can track that)
		let errorCount = 0;

		console.log(
			`Found ${totalFiles} total files to check for indexing based on extensions: '${this.settings.indexFileExtensions}'.`
		);

		for (const file of allFiles) {
			// Check flag again in case user cancelled (though no UI for this yet)
			if (!this.isIndexing) {
				new Notice("Indexing cancelled by flag.");
				console.log("Indexing cancelled by flag.");
				break;
			}
			processedFilesCount++;
			// console.log(  // Optional: verbose logging for each file being checked
			//     `Checking file ${processedFilesCount}/${totalFiles}: ${file.path}`
			// );
			try {
				// addOrUpdateDocumentRemote will use settings.indexFileExtensions to filter
				// It will also handle console logging for skipped or indexed files.
				await addOrUpdateDocumentRemote(this.app, file, this.settings);
				// We can't easily tell from the return of addOrUpdateDocumentRemote if it *actually* indexed
				// or just skipped due to extension. The logs within that function are the source of truth.
			} catch (error) {
				console.error(
					`Error processing file ${file.path} during initial indexing:`,
					error
				);
				errorCount++;
			}
		}

		// The completion message should reflect that files were *checked*.
		// The actual number indexed is best found by observing logs from addOrUpdateDocumentRemote.
		const completionMessage = `Vault indexing check finished. Checked ${processedFilesCount} files. Errors: ${errorCount}. See console for details on skipped/indexed files.`;
		new Notice(completionMessage);
		console.log(completionMessage);
		this.isIndexing = false;
	}

	// Add a function to potentially stop indexing if needed
	stopIndexing() {
		if (this.isIndexing) {
			console.log("Requesting indexing stop...");
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
		preparedCalls: AgentPreparedToolCall[]
	): Promise<ToolExecutionResult[]> {
		const toolResults: ToolExecutionResult[] = [];

		if (!preparedCalls || preparedCalls.length === 0) {
			return toolResults;
		}

		console.log(
			"[Hydrate Plugin] Processing agent tool calls:",
			preparedCalls
		);

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
					this.settings
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
			//         console.error(`Error reading file ${path}:`, error);
			//         toolResults.push({ id: call.id, result: `Error reading file: ${error.message}` });
			//     }
			// }
			else {
				console.warn(
					`[Hydrate Plugin] Unknown tool call received: ${call.tool}`
				);
				toolResults.push({
					id: call.id,
					result: `Error: Unknown tool '${call.tool}' requested by agent.`,
				});
			}
		}

		console.log(
			"[Hydrate Plugin] Sending tool results back to agent:",
			toolResults
		);
		// Here, you would typically send these toolResults back to your FastAPI /tool_result endpoint.
		// For example, via another fetch/requestUrl call if this is not already part of that flow.
		return toolResults;
	}

	async generateManifestsInHydrateDocs(): Promise<void> {
		const vaultName = this.app.vault.getName();
		const hydrateDocsFolder = this.app.vault.getAbstractFileByPath(
			HYDRATE_DOCS_FOLDER_NAME
		);

		if (!hydrateDocsFolder || !(hydrateDocsFolder instanceof TFolder)) {
			new Notice(
				`Folder "${HYDRATE_DOCS_FOLDER_NAME}" not found. Please create it first.`
			);
			return;
		}

		let manifestsCreated = 0;
		let manifestsUpdated = 0;
		let manifestsSkippedNoChange = 0;

		const traverseAndCreateOrUpdate = async (folder: TFolder) => {
			if (folder.name.startsWith(".")) {
				return;
			}

			const manifestPath = `${folder.path}/${MANIFEST_FILE_NAME}`;
			let scannedManifest: ManifestFile;

			try {
				scannedManifest = await ManifestFile.scanDirectory(
					folder.path,
					vaultName,
					this.app.vault
				);
			} catch (scanError) {
				console.error(
					`Hydrate: Error scanning directory ${folder.path}:`,
					scanError
				);
				new Notice(
					`Error scanning directory ${folder.path}. Manifest not updated. Check console.`
				);
				return;
			}

			const newContent = scannedManifest.toString();

			try {
				const fileExists = await this.app.vault.adapter.exists(
					manifestPath
				);

				if (fileExists) {
					const existingContent = await this.app.vault.adapter.read(
						manifestPath
					);
					if (existingContent !== newContent) {
						await this.app.vault.adapter.write(
							manifestPath,
							newContent
						);
						manifestsUpdated++;
					} else {
						manifestsSkippedNoChange++;
					}
				} else {
					await this.app.vault.adapter.write(
						manifestPath,
						newContent
					);
					manifestsCreated++;
				}
			} catch (error) {
				console.error(
					`Hydrate: Error writing manifest for ${folder.path}:`,
					error
				);
				new Notice(
					`Error writing manifest for ${folder.path}. Check console.`
				);
			}

			for (const child of folder.children) {
				if (child instanceof TFolder) {
					await traverseAndCreateOrUpdate(child);
				}
			}
		};

		new Notice("Generating/Updating Hydrate manifests...");
		await traverseAndCreateOrUpdate(hydrateDocsFolder as TFolder);

		let message = "";
		if (manifestsCreated > 0) {
			message += `Created ${manifestsCreated} new manifest(s). `;
		}
		if (manifestsUpdated > 0) {
			message += `Updated ${manifestsUpdated} manifest(s). `;
		}
		if (manifestsSkippedNoChange > 0) {
			message += `Skipped ${manifestsSkippedNoChange} manifest(s) (no changes). `;
		}
		if (!message) {
			message = "No changes to manifests in hydrate-docs.";
		}
		new Notice(message.trim());
	}
}

// --- REMOVED RegistryEditModal class definition (moved to src/settings/RegistryEditModal.ts) ---

// --- REMOVED HydrateSettingTab class definition (moved to src/settings/HydrateSettingTab.ts) ---
