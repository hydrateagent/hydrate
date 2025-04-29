import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	TFile, // Added
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
		console.warn(`Hydrate: Overwriting React view for key "${key}"`);
	}
	reactViewRegistry.set(key, component);
	console.log(`Hydrate: Registered React view for key "${key}"`);
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
	"claude-3-7-sonnet-latest",
	"claude-3-5-haiku-latest",
	"gemini-2.5-flash-preview-04-17",
	"gemini-2.5-pro-exp-03-25",
] as const; // Use const assertion for stricter typing

export type ModelName = (typeof ALLOWED_MODELS)[number]; // Create type from array values

interface HydratePluginSettings {
	mySetting: string;
	developmentPath: string;
	backendUrl: string;
	paneOrientation: "Bottom" | "Right";
	registryEntries: RegistryEntry[]; // Existing registry
	rulesRegistryEntries: RuleEntry[]; // <<< ADDED rules registry
	selectedModel: ModelName; // Add setting for selected LLM
}

// Default content for the /issue command
const DEFAULT_ISSUE_COMMAND_CONTENT = `# Uncategorized

## New Issue Title
- issue-number-placeholder
### Items
- item 1
- item 2
### Status
- [ ] status 1
- [ ] status 2
`;

const DEFAULT_SETTINGS: HydratePluginSettings = {
	mySetting: "default",
	developmentPath: ".obsidian/plugins/hydrate",
	backendUrl: "http://localhost:8000",
	paneOrientation: "Bottom",
	registryEntries: [], // Existing initialization
	rulesRegistryEntries: [], // <<< Initialized as empty
	selectedModel: "gpt-4.1-mini", // Set default model
};

export const REACT_HOST_VIEW_TYPE = "hydrate-react-host"; // Define type for React host

export default class HydratePlugin extends Plugin {
	settings: HydratePluginSettings;
	isSwitchingToMarkdown: boolean = false;
	view: HydrateView | null = null; // Keep reference to the view instance

