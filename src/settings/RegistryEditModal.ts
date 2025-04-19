import {
	App,
	Modal,
	Setting,
	Notice,
	TextComponent,
	DropdownComponent,
	TextAreaComponent,
} from "obsidian";
import ProVibePlugin from "../../main"; // Adjust path as needed
import { RegistryEntry, RegistryEntryContentType } from "../types";

// --- Modal for Editing/Adding Registry Entries ---
export class RegistryEditModal extends Modal {
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

		// Add class for wider modal (requires corresponding CSS in styles.css)
		this.modalEl.addClass("provibe-registry-edit-modal-wide");
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
				this.textInputs.push(text);
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
						this.entry.description = value.trim();
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
							text.inputEl.removeClass("provibe-input-error");
						} else {
							text.inputEl.addClass("provibe-input-error");
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
					.setValue(this.entry.contentType)
					.onChange((value: RegistryEntryContentType) => {
						this.entry.contentType = value;
					});
				this.dropdowns.push(dropdown);
			});

		// --- Content (Manual Layout - Attempt 2) ---
		// Create a container div for the whole setting item
		const contentSettingEl = contentEl.createDiv(
			"setting-item provibe-content-setting-vertical"
		); // Add custom class for vertical layout

		// Create info block (label + description) and append it
		const infoEl = contentSettingEl.createDiv("setting-item-info");
		infoEl.createDiv({ cls: "setting-item-name", text: "Content" });
		infoEl.createDiv({
			cls: "setting-item-description",
			text: "The actual template, schema, or text.",
		});

		// Create control block (for the textarea) and append it
		const controlEl = contentSettingEl.createDiv("setting-item-control");

		// Create the text area component, targeting the control element
		const contentTextArea = new TextAreaComponent(controlEl); // Attach to the control element
		contentTextArea.inputEl.addClasses([
			"markdown-source-view",
			"mod-cm6",
			"is-live-preview",
			"provibe-content-textarea", // Add specific class for styling
		]);
		contentTextArea
			.setPlaceholder("Enter content here...")
			.setValue(this.entry.content)
			.onChange((value) => {
				this.entry.content = value;
			})
			.inputEl.setAttrs({
				rows: 15,
				// Style is better handled in CSS now
				// style: "width: 100%; min-height: 250px; resize: vertical; font-family: var(--font-monospace);",
			});

		this.textAreas.push(contentTextArea); // Store for cleanup

		// --- Buttons ---
		new Setting(contentEl)
			.setClass("provibe-modal-button-bar")
			.addButton((button) =>
				button
					.setButtonText("Save")
					.setCta()
					.onClick(() => {
						// --- Validation (Keep existing logic) ---
						if (!this.entry.description) {
							new Notice("Description cannot be empty.");
							descriptionInput?.inputEl.addClass(
								"provibe-input-error"
							);
							return;
						} else {
							descriptionInput?.inputEl.removeClass(
								"provibe-input-error"
							);
						}

						const trigger = triggerInput.getValue().trim();
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
							this.entry.slashCommandTrigger =
								trigger === "" ? undefined : trigger;
						}

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
		this.textInputs = [];
		this.dropdowns = [];
		this.textAreas = [];
		contentEl.empty();
	}
}
// --- END MODAL ---
