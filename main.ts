import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
	ItemView,
	ViewCreator,
} from "obsidian";

import { ProVibeView, PROVIBE_VIEW_TYPE } from "./proVibeView";

// Remember to rename these classes and interfaces!

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

export default class ProVibePlugin extends Plugin {
	settings: ProVibePluginSettings;
	private view: ProVibeView | null = null;

	async onload() {
		await this.loadSettings();

		// Custom styles will be loaded automatically from styles.css

		// Register the custom view
		this.registerView(PROVIBE_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
			this.view = new ProVibeView(leaf, this);
			return this.view;
		});

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

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "open-sample-modal-simple",
			name: "Open sample modal (simple)",
			callback: () => {
				new SampleModal(this.app).open();
			},
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: "sample-editor-command",
			name: "Sample editor command",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection("Sample Editor Command");
			},
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: "open-sample-modal-complex",
			name: "Open sample modal (complex)",
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			console.log("click", evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(
			window.setInterval(() => console.log("setInterval"), 5 * 60 * 1000)
		);
	}

	async activateView() {
		const { workspace } = this.app;

		// If view is already open in a leaf, reveal that leaf
		const existingLeaf = workspace.getLeavesOfType(PROVIBE_VIEW_TYPE)[0];
		if (existingLeaf) {
			workspace.revealLeaf(existingLeaf);
			return;
		}

		// Determine split direction based on setting
		const direction =
			this.settings.paneOrientation === "Right"
				? "vertical"
				: "horizontal";

		// Open the view in a new leaf
		const leaf = workspace.getLeaf("split", direction);
		await leaf.setViewState({
			type: PROVIBE_VIEW_TYPE,
			active: true,
		});

		this.view = leaf.view as ProVibeView;
		workspace.revealLeaf(leaf);
	}

	async deactivateView() {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(PROVIBE_VIEW_TYPE);
		leaves.forEach((leaf) => leaf.detach());
		this.view = null;
	}

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

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText("Woah!");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
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
			.setName("Setting #1")
			.setDesc("It's a secret")
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settings.mySetting)
					.onChange(async (value) => {
						this.plugin.settings.mySetting = value;
						await this.plugin.saveSettings();
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
