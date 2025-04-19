import { App, Modal, Setting, Notice, TextComponent, DropdownComponent, TextAreaComponent } from "obsidian";
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
          id: `entry-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`, // Generate semi-unique ID
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
        text
          .setPlaceholder("e.g., Standard Issue Board Template")
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
      .setDesc("Command like /issue. Must start with / and contain no spaces, or be empty.")
      .addText((text) => {
        triggerInput = text;
        text
          .setPlaceholder("/command")
          .setValue(this.entry.slashCommandTrigger ?? "")
          .onChange((value) => {
            const trimmed = value.trim();
            if (trimmed === "" || (trimmed.startsWith("/") && !trimmed.includes(" "))) {
              // Allow empty or starting with / and no spaces
              // We will update the actual entry.slashCommandTrigger on save after validation
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
    new Setting(contentEl).setName("Content Type").addDropdown((dropdown) => {
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
    contentEl.find(".provibe-registry-content-setting")?.addClass("is-tall"); // Use Obsidian's class if available, else custom

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
              descriptionInput?.inputEl.addClass("provibe-input-error"); // Highlight field
              return;
            } else {
              descriptionInput?.inputEl.removeClass("provibe-input-error");
            }

            // Trigger Format
            const trigger = triggerInput.getValue().trim(); // Get current UI value for validation
            const isValidTrigger = trigger === "" || (trigger.startsWith("/") && !trigger.includes(" "));
            if (!isValidTrigger) {
              new Notice("Slash command trigger must start with '/' and contain no spaces, or be empty.");
              triggerInput?.inputEl.addClass("provibe-input-error");
              return;
            } else {
              triggerInput?.inputEl.removeClass("provibe-input-error");
              // Update entry's trigger *after* validation
              this.entry.slashCommandTrigger = trigger === "" ? undefined : trigger;
            }

            // Trigger Uniqueness (only if trigger is set)
            if (this.entry.slashCommandTrigger) {
              const existingEntry = this.plugin.getRegistryEntryByTrigger(this.entry.slashCommandTrigger);
              if (existingEntry && existingEntry.id !== this.entry.id) {
                new Notice(
                  `Slash command trigger "${this.entry.slashCommandTrigger}" is already used by entry "${existingEntry.description}". Please choose a unique trigger.`
                );
                triggerInput?.inputEl.addClass("provibe-input-error");
                return;
              } else {
                triggerInput?.inputEl.removeClass("provibe-input-error");
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
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
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
