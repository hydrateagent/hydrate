// src/ReactViewHost.ts
import {
	ItemView,
	WorkspaceLeaf,
	TFile,
	TAbstractFile,
	ViewStateResult,
	Notice,
	MarkdownView,
} from "obsidian";
import * as React from "react";
import { Root, createRoot } from "react-dom/client";
import HydratePlugin, {
	getReactViewComponent,
	REACT_HOST_VIEW_TYPE,
} from "./main"; // Adjust path if needed
import { ReactViewProps } from "./types";

export class ReactViewHost extends ItemView {
	plugin: HydratePlugin;
	currentFilePath: string | null = null;
	currentViewKey: string | null = null;
	private reactRoot: Root | null = null;
	private currentMarkdownContent: string | null = null; // Store current content for comparison

	constructor(leaf: WorkspaceLeaf, plugin: HydratePlugin) {
		super(leaf);
		this.plugin = plugin;
		this.navigation = true; // Allow back/forward navigation within this view type

		// Add necessary CSS class for styling if needed
		this.containerEl.addClass("hydrate-react-host-container");
	}

	getViewType(): string {
		return REACT_HOST_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.currentFilePath
			? (this.currentFilePath.split("/").pop() ?? "Hydrate View")
			: "Hydrate View";
	}

	// Store file path and view key in view state
	getState(): any {
		const state = {
			...super.getState(), // Preserve scroll position etc. if possible
			filePath: this.currentFilePath,
			viewKey: this.currentViewKey,
		};
		console.log(
			"ReactViewHost [getState]: Returning state:",
			JSON.stringify(state),
		);
		return state;
	}

	// Set state is called when navigating to this view, potentially reusing the leaf
	async setState(state: any, result: ViewStateResult): Promise<void> {
		console.log(
			"ReactViewHost [setState]: Received state:",
			JSON.stringify(state),
		);
		console.log(
			`ReactViewHost [setState]: Current path BEFORE: ${this.currentFilePath}, Current key BEFORE: ${this.currentViewKey}`,
		);

		const newFilePath = state.filePath;
		const newViewKey = state.viewKey;

		let shouldRemount = false;

		if (
			newFilePath &&
			newViewKey &&
			(newFilePath !== this.currentFilePath ||
				newViewKey !== this.currentViewKey)
		) {
			console.log(
				`ReactViewHost [setState]: State changed - New File: ${newFilePath}, New Key: ${newViewKey}`,
			);
			this.currentFilePath = newFilePath;
			this.currentViewKey = newViewKey;
			this.updateDisplayText(); // Update tab title
			shouldRemount = true;
		} else {
			console.log(
				"ReactViewHost [setState]: State did not change file path or view key significantly. Remount not triggered by state change logic.",
			);
			// If path/key are the same, but maybe content updated externally?
			// The handleVaultModify listener should handle remounting in that case.
			// We still need to call super.setState later.
		}

		if (shouldRemount) {
			console.log(
				"ReactViewHost [setState]: Triggering mountReactComponent...",
			);
			// Trigger React component mount/update
			await this.mountReactComponent();
		} else {
			console.log(
				"ReactViewHost [setState]: Skipping mountReactComponent call.",
			);
		}

		// Important: Inform Obsidian we are done setting the state
		console.log("ReactViewHost [setState]: Calling super.setState...");
		await super.setState(state, result);
		// Using setResult() is deprecated, super.setState handles it.
	}

	// Called when the view is first loaded into the DOM
	async onOpen(): Promise<void> {
		console.log(
			`ReactViewHost [onOpen]: Current path: ${this.currentFilePath}, Current key: ${this.currentViewKey}`,
		);
		// Initial state should be set by the time onOpen is called if navigated to
		// If opened directly (less common), state might be minimal
		const state = this.getState(); // Logged within getState
		// Ensure currentFilePath/Key are potentially updated if state was set *before* onOpen (unlikely but possible)
		if (state.filePath && state.filePath !== this.currentFilePath) {
			console.log(
				`ReactViewHost [onOpen]: Updating filePath from initial state: ${state.filePath}`,
			);
			this.currentFilePath = state.filePath;
		}
		if (state.viewKey && state.viewKey !== this.currentViewKey) {
			console.log(
				`ReactViewHost [onOpen]: Updating viewKey from initial state: ${state.viewKey}`,
			);
			this.currentViewKey = state.viewKey;
		}

		this.updateDisplayText();

		// Add action to switch back to Markdown
		this.addAction(
			"document", // Icon name
			"Switch to Markdown View",
			this.switchToMarkdownView,
		);

		// Listen for modifications to the current file
		this.registerEvent(this.app.vault.on("modify", this.handleVaultModify));

		// Mount the component if path and key are present (needed if setState didn't trigger mount)
		if (this.currentFilePath && this.currentViewKey && !this.reactRoot) {
			console.log(
				"ReactViewHost [onOpen]: Path and Key present, but no reactRoot. Attempting mount...",
			);
			await this.mountReactComponent();
		} else if (!this.currentFilePath || !this.currentViewKey) {
			console.log(
				"ReactViewHost [onOpen]: Missing path or key, cannot mount component yet.",
			);
		} else {
			console.log(
				"ReactViewHost [onOpen]: React root seems to exist already or mount was triggered by setState.",
			);
		}
	}

