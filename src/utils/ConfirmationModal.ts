import { App, Modal, ButtonComponent } from "obsidian";

/**
 * A simple confirmation modal that replaces window.confirm()
 * Following Obsidian's UI patterns for consistency
 */
export class ConfirmationModal extends Modal {
	private message: string;
	private onConfirm: () => void;
	private onCancel?: () => void;
	private confirmText: string;
	private cancelText: string;

	constructor(
		app: App,
		message: string,
		onConfirm: () => void,
		onCancel?: () => void,
		confirmText = "Confirm",
		cancelText = "Cancel",
	) {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
		this.onCancel = onCancel;
		this.confirmText = confirmText;
		this.cancelText = cancelText;
	}

	onOpen(): void {
		const { contentEl } = this;

		contentEl.createEl("p", { text: this.message });

		const buttonContainer = contentEl.createDiv({
			cls: "modal-button-container",
		});

		// Cancel button (left)
		new ButtonComponent(buttonContainer)
			.setButtonText(this.cancelText)
			.onClick(() => {
				this.close();
				if (this.onCancel) {
					this.onCancel();
				}
			});

		// Confirm button (right, warning style for destructive actions)
		new ButtonComponent(buttonContainer)
			.setButtonText(this.confirmText)
			.setCta()
			.setWarning()
			.onClick(() => {
				this.close();
				this.onConfirm();
			});
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
