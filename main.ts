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
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
	ItemView,
	ViewCreator,
	TextComponent, // Added for Modal
	TextAreaComponent, // Added for Modal
	DropdownComponent, // Added for Modal
} from "obsidian";

import { ProVibeView, PROVIBE_VIEW_TYPE } from "./proVibeView";
import * as React from "react"; // Added
import { Root, createRoot } from "react-dom/client"; // Added
import {
	ReactViewProps,
	RegistryEntry,
	RegistryEntryContentType,
} from "./src/types"; // Added Registry types
import { ReactViewHost } from "./src/ReactViewHost"; // Added
import PlaceholderView from "./src/components/PlaceholderView"; // ADD THIS IMPORT
import IssueBoardView from "./src/components/IssueBoardView"; // <<< ADD THIS IMPORT

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
		console.warn(`ProVibe: Overwriting React view for key "${key}"`);
	}
	reactViewRegistry.set(key, component);
	console.log(`ProVibe: Registered React view for key "${key}"`);
}

export function getReactViewComponent(
	key: string
): React.ComponentType<ReactViewProps> | undefined {
	return reactViewRegistry.get(key);
}
// --- End React View Registry ---

interface ProVibePluginSettings {
	mySetting: string;
	developmentPath: string;
	backendUrl: string;
	paneOrientation: "Bottom" | "Right";
	registryEntries: RegistryEntry[]; // <<< ADDED registry entries
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

const DEFAULT_SETTINGS: ProVibePluginSettings = {
	mySetting: "default",
	developmentPath: ".obsidian/plugins/provibe",
	backendUrl: "http://localhost:8000",
	paneOrientation: "Bottom",
	registryEntries: [], // <<< Initialized as empty
};

export const REACT_HOST_VIEW_TYPE = "provibe-react-host"; // Define type for React host

export default class ProVibePlugin extends Plugin {
	settings: ProVibePluginSettings;
	isSwitchingToMarkdown: boolean = false;
	view: ProVibeView | null = null; // Keep reference to the view instance

	async onload() {
		await this.loadSettings();

		// Custom styles will be loaded automatically from styles.css

		// Register the custom view
		this.registerView(PROVIBE_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
			// Store the view instance when created
			this.view = new ProVibeView(leaf, this);
			return this.view;
		});

		// Register example component (we'll create this later)
		// Placeholder - create src/components/PlaceholderView.tsx later
		// import PlaceholderView from './src/components/PlaceholderView'; // Import will be needed
		registerReactView("placeholder", PlaceholderView); // Example registration
		registerReactView("issue-board", IssueBoardView); // <<< ADD THIS REGISTRATION

		// --- Event Listener for File Open (Re-enabled for file attachment logic) ---
		this.registerEvent(
			this.app.workspace.on("file-open", this.handleFileOpen)
		);

		// --- Toggle Command ---
		this.addCommand({
			id: "toggle-provibe-react-view",
			name: "Toggle Markdown/ProVibe React View",
			checkCallback: this.checkToggleReactView,
		});

		// --- Add Layout Change Handler ---
		// this.registerEvent(
		//  this.app.workspace.on("layout-change", this.handleLayoutChange)
		// ); // Keep disabled for now, focus on file-open

		// This creates an icon in the left ribbon to toggle the ProVibe pane
		const ribbonIconEl = this.addRibbonIcon(
			"text-cursor-input", // Changed icon for better representation
			"Toggle ProVibe Pane",
			async (evt: MouseEvent) => {
				// Toggle the pane when the icon is clicked
				await this.togglePane(); // Use helper function
			}
		);
		// Perform additional things with the ribbon
		ribbonIconEl.addClass("provibe-ribbon-class");

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		// const statusBarItemEl = this.addStatusBarItem();
		// statusBarItemEl.setText("ProVibe Ready"); // Example status