	// Called when the view is closed
	async onClose(): Promise<void> {
		this.unmountReactComponent();
	}

	private updateDisplayText(): void {
		console.log(
			"ReactViewHost [updateDisplayText]: Updating display text.",
		);
		// Update tab title - call this after currentFilePath changes
		const title = this.getDisplayText();
		// this.leaf.setDisplayText(title); // Remove this line - getDisplayText handles it
		// Update icon if desired: this.leaf.tabHeaderInnerIconEl.empty(); this.leaf.tabHeaderInnerIconEl.createEl(...)
	}

	private unmountReactComponent(): void {
		if (this.reactRoot) {
			console.log(
				"ReactViewHost [unmountReactComponent]: Unmounting React component.",
			);
			try {
				this.reactRoot.unmount();
				this.reactRoot = null;
				this.contentEl.empty(); // Clear the container
				console.log(
					"ReactViewHost [unmountReactComponent]: Unmount successful.",
				);
			} catch (e) {
				console.error(
					"ReactViewHost [unmountReactComponent]: Error during unmount:",
					e,
				);
			}
		} else {
			console.log(
				"ReactViewHost [unmountReactComponent]: No React root to unmount.",
			);
		}
	}

	private async mountReactComponent(): Promise<void> {
		console.log(
			`ReactViewHost [mountReactComponent]: Attempting to mount component for Key: ${this.currentViewKey}, File: ${this.currentFilePath}`,
		);
		// Ensure previous component is unmounted *before* trying to mount new one
		this.unmountReactComponent();

		if (!this.currentFilePath || !this.currentViewKey) {
			console.error(
				"ReactViewHost [mountReactComponent]: Missing file path or view key.",
			);
			this.contentEl.setText(
				"Error: Missing file path or view key for React component.",
			);
			return;
		}

		const ReactComponent = getReactViewComponent(this.currentViewKey);
		if (!ReactComponent) {
			console.error(
				`ReactViewHost [mountReactComponent]: No React component registered for key "${this.currentViewKey}".`,
			);
			this.contentEl.setText(
				`Error: No React component registered for key "${this.currentViewKey}".`,
			);
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(this.currentFilePath);
		if (!(file instanceof TFile)) {
			console.error(
				`ReactViewHost [mountReactComponent]: File not found or is not a TFile: ${this.currentFilePath}`,
			);
			this.contentEl.setText(
				`Error: File not found: ${this.currentFilePath}`,
			);
			return;
		}

		try {
			console.log(
				`ReactViewHost [mountReactComponent]: Reading file content for ${file.path}`,
			);
			this.currentMarkdownContent = await this.app.vault.read(file);
			console.log(
				`ReactViewHost [mountReactComponent]: File content read (${this.currentMarkdownContent.length} chars). Preparing props.`,
			);

			const props: ReactViewProps = {
				app: this.app,
				plugin: this.plugin,
				filePath: this.currentFilePath,
				markdownContent: this.currentMarkdownContent,
				// Use arrow functions to preserve 'this' context
				updateMarkdownContent: this.updateMarkdownContent,
				switchToMarkdownView: this.switchToMarkdownView,
			};

			// Ensure the container element exists
			if (!this.contentEl) {
				console.error(
					"ReactViewHost [mountReactComponent]: contentEl is not available!",
				);
				return;
			}

			// Ensure contentEl is empty before creating root
			this.contentEl.empty();

			console.log(
				"ReactViewHost [mountReactComponent]: Rendering React component...",
			);
			this.reactRoot = createRoot(this.contentEl);
			this.reactRoot.render(React.createElement(ReactComponent, props));
			console.log(
				"ReactViewHost [mountReactComponent]: React component rendered successfully.",
			);
		} catch (error) {
			console.error(
				"ReactViewHost [mountReactComponent]: Error mounting React component:",
				error,
			);
			this.contentEl.setText(
				`Error loading component: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	// --- Callback for React Component to Update Markdown ---
	// Use arrow function to bind 'this' correctly
	updateMarkdownContent = async (newContent: string): Promise<boolean> => {
		console.log("ReactViewHost [updateMarkdownContent]: Initiated.");
		if (!this.currentFilePath) {
			console.error(
				`ReactViewHost [updateMarkdownContent]: Cannot update markdown, currentFilePath is null.`,
			);
			new Notice("Error: Cannot save changes, file context lost.", 5000);
			return false;
		}

		// Get the file object first
		const file = this.app.vault.getAbstractFileByPath(this.currentFilePath);
		if (!(file instanceof TFile)) {
			console.error(
				`ReactViewHost [updateMarkdownContent]: File not found during update: ${this.currentFilePath}`,
			);
			new Notice("Error: File not found, cannot save changes.", 5000);
			return false;
		}

		// Only write if content actually changed
		if (newContent === this.currentMarkdownContent) {
			console.log(
				"ReactViewHost [updateMarkdownContent]: Content unchanged, skipping write.",
			);
			return true;
		}

		try {
			console.log(
				`ReactViewHost [updateMarkdownContent]: Modifying file ${file.path}...`,
			);
			await this.app.vault.modify(file, newContent);
			// Update internal cache AFTER successful write
			this.currentMarkdownContent = newContent;
			console.log(
				"ReactViewHost [updateMarkdownContent]: File modified successfully.",
			);
			new Notice(`${file.basename} updated.`, 1500); // Brief confirmation
			return true;
		} catch (error) {
			console.error(
				`ReactViewHost [updateMarkdownContent]: Error updating markdown file ${this.currentFilePath}:`,
				error,
			);
			new Notice(
				`Error saving changes to ${file.basename}: ${
					error instanceof Error ? error.message : "Unknown error"
				}`,
				5000,
			);
			return false;
		}
	};

	// --- Callback for React Component or Action to Switch to Markdown View ---
	// Use arrow function to bind 'this' correctly
	switchToMarkdownView = async (): Promise<void> => {
		console.log("ReactViewHost [switchToMarkdownView]: Initiated.");
		if (!this.currentFilePath) {
			console.error(
				"ReactViewHost [switchToMarkdownView]: Cannot switch to markdown, currentFilePath is null.",
			);
			return;
		}

		// Set the flag BEFORE changing the state
		console.log(
			"ReactViewHost [switchToMarkdownView]: Setting isSwitchingToMarkdown flag.",
		);
		this.plugin.isSwitchingToMarkdown = true;

		// Preserve scroll state etc. if possible
		const state = this.getState();
		delete state.viewKey; // Remove our custom key for markdown view

		console.log(
			`ReactViewHost [switchToMarkdownView]: Setting view state to markdown for ${this.currentFilePath}`,
		);
		try {
			await this.leaf.setViewState({
				type: "markdown",
				state: { ...state, file: this.currentFilePath }, // Ensure file is passed
			});
			console.log(
				"ReactViewHost [switchToMarkdownView]: setViewState completed.",
			);
		} catch (error) {
			console.error(
				"ReactViewHost [switchToMarkdownView]: Error during setViewState:",
				error,
			);
			// Reset flag potentially? Or handle error state
			this.plugin.isSwitchingToMarkdown = false; // Reset flag on error maybe?
		}

		// Note: isSwitchingToMarkdown flag should be reset by layout-change or file-open handlers later
	};

	// --- Handle External File Modifications ---
	// Use arrow function to bind 'this' correctly
	private handleVaultModify = async (file: TAbstractFile): Promise<void> => {
		// Check if the modified file is the one currently displayed
		if (file instanceof TFile && file.path === this.currentFilePath) {
			console.log(
				`ReactViewHost [handleVaultModify]: Detected modification to current file: ${file.path}`,
			);
			try {
				const newContent = await this.app.vault.read(file);
				// Check if content actually changed before remounting
				if (newContent !== this.currentMarkdownContent) {
					console.log(
						"ReactViewHost [handleVaultModify]: Content changed. Updating cache and remounting component.",
					);
					this.currentMarkdownContent = newContent; // Update cache *before* remount
					await this.mountReactComponent(); // Re-render with new content
				} else {
					console.log(
						"ReactViewHost [handleVaultModify]: Content has not changed, skipping remount.",
					);
				}
			} catch (error) {
				console.error(
					`ReactViewHost [handleVaultModify]: Error reading modified file ${this.currentFilePath}:`,
					error,
				);
				// Optionally show an error message to the user
				new Notice(
					`Error reloading ${file.basename} after external modification.`,
					5000,
				);
			}
		}
	};
}
