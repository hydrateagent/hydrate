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
	private view: ProVibeView | null = null;

	async onload() {
		await this.loadSettings();

		// Custom styles will be loaded automatically from styles.css

		// Register the custom view
		this.registerView(PROVIBE_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
			this.view = new ProVibeView(leaf, this);
			return this.view;
		});

		// Register example component (we'll create this later)
		// Placeholder - create src/components/PlaceholderView.tsx later
		// import PlaceholderView from './src/components/PlaceholderView'; // Import will be needed
		registerReactView("placeholder", PlaceholderView); // Example registration
		registerReactView("issue-board", IssueBoardView); // <<< ADD THIS REGISTRATION

		// --- Event Listener for File Open ---
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
		this.registerEvent(
			this.app.workspace.on("layout-change", this.handleLayoutChange)
		);

		// This creates an icon in the left ribbon to toggle the ProVibe pane
		const ribbonIconEl = this.addRibbonIcon(
			"text-cursor-input",
			"Toggle ProVibe Pane",
			async (evt: MouseEvent) => {
				// Toggle the pane when the icon is clicked
				const leaves =
					this.app.workspace.getLeavesOfType(PROVIBE_VIEW_TYPE);
				if (leaves.length > 0) {
					await this.deactivateView();
				} else {
					await this.activateView();
				}
			}
		);
		// Perform additional things with the ribbon
		ribbonIconEl.addClass("provibe-ribbon-class");

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText("Status Bar Text");

		// This adds a command to toggle the ProVibe pane
		this.addCommand({
			id: "toggle-provibe-pane",
			name: "Toggle ProVibe pane",
			callback: async () => {
				const leaves =
					this.app.workspace.getLeavesOfType(PROVIBE_VIEW_TYPE);
				if (leaves.length > 0) {
					await this.deactivateView();
				} else {
					await this.activateView();
				}
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ProVibeSettingTab(this.app, this));

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(
			window.setInterval(() => console.log("setInterval"), 5 * 60 * 1000)
		);

		// --- React View Host Registration ---
		console.log(`ProVibe: Registering view type: ${REACT_HOST_VIEW_TYPE}`);
		this.registerView(REACT_HOST_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
			console.log(
				`ProVibe: Factory function called for view type: ${REACT_HOST_VIEW_TYPE}`
			);
			return new ReactViewHost(leaf, this);
		});
	}

	async activateView() {
		const { workspace } = this.app;

		// <<< START ADDED: Get active file path BEFORE activating ProVibe view >>>
		let sourceFilePath: string | null = null;
		const currentActiveLeaf = workspace.activeLeaf;
		if (currentActiveLeaf) {
			const currentView = currentActiveLeaf.view;
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
			} else {
				console.log(
					`ProVibe activateView: Active view is not Markdown or ReactViewHost with a file.`
				);
			}
		}
		// <<< END ADDED >>>

		// If view is already open in a leaf, reveal that leaf
		const existingLeaf = workspace.getLeavesOfType(PROVIBE_VIEW_TYPE)[0];
		if (existingLeaf) {
			workspace.revealLeaf(existingLeaf);
			// Optionally update the existing view's state with the source file path if needed
			if (sourceFilePath && existingLeaf.view instanceof ProVibeView) {
				// We might need a dedicated method on ProVibeView to handle this
				// For now, let's just log it. We could potentially call setState again.
				console.log(
					`ProVibe activateView: Existing view revealed. Source file was: ${sourceFilePath}. (State not updated yet)`
				);
				// existingLeaf.setViewState({ type: PROVIBE_VIEW_TYPE, active: true, state: { sourceFilePath: sourceFilePath } });
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
		// <<< ADDED: Log before setting state >>>
		const viewStateToSet = {
			type: PROVIBE_VIEW_TYPE,
			active: true,
			state: { sourceFilePath: sourceFilePath },
		};
		console.log(
			`ProVibe activateView: Setting state for new leaf:`,
			JSON.stringify(viewStateToSet)
		);
		// <<< END ADDED >>>
		await leaf.setViewState(viewStateToSet);

		this.view = leaf.view as ProVibeView;
		workspace.revealLeaf(leaf);
	}

	async deactivateView() {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(PROVIBE_VIEW_TYPE);
		leaves.forEach((leaf) => leaf.detach());
		this.view = null;
	}

	// --- File Open Handler ---
	handleFileOpen = async (file: TFile | null) => {
		// *** Temporarily disable this handler's switching logic ***
		/*
		if (!file) return;

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
			// We want the React View

			// Check if it's already the correct React view host
			if (
				currentView instanceof ReactViewHost &&
				currentView.currentFilePath === file.path &&
				currentView.currentViewKey === viewKey
			) {
				// Already in the correct React view, do nothing
				// console.log("ProVibe: Already in correct React view:", file.path);
				return;
			}

			// Switch to ReactViewHost - DEFERRED
			console.log(
				`ProVibe: Queueing switch to React view (${viewKey}) for: ${file.path}`
			);
			setTimeout(() => {
				console.log(
					`ProVibe: Executing deferred switch to React view for: ${file.path}`
				);
				// Ensure leaf is still valid in the timeout
				// We can check if the view associated with the leaf is still attached
				if (leaf.view?.containerEl.isConnected) { // Use the captured leaf directly
					console.log("ProVibe: Revealing leaf before setting state..."); // Add log
					this.app.workspace.revealLeaf(leaf); // Reveal the leaf first
					// Now set the state
					leaf.setViewState({ // Use the captured leaf directly
						type: REACT_HOST_VIEW_TYPE,
						state: { filePath: file.path, viewKey: viewKey },
					} as any);
				} else {
					console.warn(
						`ProVibe: Leaf captured in closure no longer seems valid for deferred switch.` // Updated warning
					);
				}
			}, 0);
		} else {
			// We want the Markdown View (or default)

			// Check if the current view is our React host (needs switching back)
			if (currentView instanceof ReactViewHost) {
				// Switch back to Markdown - DEFERRED
				console.log(
					`ProVibe: Queueing switch back to Markdown view for: ${file.path}`
				);
				setTimeout(() => {
					console.log(
						`ProVibe: Executing deferred switch to Markdown view for: ${file.path}`
					);
					// Check if the leaf/view is still valid
					if (leaf.view?.containerEl.isConnected && currentView?.containerEl.isConnected) { // Check both leaf and original view
						console.log("ProVibe: Revealing leaf before setting state (back to Markdown)..."); // Add log
						this.app.workspace.revealLeaf(leaf); // Reveal the leaf first
						const previousState = (
							currentView as ReactViewHost // Use captured currentView
						).getState();
						leaf.setViewState({ // Use captured leaf
							type: "markdown",
							state: { ...previousState, file: file.path },
						});
					} else {
						console.warn(
							`ProVibe: Leaf or original view no longer seems valid for deferred switch back to markdown.` // Updated warning
						);
					}
				}, 0);
			}
			// Else: It's already a non-React view (e.g., Markdown, Kanban), let Obsidian handle it.
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
					} as any);
				}
				return true;
			}
		}

		// Cannot toggle in other cases
		return false;
	};
	// --- End Toggle Command Check Callback ---

	// --- Layout Change Handler ---
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
			const file = currentView.file;
			const fileCache = this.app.metadataCache.getFileCache(file);
			if (!fileCache) return; // Cache might not be ready immediately

			const frontmatter = fileCache.frontmatter;
			const triggerKey = "provibe-plugin";
			const viewKey = frontmatter?.[triggerKey] as string | undefined;
			const ReactComponent = viewKey
				? getReactViewComponent(viewKey)
				: undefined;
		}

		// Scenario 2: Active view is React, but shouldn't be? (File changed/frontmatter removed)
		// This logic might be better handled within ReactViewHost using handleVaultModify
		// or by simply letting the normal Markdown view take over if the user navigates away and back.
		// For now, we primarily focus on switching TO the React view.

		console.log(
			"ProVibe [layout-change]: No relevant view switch needed for active leaf."
		);
	};
	// --- End Layout Change Handler ---

	onunload() {
		// Clean up when the plugin is disabled
		this.deactivateView();
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
				(entry) => entry.id === "default-issue-board"
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

	constructor(
		app: App,
		plugin: ProVibePlugin,
		entry: RegistryEntry | null, // Pass null for new entry
		onSubmit: (result: RegistryEntry) => void
	) {
		super(app);
		this.plugin = plugin;
		this.isNew = entry === null;
		this.entry = entry ?? {
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
			.setDesc(
				"Internal ID for this entry. Cannot be changed after creation."
			)
			.addText((text) => text.setValue(this.entry.id).setDisabled(true));

		// Description
		new Setting(contentEl)
			.setName("Description")
			.setDesc("What this format/context is used for.")
			.addText((text) =>
				text
					.setPlaceholder("e.g., Standard Issue Board Template")
					.setValue(this.entry.description)
					.onChange((value) => {
						this.entry.description = value.trim(); // Trim description
					})
			);

		// Slash Command Trigger
		new Setting(contentEl)
			.setName("Slash Command Trigger (Optional)")
			.setDesc(
				"Enter the command including the slash (e.g., /issue). Leave empty if not needed."
			)
			.addText((text) =>
				text
					.setPlaceholder("/command")
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
							// Optionally provide visual feedback for invalid input
							new Notice(
								"Slash command must start with '/' and contain no spaces, or be empty."
							);
							text.inputEl.addClass("provibe-input-error"); // Add error class (needs CSS)
						}
					})
			);

		// Content Type
		let contentTypeDropdown: DropdownComponent;
		new Setting(contentEl)
			.setName("Content Type")
			.addDropdown((dropdown) => {
				contentTypeDropdown = dropdown;
				dropdown
					.addOption("markdown", "Markdown")
					.addOption("json", "JSON")
					.addOption("text", "Text")
					.setValue(this.entry.contentType)
					.onChange((value: RegistryEntryContentType) => {
						this.entry.contentType = value;
					});
			});

		// Content (TextArea)
		new Setting(contentEl)
			.setName("Content")
			.setDesc("The actual template, schema, or text.")
			.setClass("provibe-registry-content-setting") // Class for styling
			.addTextArea((textarea) =>
				textarea
					.setPlaceholder("Enter content here...")
					.setValue(this.entry.content)
					.onChange((value) => {
						this.entry.content = value;
					})
					.inputEl.setAttrs({
						rows: 15, // Increased rows
						style: "width: 100%; min-height: 150px; font-family: var(--font-monospace);", // Use CSS var for font
					})
			);

		// Make the setting taller to accommodate the text area
		contentEl
			.find(".provibe-registry-content-setting")
			?.addClass("provibe-setting-item-tall");

		// --- Buttons ---
		new Setting(contentEl)
			.setClass("provibe-modal-button-bar") // Class for button alignment
			.addButton((button) =>
				button
					.setButtonText("Save")
					.setCta()
					.onClick(() => {
						// --- Validation ---
						if (!this.entry.description) {
							new Notice("Description cannot be empty.");
							return;
						}
						const trigger = this.entry.slashCommandTrigger;
						if (
							trigger &&
							(!trigger.startsWith("/") || trigger.includes(" "))
						) {
							new Notice(
								"Slash command trigger must start with '/' and contain no spaces, or be empty."
							);
							return;
						}
						// Check trigger uniqueness (if defined)
						if (trigger) {
							const existingEntry =
								this.plugin.getRegistryEntryByTrigger(trigger);
							if (
								existingEntry &&
								existingEntry.id !== this.entry.id
							) {
								new Notice(
									`Slash command trigger "${trigger}" is already used by entry "${existingEntry.description}". Please choose a unique trigger.`
								);
								return;
							}
						}

						// Increment version if editing
						if (!this.isNew) {
							this.entry.version = (this.entry.version || 1) + 1;
						}

						this.onSubmit(this.entry);
						this.close();
					})
			)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => this.close())
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
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
					.addOption("Bottom", "Bottom")
					.addOption("Right", "Right")
					.setValue(this.plugin.settings.paneOrientation)
					.onChange(async (value: "Bottom" | "Right") => {
						this.plugin.settings.paneOrientation = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Backend URL")
			.setDesc("The URL of the ProVibe agent backend server.")
			.addText((text) =>
				text
					.setPlaceholder("http://localhost:8000")
					.setValue(this.plugin.settings.backendUrl)
					.onChange(async (value) => {
						const trimmedValue = value.trim();
						if (
							trimmedValue.startsWith("http://") ||
							trimmedValue.startsWith("https://")
						) {
							this.plugin.settings.backendUrl =
								trimmedValue.replace(/\/$/, ""); // Remove trailing slash
							await this.plugin.saveSettings();
							text.inputEl.removeClass("provibe-input-error");
						} else {
							new Notice(
								"Backend URL must start with http:// or https://"
							);
							text.inputEl.addClass("provibe-input-error");
						}
					})
			);

		new Setting(containerEl)
			.setName("Development Path")
			.setDesc("Path to the plugin development directory")
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
		registrySection.createEl("h3", {
			text: "Format & Context Registry (Slash Commands)",
		});
		registrySection
			.createEl("p", {
				text: "Manage reusable templates, schemas, and commands for quick insertion and agent use.",
			})
			.addClass("setting-item-description");

		const registryListEl = registrySection.createDiv(
			"provibe-registry-list"
		); // Container for the list

		this.renderRegistryList(registryListEl); // Call helper to render the list

		// --- Add New Button ---
		new Setting(registrySection)
			.setClass("provibe-add-button-setting") // Add class for styling
			.addButton((button) =>
				button
					.setButtonText("Add New Entry")
					.setCta()
					.onClick(() => {
						const modal = new RegistryEditModal(
							this.app,
							this.plugin,
							null,
							(newEntry) => {
								this.plugin.settings.registryEntries = [
									...this.plugin.getRegistryEntries(), // Use getter to ensure array exists
									newEntry,
								];
								this.plugin.saveSettings();
								this.renderRegistryList(registryListEl); // Re-render the list
								new Notice(
									`Added registry entry: ${newEntry.description}`
								);
							}
						);
						modal.open();
					})
			);

		// --- Optional: Add CSS for better layout ---
		this.addStyles(); // Add styles method call
	}

	// --- Helper to Render the Registry List ---
	renderRegistryList(containerEl: HTMLElement) {
		containerEl.empty(); // Clear previous list

		const entries = this.plugin.getRegistryEntries(); // Use getter

		if (entries.length === 0) {
			containerEl.createEl("p", {
				text: "No registry entries defined yet.",
				cls: "provibe-empty-list-message",
			});
			return;
		}

		entries.sort((a, b) => a.description.localeCompare(b.description)); // Sort alphabetically by description

		entries.forEach((entry) => {
			const settingItem = new Setting(containerEl)
				.setName(entry.description || `(No description)`)
				.setDesc(
					`Trigger: ${entry.slashCommandTrigger || "None"} | Type: ${
						entry.contentType
					} | v${entry.version}`
				)
				.setClass("provibe-registry-item")

				// Edit Button
				.addButton((button) =>
					button
						.setIcon("pencil")
						.setTooltip("Edit Entry")
						.onClick(() => {
							const modal = new RegistryEditModal(
								this.app,
								this.plugin,
								{ ...entry },
								(updatedEntry) => {
									// Pass a copy for editing
									this.plugin.settings.registryEntries =
										this.plugin.getRegistryEntries().map(
											(
												e // Use getter
											) =>
												e.id === updatedEntry.id
													? updatedEntry
													: e
										);
									this.plugin.saveSettings();
									this.renderRegistryList(containerEl); // Re-render
									new Notice(
										`Updated entry: ${updatedEntry.description}`
									);
								}
							);
							modal.open();
						})
				)
				// Delete Button
				.addButton((button) =>
					button
						.setIcon("trash")
						.setTooltip("Delete Entry")
						.setClass("mod-warning")
						.onClick(async () => {
							// Make async for potential confirmation
							// Optional: Add confirmation dialog
							// const confirmed = await this.app.plugins.plugins['modal-form']?.api.confirm("Delete Entry?", `Are you sure you want to delete "${entry.description}"?`);
							// if (!confirmed) return;

							this.plugin.settings.registryEntries = this.plugin
								.getRegistryEntries()
								.filter((e) => e.id !== entry.id); // Use getter
							await this.plugin.saveSettings();
							this.renderRegistryList(containerEl); // Re-render
							new Notice(`Deleted entry: ${entry.description}`);
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
            /* Input Error State */
            .provibe-input-error {
                border-color: var(--background-modifier-error-border) !important;
                box-shadow: 0 0 0 1px var(--background-modifier-error-border) !important;
            }
            /* Tall setting item for Text Area in Modal */
             .provibe-setting-item-tall {
                align-items: flex-start !important;
                flex-wrap: wrap; /* Allow wrapping */
            }
            .provibe-setting-item-tall .setting-item-info {
                margin-bottom: 8px; /* Space between label/desc and control */
                flex-basis: 100%; /* Label takes full width */
            }
            .provibe-setting-item-tall .setting-item-control {
                width: 100%; /* Control takes full width */
                max-width: 100%; /* Prevent overflow */
            }
             /* Modal button bar */
            .provibe-modal-button-bar .setting-item-control {
                display: flex;
                justify-content: flex-end; /* Align buttons to the right */
                gap: 10px; /* Space between buttons */
            }
            /* Registry List Item Styling */
            .provibe-registry-list {
                margin-top: 15px;
                border: 1px solid var(--background-modifier-border);
                border-radius: var(--radius-m);
                padding: 5px 15px; /* Padding inside the list container */
                max-height: 400px; /* Limit height and allow scrolling */
                overflow-y: auto;   /* Enable vertical scroll */
            }
            .provibe-registry-item {
                 border-bottom: 1px solid var(--background-modifier-border);
                 padding: 10px 0; /* Vertical padding */
                 margin: 0; /* Remove default margin */
                 align-items: center; /* Vertically align items */
            }
            .provibe-registry-item:last-child {
                 border-bottom: none; /* No border for the last item */
            }
            .provibe-registry-item .setting-item-info {
                flex-grow: 1; /* Allow description to take available space */
                margin-right: 10px; /* Space before buttons */
            }
             .provibe-registry-item .setting-item-control {
                 flex-shrink: 0; /* Prevent buttons from shrinking */
                 margin-left: auto; /* Push buttons to the right */
            }
            .provibe-empty-list-message {
                color: var(--text-muted);
                padding: 15px 0;
                text-align: center;
            }
             /* Add New button alignment */
            .provibe-add-button-setting {
                margin-top: 15px;
                justify-content: flex-end; /* Push button to the right */
            }

        `;
		// Check if style already exists
		const styleId = "provibe-settings-styles";
		let styleEl = document.getElementById(styleId);
		if (!styleEl) {
			styleEl = document.createElement("style");
			styleEl.id = styleId;
			styleEl.textContent = css;
			document.head.appendChild(styleEl);
			// Register cleanup for when the plugin unloads
			this.plugin.register(() => styleEl?.remove());
		} else {
			// Optionally update content if needed, though usually static CSS is fine
			// styleEl.textContent = css;
		}
	}
}
