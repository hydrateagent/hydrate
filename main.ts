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
} from "obsidian";

import { ProVibeView, PROVIBE_VIEW_TYPE } from "./proVibeView";
import * as React from "react"; // Added
import { Root, createRoot } from "react-dom/client"; // Added
import { ReactViewProps } from "./src/types"; // Added
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
}

const DEFAULT_SETTINGS: ProVibePluginSettings = {
	mySetting: "default",
	developmentPath: ".obsidian/plugins/provibe",
	backendUrl: "http://localhost:8000",
	paneOrientation: "Bottom",
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
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

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
						// Basic validation: ensure it starts with http
						if (
							value.startsWith("http://") ||
							value.startsWith("https://")
						) {
							this.plugin.settings.backendUrl = value.replace(
								/\/$/,
								""
							); // Remove trailing slash
							await this.plugin.saveSettings();
						} else {
							new Notice(
								"Backend URL must start with http:// or https://"
							);
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
						this.plugin.settings.developmentPath = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
