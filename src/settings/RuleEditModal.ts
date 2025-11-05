import {
	App,
	Modal,
	Setting,
	Notice,
	TextComponent,
	TextAreaComponent,
} from "obsidian";
import HydratePlugin from "../main"; // Corrected path
import { RuleEntry } from "../types"; // Use RuleEntry type

// --- Modal for Editing/Adding Rules Registry Entries ---
export class RuleEditModal extends Modal {
	entry: RuleEntry; // Entry to edit or a template for a new one
	plugin: HydratePlugin;
	isNew: boolean;
	onSubmit: (result: RuleEntry) => void; // Callback on successful save

	// Components for cleanup
	private textInputs: TextComponent[] = [];
	private textAreas: TextAreaComponent[] = [];

	constructor(
		app: App,
		plugin: HydratePlugin,
		entry: RuleEntry | null, // Pass null for new entry
		onSubmit: (result: RuleEntry) => void,
	) {
		super(app);
		this.plugin = plugin;
		this.isNew = entry === null;
		this.entry = entry
			? { ...entry } // Create a copy if editing
			: {
					// Provide defaults for new entry
					id: "", // User must define the ID/tag
					description: "",
					version: 1,
					ruleText: "",
				};
		this.onSubmit = onSubmit;

		// Add class for wider modal (requires corresponding CSS)
		this.modalEl.addClass("hydrate-registry-edit-modal-wide"); // Reuse existing class
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", {
			text: this.isNew ? "Add new rule entry" : "Edit rule entry",
		});

		// --- Form Fields ---

		// ID (Rule Tag)
		let idInput: TextComponent;
		new Setting(contentEl)
			.setName("Rule ID (tag)")
			.setDesc(
				"identifier used in `hydrate-rules` frontmatter. must be unique and contain no spaces.",
			)
			.addText((text) => {
				idInput = text;
				text.setPlaceholder("Name")
					.setValue(this.entry.id)
					.setDisabled(!this.isNew) // Disable if editing existing
					.onChange((value) => {
						const trimmed = value.trim();
						if (trimmed && !trimmed.includes(" ")) {
							text.inputEl.removeClass("hydrate-input-error");
						} else {
							text.inputEl.addClass("hydrate-input-error");
						}
						// Update entry ID only if it's a new entry being created
						if (this.isNew) {
							this.entry.id = trimmed;
						}
					});
				this.textInputs.push(text);
			});

		// Description
		let descriptionInput: TextComponent;
		new Setting(contentEl)
			.setName("Description")
			.setDesc("Purpose of this rule")
			.addText((text) => {
				descriptionInput = text;
				text.setPlaceholder("Description")
					.setValue(this.entry.description)
					.onChange((value) => {
						this.entry.description = value.trim();
					});
				this.textInputs.push(text);
			});

		// Rule Text (Content)
		// Using manual layout for better control over textarea size
		const contentSettingEl = contentEl.createDiv(
			"setting-item hydrate-content-setting-vertical",
		); // Reuse existing class
		const infoEl = contentSettingEl.createDiv("setting-item-info");
		infoEl.createDiv({ cls: "setting-item-name", text: "Rule text" });
		infoEl.createDiv({
			cls: "setting-item-description",
			text: "The text content of the rule to be included in the agent context.",
		});
		const controlEl = contentSettingEl.createDiv("setting-item-control");
		const contentTextArea = new TextAreaComponent(controlEl);
		contentTextArea.inputEl.addClasses([
			"markdown-source-view",
			"mod-cm6",
			"is-live-preview",
			"hydrate-content-textarea", // Reuse existing class
		]);
		contentTextArea
			.setPlaceholder("Enter rule text here...")
			.setValue(this.entry.ruleText)
			.onChange((value) => {
				this.entry.ruleText = value; // No trim needed here
			})
			.inputEl.setAttrs({
				rows: 15,
			});
		this.textAreas.push(contentTextArea);

		// --- Buttons ---
		new Setting(contentEl)
			.setClass("hydrate-modal-button-bar")
			.addButton((button) =>
				button
					.setButtonText("Save")
					.setCta()
					.onClick(() => {
						// --- Validation ---
						const ruleId = this.entry.id.trim(); // Get ID from entry (updated in onChange if new)

						// Validate ID
						if (!ruleId) {
							new Notice("Rule ID (tag) cannot be empty.");
							idInput?.inputEl.addClass("hydrate-input-error");
							return;
						}
						if (ruleId.includes(" ")) {
							new Notice("Rule ID (tag) cannot contain spaces.");
							idInput?.inputEl.addClass("hydrate-input-error");
							return;
						}
						// Check uniqueness only if it's a new entry
						if (this.isNew) {
							const existingRule =
								this.plugin.getRuleById(ruleId);
							if (existingRule) {
								new Notice(
									`Rule ID "${ruleId}" is already used by entry "${existingRule.description}". Please choose a unique ID.`,
								);
								idInput?.inputEl.addClass(
									"hydrate-input-error",
								);
								return;
							}
						}
						idInput?.inputEl.removeClass("hydrate-input-error");

						// Validate Description
						if (!this.entry.description) {
							new Notice("Description cannot be empty.");
							descriptionInput?.inputEl.addClass(
								"hydrate-input-error",
							);
							return;
						} else {
							descriptionInput?.inputEl.removeClass(
								"hydrate-input-error",
							);
						}

						// Update version if editing
						if (!this.isNew) {
							this.entry.version = (this.entry.version || 1) + 1;
						}

						this.onSubmit(this.entry);
						this.close();
					}),
			)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => this.close()),
			);
	}

	onClose() {
		const { contentEl } = this;
		this.textInputs = [];
		this.textAreas = [];
		contentEl.empty();
	}
}
// --- END MODAL ---
