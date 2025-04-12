import { ItemView, WorkspaceLeaf } from "obsidian";

export const PROVIBE_VIEW_TYPE = "provibe-view";

export class ProVibeView extends ItemView {
	private textInput: HTMLTextAreaElement;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return PROVIBE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "ProVibe";
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();

		// Create a description for the pane
		container.createEl("p", {
			text: "Enter your prompt below. This pane can be toggled with the ProVibe icon in the left ribbon.",
			cls: "provibe-description",
		});

		// Add buttons above the text input
		const buttonContainer = container.createEl("div", {
			cls: "provibe-button-container",
		});

		const clearButton = buttonContainer.createEl("button", {
			text: "Clear",
			cls: "provibe-button provibe-clear-button",
		});

		const sendButton = buttonContainer.createEl("button", {
			text: "Send",
			cls: "provibe-button provibe-send-button",
		});

		// Create textarea for text input
		this.textInput = container.createEl("textarea", {
			cls: "provibe-textarea",
			attr: {
				placeholder: "Enter your text here...",
				rows: "10",
			},
		});

		// Add event listeners for buttons
		clearButton.addEventListener("click", () => {
			this.textInput.value = "";
			this.textInput.focus();
		});

		sendButton.addEventListener("click", () => {
			// Later we'll implement sending the text
			console.log("Send clicked with text:", this.getTextContent());
		});
	}

	async onClose() {
		// Clean up any event listeners or resources when the view is closed
	}

	// Method to get the text content
	getTextContent(): string {
		return this.textInput?.value || "";
	}

	// Method to set the text content
	setTextContent(text: string): void {
		if (this.textInput) {
			this.textInput.value = text;
		}
	}
}