		// This adds a command to toggle the ProVibe pane
		this.addCommand({
			id: "toggle-provibe-pane",
			name: "Toggle ProVibe pane",
			callback: async () => {
				await this.togglePane(); // Use helper function
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ProVibeSettingTab(this.app, this));

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		// this.registerInterval(
		//  window.setInterval(() => console.log("setInterval"), 5 * 60 * 1000)
		// );

		// --- React View Host Registration ---
		console.log(`ProVibe: Registering view type: ${REACT_HOST_VIEW_TYPE}`);
		this.registerView(REACT_HOST_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
			console.log(
				`ProVibe: Factory function called for view type: ${REACT_HOST_VIEW_TYPE}`
			);
			return new ReactViewHost(leaf, this);
		});
	}

	// --- Helper to Toggle Pane ---
	async togglePane() {
		const leaves = this.app.workspace.getLeavesOfType(PROVIBE_VIEW_TYPE);
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

		// Get active file path BEFORE activating ProVibe view
		const currentActiveLeaf = workspace.activeLeaf;
		if (currentActiveLeaf) {
			const currentView = currentActiveLeaf.view;
			// Get path from MarkdownView or ReactViewHost (if applicable)
			if (currentView instanceof MarkdownView && currentView.file) {
				sourceFilePath = currentView.file.path;
				console.log(
					`ProVibe activateView: Found source file from MarkdownView: ${sourceFilePath}`
				);
			} else if (
				currentView instanceof ReactViewHost &&
				currentView.currentFilePath
			) {
				sourceFilePath = currentView.currentFilePath;
				console.log(
					`ProVibe activateView: Found source file from ReactViewHost: ${sourceFilePath}`
				);
			} else if (
				currentView instanceof ItemView &&
				currentView.getViewType() !== PROVIBE_VIEW_TYPE
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
							`ProVibe activateView: Found source file from generic ItemView state: ${sourceFilePath}`
						);
					}
				}
			} else {
				console.log(
					`ProVibe activateView: Active view is not Markdown or ReactViewHost or did not yield a file path.`
				);
			}
		} else {
			console.log(`ProVibe activateView: No active leaf found.`);
		}

		// If view is already open in a leaf, reveal that leaf
		const existingLeaves = workspace.getLeavesOfType(PROVIBE_VIEW_TYPE);
		if (existingLeaves.length > 0) {
			const existingLeaf = existingLeaves[0];
			workspace.revealLeaf(existingLeaf);
			// If a source file was found *now*, and the existing view has no files attached, attach it.
			if (
				sourceFilePath &&
				existingLeaf.view instanceof ProVibeView &&
				existingLeaf.view.attachedFiles.length === 0
			) {
				console.log(
					`ProVibe activateView: Existing view revealed. Attaching current file: ${sourceFilePath}`
				);
				(existingLeaf.view as ProVibeView).attachInitialFile(
					sourceFilePath
				);
			} else {
				console.log(
					`ProVibe activateView: Existing view revealed. Source file: ${sourceFilePath}. View state not modified.`
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
			type: PROVIBE_VIEW_TYPE,
			active: true,
			state: {}, // Initialize empty state object
		};
		if (sourceFilePath) {
			viewStateToSet.state.sourceFilePath = sourceFilePath; // Add sourceFilePath if found
		}

		console.log(
			`ProVibe activateView: Setting state for new leaf:`,
			JSON.stringify(viewStateToSet)
		);
		await leaf.setViewState(viewStateToSet);

		// 'this.view' will be set by the view factory function registered earlier
		if (leaf.view instanceof ProVibeView) {
			this.view = leaf.view; // Ensure our reference is correct
		}
		workspace.revealLeaf(leaf); // Reveal after setting state
	}

	async deactivateView() {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(PROVIBE_VIEW_TYPE);
		leaves.forEach((leaf) => leaf.detach());
		this.view = null; // Clear the reference
	}

	// --- File Open Handler (Simplified for File Attachment Logic) ---
	handleFileOpen = async (file: TFile | null) => {
		console.log(
			`ProVibe [file-open]: File changed to: ${file?.path ?? "null"}`
		);

		// Check if our ProVibe view instance exists and is currently visible
		if (this.view && this.view.containerEl.isShown()) {
			console.log(
				`ProVibe [file-open]: ProVibe view is open, notifying it of file change.`
			);
			// Pass the new file path (or null) to the view instance
			this.view.handleActiveFileChange(file?.path ?? null);
		} else {
			console.log(
				`ProVibe [file-open]: ProVibe view is not open or not visible, ignoring file change.`
			);
		}

		// --- Keep original view-switching logic commented out ---
		/*
		const leaf = this.app.workspace.getActiveViewOfType(ItemView)?.leaf; // Get active leaf
		if (!leaf) return;

		const fileCache = this.app.metadataCache.getFileCache(file);
		const frontmatter = fileCache?.frontmatter;
		const triggerKey = "provibe-plugin"; // Or make this configurable
		const viewKey = frontmatter?.[triggerKey] as string | undefined; // Cast to string

		const ReactComponent = viewKey ? getReactViewComponent(viewKey) : undefined;

		const currentView = leaf.view;

		// --- Logic to Switch Views ---
		if (ReactComponent) {
			// ... (Switch to React view logic) ...
		} else {
			// ... (Switch back to Markdown logic) ...
		}
		*/
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
			const triggerKey = "provibe-plugin"; // Consistent key
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

	// --- Layout Change Handler (Keep commented out for now) ---
	/*
	handleLayoutChange = () => {
		console.log("ProVibe: layout-change detected");

		// Check if we are intentionally switching back to markdown
		if (this.isSwitchingToMarkdown) {
			console.log(
				"ProVibe [layout-change]: Intentional switch to markdown detected, skipping auto-switch back."
			);
			this.isSwitchingToMarkdown = false; // Reset the flag
			return;
		}

		const leaf = this.app.workspace.activeLeaf;
		if (!leaf) {
			console.log("ProVibe: No active leaf on layout-change");
			return;
		}

		const currentView = leaf.view;

		// Scenario 1: Active view is Markdown, but should be React?
		if (currentView instanceof MarkdownView && currentView.file) {
			// ... existing logic ...
		}

		// Scenario 2: Active view is React, but shouldn't be?
		// ... existing logic ...

		console.log(
			"ProVibe [layout-change]: No relevant view switch needed for active leaf."
		);
	};
	*/
	// --- End Layout Change Handler ---

	onunload() {
		// Clean up when the plugin is disabled
		this.deactivateView(); // This will also detach leaves
		this.view = null; // Ensure reference is cleared
		console.log("ProVibe Plugin Unloaded");
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);

		// --- Initialize Default Registry Entry ---
		if (
			!this.settings.registryEntries ||
			this.settings.registryEntries.length === 0
		) {
			console.log(
				"ProVibe: Registry is empty, adding default '/issue' command."
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
			// No need to save here, will be saved if settings are modified later
			// or can add await this.saveSettings(); if immediate save is desired.
		} else {
			// Optional: Check if the default /issue exists and add it if missing,
			// maybe based on ID 'default-issue-board'.
			const defaultIssueExists = this.settings.registryEntries.some(
				(entry) =>
					entry.id === "default-issue-board" ||
					entry.slashCommandTrigger === "/issue"
			);
			if (!defaultIssueExists) {
				console.log(
					"ProVibe: Default '/issue' command missing, adding it."
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
}

// --- Modal for Editing/Adding Registry Entries ---
class RegistryEditModal extends Modal {
	entry: RegistryEntry; // Entry to edit or a template for a new one
	plugin: ProVibePlugin;
	isNew: boolean;
	onSubmit: (result: RegistryEntry) => void; // Callback on successful save

	// Components for cleanup
	private textInputs: TextComponent[] = [];
	private dropdowns: DropdownComponent[] = [];
	private textAreas: TextAreaComponent[] = [];

	constructor(
		app: App,
		plugin: ProVibePlugin,
		entry: RegistryEntry | null, // Pass null for new entry
		onSubmit: (result: RegistryEntry) => void
	) {
		super(app);
		this.plugin = plugin;
		this.isNew = entry === null;
		this.entry = entry
			? { ...entry } // Create a copy if editing
			: {
					// Provide defaults for new entry
					id: `entry-${Date.now()}-${Math.random()
						.toString(36)
						.substring(2, 8)}`, // Generate semi-unique ID
					description: "",
					version: 1,
					contentType: "markdown",
					content: "",
					slashCommandTrigger: "",
			  };
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", {
			text: this.isNew ? "Add New Registry Entry" : "Edit Registry Entry",
		});

		// --- Form Fields ---

		// ID (Read-only)
		new Setting(contentEl)
			.setName("ID (Unique Identifier)")
			.setDesc("Internal ID. Cannot be changed.")
			.addText((text) => {
				text.setValue(this.entry.id).setDisabled(true);
				this.textInputs.push(text); // Store for potential cleanup if needed
			});

		// Description
		let descriptionInput: TextComponent;
		new Setting(contentEl)
			.setName("Description")
			.setDesc("What this format/context is used for.")
			.addText((text) => {
				descriptionInput = text;
				text.setPlaceholder("e.g., Standard Issue Board Template")
					.setValue(this.entry.description)
					.onChange((value) => {
						this.entry.description = value.trim(); // Trim description
					});
				this.textInputs.push(text);
			});

		// Slash Command Trigger
		let triggerInput: TextComponent;
		new Setting(contentEl)
			.setName("Slash Command Trigger (Optional)")
			.setDesc(
				"Command like /issue. Must start with / and contain no spaces, or be empty."
			)
			.addText((text) => {
				triggerInput = text;
				text.setPlaceholder("/command")
					.setValue(this.entry.slashCommandTrigger ?? "")
					.onChange((value) => {
						const trimmed = value.trim();
						if (
							trimmed === "" ||
							(trimmed.startsWith("/") && !trimmed.includes(" "))
						) {
							// Allow empty or starting with / and no spaces
							this.entry.slashCommandTrigger =
								trimmed === "" ? undefined : trimmed;
							// Clear potential error display if valid
							text.inputEl.removeClass("provibe-input-error");
						} else {
							// Invalid format, keep the UI state but don't update entry's value yet
							// Validation will happen on save
							text.inputEl.addClass("provibe-input-error"); // Add error class (needs CSS)
						}
					});
				this.textInputs.push(text);
			});

		// Content Type
		new Setting(contentEl)
			.setName("Content Type")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("markdown", "Markdown")
					.addOption("json", "JSON")
					.addOption("text", "Text")
					// Add more types as needed
					.setValue(this.entry.contentType)
					.onChange((value: RegistryEntryContentType) => {
						this.entry.contentType = value;
					});
				this.dropdowns.push(dropdown);
			});

		// Content (TextArea)
		new Setting(contentEl)
			.setName("Content")
			.setDesc("The actual template, schema, or text.")
			.setClass("provibe-registry-content-setting") // Class for styling
			.addTextArea((textarea) => {
				textarea
					.setPlaceholder("Enter content here...")
					.setValue(this.entry.content)
					.onChange((value) => {
						this.entry.content = value; // Update content directly
					})
					.inputEl.setAttrs({
						rows: 15, // Increased rows
						// Use CSS variables for better theme compatibility
						style: "width: 100%; min-height: 150px; font-family: var(--font-monospace);",
					});
				this.textAreas.push(textarea);
			});

		// Make the setting taller to accommodate the text area
		contentEl
			.find(".provibe-registry-content-setting")
			?.addClass("is-tall"); // Use Obsidian's class if available, else custom

		// --- Buttons ---
		new Setting(contentEl)
			.setClass("provibe-modal-button-bar") // Class for button alignment
			.addButton((button) =>
				button
					.setButtonText("Save")
					.setCta() // Make it the prominent button
					.onClick(() => {
						// --- Validation ---
						// Description
						if (!this.entry.description) {
							new Notice("Description cannot be empty.");
							descriptionInput?.inputEl.addClass(
								"provibe-input-error"
							); // Highlight field
							return;
						} else {
							descriptionInput?.inputEl.removeClass(
								"provibe-input-error"
							);
						}

						// Trigger Format
						const trigger = triggerInput.getValue().trim(); // Get current UI value for validation
						const isValidTrigger =
							trigger === "" ||
							(trigger.startsWith("/") && !trigger.includes(" "));
						if (!isValidTrigger) {
							new Notice(
								"Slash command trigger must start with '/' and contain no spaces, or be empty."
							);
							triggerInput?.inputEl.addClass(
								"provibe-input-error"
							);
							return;
						} else {
							triggerInput?.inputEl.removeClass(
								"provibe-input-error"
							);
							// Update entry's trigger *after* validation
							this.entry.slashCommandTrigger =
								trigger === "" ? undefined : trigger;
						}

						// Trigger Uniqueness (only if trigger is set)
						if (this.entry.slashCommandTrigger) {
							const existingEntry =
								this.plugin.getRegistryEntryByTrigger(
									this.entry.slashCommandTrigger
								);
							if (
								existingEntry &&
								existingEntry.id !== this.entry.id
							) {
								new Notice(
									`Slash command trigger "${this.entry.slashCommandTrigger}" is already used by entry "${existingEntry.description}". Please choose a unique trigger.`
								);
								triggerInput?.inputEl.addClass(
									"provibe-input-error"
								);
								return;
							} else {
								triggerInput?.inputEl.removeClass(
									"provibe-input-error"
								);
							}
						}

						// Increment version if editing an existing entry
						if (!this.isNew) {
							this.entry.version = (this.entry.version || 1) + 1;
						}

						// If all validation passes:
						this.onSubmit(this.entry); // Pass the validated and potentially updated entry
						this.close();
					})
			)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => this.close())
			);
	}

	onClose() {
		const { contentEl } = this;
		// Optional: Clean up component references if necessary, though usually handled by Obsidian
		this.textInputs = [];
		this.dropdowns = [];
		this.textAreas = [];
		contentEl.empty(); // Clear modal content
	}
}
// --- END MODAL ---