	async onload() {
		await this.loadSettings();

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

		// --- Event Listener for File Open (Re-enabled for file attachment logic) ---
		this.registerEvent(
			this.app.workspace.on("file-open", this.handleFileOpen),
		);

		// --- Toggle Command ---
		this.addCommand({
			id: "toggle-hydrate-react-view",
			name: "Toggle Markdown/Hydrate React View",
			checkCallback: this.checkToggleReactView,
		});

		// --- Add Layout Change Handler ---
		this.registerEvent(
			this.app.workspace.on("layout-change", this.handleLayoutChange),
		);

		// This creates an icon in the left ribbon to toggle the Hydrate pane
		const ribbonIconEl = this.addRibbonIcon(
			"text-cursor-input", // Changed icon for better representation
			"Toggle Hydrate Pane",
			async (evt: MouseEvent) => {
				// Toggle the pane when the icon is clicked
				await this.togglePane(); // Use helper function
			},
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
				`Hydrate: Factory function called for view type: ${REACT_HOST_VIEW_TYPE}`,
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
					new Event("input", { bubbles: true }),
				);

				// Focus the input area
				hydrateView.textInput.focus();

				new Notice(
					"Selected text captured and /select added to Hydrate.",
				);
			},
		});
		// --- End Add Selection Command ---
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
					`Hydrate activateView: Found source file from MarkdownView: ${sourceFilePath}`,
				);
			} else if (
				currentView instanceof ReactViewHost &&
				currentView.currentFilePath
			) {
				sourceFilePath = currentView.currentFilePath;
				console.log(
					`Hydrate activateView: Found source file from ReactViewHost: ${sourceFilePath}`,
				);
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
						console.log(
							`Hydrate activateView: Found source file from generic ItemView state: ${sourceFilePath}`,
						);
					}
				}
			} else {
				console.log(
					`Hydrate activateView: Active view is not Markdown or ReactViewHost or did not yield a file path.`,
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
					`Hydrate activateView: Existing view revealed. Attaching current file: ${sourceFilePath}`,
				);
				(existingLeaf.view as HydrateView).attachInitialFile(
					sourceFilePath,
				);
			} else {
				console.log(
					`Hydrate activateView: Existing view revealed. Source file: ${sourceFilePath}. View state not modified.`,
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
			JSON.stringify(viewStateToSet),
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
			`Hydrate [file-open]: File changed to: ${file?.path ?? "null"}`,
		);

		// --- Part 1: Notify the Hydrate Pane (Keep this logic) ---
		if (this.view && this.view.containerEl.isShown()) {
			console.log(
				`Hydrate [file-open]: Hydrate view is open, notifying it of file change.`,
			);
			// Pass the new file path (or null) to the view instance
			this.view.handleActiveFileChange(file?.path ?? null);
		} else {
			console.log(
				`Hydrate [file-open]: Hydrate view is not open or not visible, ignoring file change.`,
			);
		}

		// --- Part 2: Handle Main Editor View Switching (Uncommented and Refined) ---
		const leaf = this.app.workspace.getActiveViewOfType(ItemView)?.leaf; // Get active leaf first
		if (!leaf) {
			console.log(
				"Hydrate [file-open]: No active leaf found. Cannot switch view.",
			);
			return; // Exit if no active leaf
		}

		const currentView = leaf.view;

		// Handle case where file becomes null (e.g., closing last tab)
		if (!file) {
			if (currentView instanceof ReactViewHost) {
				console.log(
					"Hydrate [file-open]: File is null, switching React Host back to Markdown.",
				);
				// Check if ReactViewHost expects a file path; might need adjustment if it crashes on null
				// Assuming switchToMarkdownView handles the transition gracefully
				if (!this.isSwitchingToMarkdown) {
					currentView.switchToMarkdownView();
				} else {
					console.log(
						"Hydrate [file-open]: Already switching to markdown, skipping.",
					);
				}
			} else {
				console.log(
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
		console.log("Hydrate [layout-change]: Layout change detected.");

		// Check if we are intentionally switching back to markdown
		if (this.isSwitchingToMarkdown) {
			console.log(
				"Hydrate [layout-change]: Intentional switch to markdown detected, skipping checks and resetting flag.",
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
					console.log(
						`Hydrate [layout-change]: Active view is Markdown (mode: ${currentMode}, sourceState: ${currentState.source}) for ${file.path}, but should be React (${viewKey}). Switching...`,
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
							error,
						);
					}
				} else {
					// This condition implies mode=="source" AND state.source==true (True Source Mode)
					console.log(
						`Hydrate [layout-change]: Active view is Markdown for ${file.path} (IN TRUE SOURCE MODE). File should be React, but respecting source mode. NO SWITCH.`,
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
					"Hydrate [layout-change]: Active view is ReactHost, but has no file path. Switching to Markdown.",
				);
				await currentView.switchToMarkdownView();
				return;
			}

			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) {
				console.warn(
					`Hydrate [layout-change]: ReactHost has path ${filePath}, but it's not a valid file. Switching to Markdown.`,
				);
				await currentView.switchToMarkdownView();
				return;
			}

			const fileCache = this.app.metadataCache.getFileCache(file);
			if (!fileCache) {
				console.log(
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
				console.log(
					`Hydrate [layout-change]: Active view is React for ${filePath}, but should be Markdown (key missing or invalid). Switching back...`,
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
		console.log("Hydrate Plugin Unloaded");
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);

		// --- Initialize Default Registry Entry (Slash Command) ---  // Added clarification
		if (
			!this.settings.registryEntries ||
			this.settings.registryEntries.length === 0
		) {
			console.log(
				"Hydrate: Format Registry is empty, adding default '/issue' command.",
			);
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
			const defaultIssueExists = this.settings.registryEntries.some(
				(entry) =>
					entry.id === "default-issue-board" ||
					entry.slashCommandTrigger === "/issue",
			);
			if (!defaultIssueExists) {
				console.log(
					"Hydrate: Default '/issue' command missing, adding it.",
				);
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
		// --- End Initialize Default Registry Entry ---

		// --- Initialize Rules Registry (Ensure it's an array) --- <<< ADDED
		if (!Array.isArray(this.settings.rulesRegistryEntries)) {
			console.log("Hydrate: Initializing empty Rules Registry.");
			this.settings.rulesRegistryEntries = [];
		}
		// --- End Initialize Rules Registry ---
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
	// --- End Helper function --- // <<< ADDED
}

// --- REMOVED RegistryEditModal class definition (moved to src/settings/RegistryEditModal.ts) ---

// --- REMOVED HydrateSettingTab class definition (moved to src/settings/HydrateSettingTab.ts) ---
