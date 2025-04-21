import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import ProVibePlugin from "../main"; // Corrected path
import { RegistryEditModal } from "./RegistryEditModal";
import { RuleEditModal } from "./RuleEditModal"; // <<< IMPORT NEW MODAL
import { injectSettingsStyles } from "../styles/settingsStyles";
import { RuleEntry } from "../types"; // <<< IMPORT RuleEntry

export class ProVibeSettingTab extends PluginSettingTab {
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
		const formatRegistrySection = containerEl.createDiv(
			"provibe-settings-section"
		);
		const formatHeadingEl = formatRegistrySection.createEl("div", {
			cls: "provibe-settings-heading",
		});
		formatHeadingEl.createEl("h3", { text: "Format & Context Registry" });
		const formatAddButtonContainer = formatHeadingEl.createDiv({
			cls: "provibe-heading-actions",
		}); // Container for button

		// Add New Entry Button (aligned with heading)
		formatAddButtonContainer
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
						this.renderFormatRegistryList(formatRegistryListEl); // Use specific renderer
						new Notice(
							`Added format entry: ${
								newEntry.description || newEntry.id
							}`
						);
					}
				);
				modal.open();
			});

		formatRegistrySection.createEl("p", {
			text: "Manage reusable templates, schemas, or context snippets accessible via slash commands in the ProVibe pane.",
			cls: "setting-item-description", // Use Obsidian's class
		});

		const formatRegistryListEl = formatRegistrySection.createDiv(
			"provibe-registry-list"
		); // Container for the list items

		this.renderFormatRegistryList(formatRegistryListEl); // Call helper to render the list items

		// --- Rules Registry Section ---
		const rulesRegistrySection = containerEl.createDiv(
			"provibe-settings-section"
		);
		const rulesHeadingEl = rulesRegistrySection.createEl("div", {
			cls: "provibe-settings-heading",
		});
		rulesHeadingEl.createEl("h3", { text: "Rules Registry" });
		const rulesAddButtonContainer = rulesHeadingEl.createDiv({
			cls: "provibe-heading-actions",
		});
		rulesAddButtonContainer
			.createEl("button", { text: "Add New Rule", cls: "mod-cta" })
			.addEventListener("click", () => {
				const modal = new RuleEditModal( // Use new modal
					this.app,
					this.plugin,
					null, // Creating a new rule
					(newRule) => {
						// Add the new rule to settings
						this.plugin.settings.rulesRegistryEntries = [
							...this.plugin.getRulesRegistryEntries(), // Use rules getter
							newRule,
						];
						this.plugin.saveSettings();
						this.renderRulesRegistryList(rulesRegistryListEl); // Re-render the rules list
						new Notice(
							`Added rule: ${newRule.description || newRule.id}`
						);
					}
				);
				modal.open();
			});
		rulesRegistrySection.createEl("p", {
			text: "Manage rules applied to agent context based on `provibe-rule` tags in file frontmatter.",
			cls: "setting-item-description",
		});
		const rulesRegistryListEl = rulesRegistrySection.createDiv(
			"provibe-registry-list"
		);
		this.renderRulesRegistryList(rulesRegistryListEl); // Call rules list renderer

		// --- Inject CSS --- <<< CALL INJECTOR FUNCTION
		injectSettingsStyles(this.plugin);
	}

	// --- Helper to Render the Format Registry List ---
	renderFormatRegistryList(containerEl: HTMLElement) {
		containerEl.empty(); // Clear previous list

		const entries = this.plugin.getRegistryEntries(); // Use getter

		if (entries.length === 0) {
			containerEl.createEl("p", {
				text: "No format entries defined yet. Click 'Add New Entry' above to create one.",
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
						.setTooltip("Edit Format Entry") // Updated tooltip
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
									this.renderFormatRegistryList(containerEl); // Use specific renderer
									new Notice(
										`Updated format entry: ${
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
						.setTooltip("Delete Format Entry") // Updated tooltip
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
								this.renderFormatRegistryList(containerEl); // Use specific renderer
								new Notice(
									`Deleted format entry: ${
										entry.description || entry.id
									}`
								);
							}
						})
				);
		});
	}

	// --- Helper to Render the Rules Registry List ---
	renderRulesRegistryList(containerEl: HTMLElement) {
		containerEl.empty(); // Clear previous list

		const rules = this.plugin.getRulesRegistryEntries(); // Use rules getter

		if (rules.length === 0) {
			containerEl.createEl("p", {
				text: "No rules defined yet. Click 'Add New Rule' above to create one.",
				cls: "provibe-empty-list-message",
			});
			return;
		}

		// Sort alphabetically by description or ID for consistent order
		rules.sort((a, b) =>
			(a.description || a.id).localeCompare(b.description || b.id)
		);

		rules.forEach((rule) => {
			const settingItem = new Setting(containerEl)
				.setName(rule.description || `(ID: ${rule.id})`) // Show ID if no description
				.setDesc(`Tag: ${rule.id} | v${rule.version}`)
				.setClass("provibe-registry-item") // Reuse existing class

				// Edit Button
				.addButton((button) =>
					button
						.setIcon("pencil")
						.setTooltip("Edit Rule")
						.onClick(() => {
							const modal = new RuleEditModal(
								this.app,
								this.plugin,
								rule, // Pass the existing rule
								(updatedRule) => {
									// Update the rule in the settings array
									this.plugin.settings.rulesRegistryEntries =
										this.plugin
											.getRulesRegistryEntries()
											.map((r) =>
												r.id === updatedRule.id
													? updatedRule
													: r
											);
									this.plugin.saveSettings();
									this.renderRulesRegistryList(containerEl); // Re-render this list
									new Notice(
										`Updated rule: ${
											updatedRule.description ||
											updatedRule.id
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
						.setIcon("trash")
						.setTooltip("Delete Rule")
						.setClass("mod-warning")
						.onClick(async () => {
							if (
								confirm(
									`Are you sure you want to delete the rule "${
										rule.description || rule.id
									}"?`
								)
							) {
								this.plugin.settings.rulesRegistryEntries =
									this.plugin
										.getRulesRegistryEntries()
										.filter((r) => r.id !== rule.id); // Filter out the rule
								await this.plugin.saveSettings();
								this.renderRulesRegistryList(containerEl); // Re-render this list
								new Notice(
									`Deleted rule: ${
										rule.description || rule.id
									}`
								);
							}
						})
				);
		});
	}
}