class ProVibeSettingTab extends PluginSettingTab {
	plugin: ProVibePlugin;

	constructor(app: App, plugin: ProVibePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "ProVibe Settings" });

		// --- General Settings ---
		containerEl.createEl("h3", { text: "General" });
		new Setting(containerEl)
			.setName("Default Pane Orientation")
			.setDesc("Choose where the ProVibe pane opens by default.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("Bottom", "Bottom") // Horizontal split
					.addOption("Right", "Right") // Vertical split
					.setValue(this.plugin.settings.paneOrientation)
					.onChange(async (value: "Bottom" | "Right") => {
						this.plugin.settings.paneOrientation = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Backend URL")
			.setDesc(
				"URL of the ProVibe agent backend (e.g., http://localhost:8000)."
			)
			.addText((text) => {
				text.setPlaceholder("http://localhost:8000")
					.setValue(this.plugin.settings.backendUrl)
					.onChange(async (value) => {
						const trimmedValue = value.trim().replace(/\/$/, ""); // Trim and remove trailing slash
						if (
							trimmedValue === "" ||
							trimmedValue.startsWith("http://") ||
							trimmedValue.startsWith("https://")
						) {
							this.plugin.settings.backendUrl = trimmedValue;
							await this.plugin.saveSettings();
							text.inputEl.removeClass("provibe-input-error");
						} else {
							// Keep the invalid value in the input for correction, but don't save it.
							// Show persistent error styling instead of notice spam.
							text.inputEl.addClass("provibe-input-error");
						}
					});
				// Add input listener to clear error on valid input
				text.inputEl.addEventListener("input", () => {
					const trimmedValue = text.inputEl.value
						.trim()
						.replace(/\/$/, "");
					if (
						trimmedValue === "" ||
						trimmedValue.startsWith("http://") ||
						trimmedValue.startsWith("https://")
					) {
						text.inputEl.removeClass("provibe-input-error");
					} else {
						text.inputEl.addClass("provibe-input-error");
					}
				});
			});

		new Setting(containerEl)
			.setName("Development Path")
			.setDesc(
				"Internal setting: Path to the plugin development directory."
			)
			.addText((text) =>
				text
					.setPlaceholder(".obsidian/plugins/provibe")
					.setValue(this.plugin.settings.developmentPath)
					.onChange(async (value) => {
						this.plugin.settings.developmentPath = value.trim();
						await this.plugin.saveSettings();
					})
			);

		// --- Format & Context Registry Section ---
		const registrySection = containerEl.createDiv(
			"provibe-settings-section"
		);
		const headingEl = registrySection.createEl("div", {
			cls: "provibe-settings-heading",
		});
		headingEl.createEl("h3", { text: "Format & Context Registry" });
		const addButtonContainer = headingEl.createDiv({
			cls: "provibe-heading-actions",
		}); // Container for button

		// Add New Entry Button (aligned with heading)
		addButtonContainer
			.createEl("button", { text: "Add New Entry", cls: "mod-cta" })
			.addEventListener("click", () => {
				const modal = new RegistryEditModal(
					this.app,
					this.plugin,
					null, // Creating a new entry
					(newEntry) => {
						// Add the new entry to settings
						this.plugin.settings.registryEntries = [
							...this.plugin.getRegistryEntries(), // Use getter to ensure array exists
							newEntry,
						];
						this.plugin.saveSettings();
						this.renderRegistryList(registryListEl); // Re-render the list below
						new Notice(
							`Added registry entry: ${
								newEntry.description || newEntry.id
							}`
						);
					}
				);
				modal.open();
			});

		registrySection.createEl("p", {
			text: "Manage reusable templates, schemas, or context snippets accessible via slash commands in the ProVibe pane.",
			cls: "setting-item-description", // Use Obsidian's class
		});

		const registryListEl = registrySection.createDiv(
			"provibe-registry-list"
		); // Container for the list items

		this.renderRegistryList(registryListEl); // Call helper to render the list items

		// --- Add CSS ---
		this.addStyles(); // Add styles method call
	}

	// --- Helper to Render the Registry List ---
	renderRegistryList(containerEl: HTMLElement) {
		containerEl.empty(); // Clear previous list

		const entries = this.plugin.getRegistryEntries(); // Use getter

		if (entries.length === 0) {
			containerEl.createEl("p", {
				text: "No registry entries defined yet. Click 'Add New Entry' above to create one.",
				cls: "provibe-empty-list-message", // Custom class for styling
			});
			return;
		}

		// Sort alphabetically by description for consistent order
		entries.sort((a, b) =>
			(a.description || a.id).localeCompare(b.description || b.id)
		);

		entries.forEach((entry) => {
			const settingItem = new Setting(containerEl)
				.setName(entry.description || `(ID: ${entry.id})`) // Show ID if no description
				.setDesc(
					`Trigger: ${entry.slashCommandTrigger || "None"} | Type: ${
						entry.contentType
					} | v${entry.version}`
				)
				.setClass("provibe-registry-item") // Custom class for item styling

				// Edit Button
				.addButton((button) =>
					button
						.setIcon("pencil") // Use Obsidian's pencil icon
						.setTooltip("Edit Entry")
						.onClick(() => {
							const modal = new RegistryEditModal(
								this.app,
								this.plugin,
								entry, // Pass the existing entry (modal constructor makes a copy)
								(updatedEntry) => {
									// Update the entry in the settings array
									this.plugin.settings.registryEntries =
										this.plugin
											.getRegistryEntries()
											.map((e) =>
												e.id === updatedEntry.id
													? updatedEntry
													: e
											);
									this.plugin.saveSettings();
									this.renderRegistryList(containerEl); // Re-render the list
									new Notice(
										`Updated entry: ${
											updatedEntry.description ||
											updatedEntry.id
										}`
									);
								}
							);
							modal.open();
						})
				)
				// Delete Button
				.addButton((button) =>
					button
						.setIcon("trash") // Use Obsidian's trash icon
						.setTooltip("Delete Entry")
						.setClass("mod-warning") // Use Obsidian's warning style for delete
						.onClick(async () => {
							// Simple confirmation using window.confirm (consider a custom modal for better UX)
							if (
								confirm(
									`Are you sure you want to delete "${
										entry.description || entry.id
									}"?`
								)
							) {
								this.plugin.settings.registryEntries =
									this.plugin
										.getRegistryEntries()
										.filter((e) => e.id !== entry.id); // Filter out the entry
								await this.plugin.saveSettings();
								this.renderRegistryList(containerEl); // Re-render the list
								new Notice(
									`Deleted entry: ${
										entry.description || entry.id
									}`
								);
							}
						})
				);
		});
	}

	// --- Helper to add CSS ---
	addStyles() {
		const css = `
            /* Settings Sections */
            .provibe-settings-section {
                border-top: 1px solid var(--background-modifier-border);
                padding-top: 20px;
                margin-top: 20px;
            }
            /* Heading with Action Button */
            .provibe-settings-heading {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 5px; /* Space below heading */
            }
            .provibe-settings-heading h3 {
                margin-bottom: 0; /* Remove default margin from h3 */
            }
             /* Input Error State */
            .provibe-input-error {
                border-color: var(--text-error) !important; /* More prominent error color */
                box-shadow: 0 0 0 1px var(--text-error) !important;
            }
            /* Tall setting item for Text Area in Modal */
            .provibe-registry-content-setting.is-tall .setting-item-control {
                 height: auto; /* Allow text area to determine height */
                 align-self: stretch;
            }
            .provibe-registry-content-setting.is-tall .setting-item-info {
                 width: 100%; /* Ensure label takes full width */
                 margin-bottom: var(--size-4-2); /* Obsidian variable for spacing */
            }
            .provibe-registry-content-setting.is-tall textarea {
                min-height: 150px; /* Ensure minimum height */
                height: 200px; /* Default height */
                resize: vertical; /* Allow vertical resize */
            }

             /* Modal button bar */
            .provibe-modal-button-bar .setting-item-control {
                display: flex;
                justify-content: flex-end; /* Align buttons to the right */
                gap: var(--size-4-2); /* Space between buttons */
            }

            /* Registry List Container */
            .provibe-registry-list {
                margin-top: 15px;
                border: 1px solid var(--background-modifier-border);
                border-radius: var(--radius-m); /* Use Obsidian radius variable */
                padding: 5px 0px 5px 15px; /* Padding inside container, less on right for buttons */
                max-height: 400px; /* Limit height and allow scrolling */
                overflow-y: auto;   /* Enable vertical scroll */
                background-color: var(--background-secondary); /* Subtle background */
            }
            /* Individual Registry Item */
            .provibe-registry-item {
                 border-bottom: 1px solid var(--background-modifier-border);
                 /* padding: 10px 0; */ /* Use Obsidian's default padding */
                 /* margin: 0; */ /* Use Obsidian's default margin */
                 align-items: center; /* Vertically align items */
            }
            .provibe-registry-item:last-child {
                 border-bottom: none; /* No border for the last item */
            }
            /* Let description grow */
            .provibe-registry-item .setting-item-info {
                flex-grow: 1;
                margin-right: var(--size-4-2); /* Space before buttons */
            }
             /* Prevent buttons shrinking */
            .provibe-registry-item .setting-item-control {
                 flex-shrink: 0;
                 margin-left: auto; /* Push buttons to the right */
            }
            /* Message for empty list */
            .provibe-empty-list-message {
                color: var(--text-muted);
                padding: 15px;
                text-align: center;
                font-style: italic;
            }

            /* Add New button alignment (now in heading) */
            /*.provibe-add-button-setting {
                margin-top: 15px;
                justify-content: flex-end;
            }*/

        `;
		// Use Obsidian's mechanism to add/remove styles
		const styleId = "provibe-settings-styles";
		let styleEl = document.getElementById(styleId);
		if (!styleEl) {
			styleEl = document.createElement("style");
			styleEl.id = styleId;
			styleEl.textContent = css;
			document.head.appendChild(styleEl);
			// Register cleanup using the plugin's register method
			this.plugin.register(() => styleEl?.remove());
		} else {
			// If style already exists, update its content
			styleEl.textContent = css;
		}
	}
}
