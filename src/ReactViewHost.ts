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
import ProVibePlugin, {
	getReactViewComponent,
	REACT_HOST_VIEW_TYPE,
} from "../main"; // Adjust path if needed
import { ReactViewProps } from "./types";

export class ReactViewHost extends ItemView {
	plugin: ProVibePlugin;
	currentFilePath: string | null = null;
	currentViewKey: string | null = null;
	private reactRoot: Root | null = null;
	private currentMarkdownContent: string | null = null; // Store current content for comparison

	constructor(leaf: WorkspaceLeaf, plugin: ProVibePlugin) {
		console.log("ReactViewHost: Constructor called");
		super(leaf);
		this.plugin = plugin;
		this.navigation = true; // Allow back/forward navigation within this view type

		// Add necessary CSS class for styling if needed
		this.containerEl.addClass("provibe-react-host-container");
	}

	getViewType(): string {
		return REACT_HOST_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.currentFilePath
			? this.currentFilePath.split("/").pop() ?? "ProVibe View"
			: "ProVibe View";
	}

	// Store file path and view key in view state
	getState(): any {
		return {
			...super.getState(), // Preserve scroll position etc. if possible
			filePath: this.currentFilePath,
			viewKey: this.currentViewKey,
		};
	}

	// Set state is called when navigating to this view, potentially reusing the leaf
	async setState(state: any, result: ViewStateResult): Promise<void> {
		console.log("ReactViewHost: setState called with state:", state);
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
				`ReactViewHost: State changed - New File: ${newFilePath}, New Key: ${newViewKey}`
			);
			this.currentFilePath = newFilePath;
			this.currentViewKey = newViewKey;
			this.updateDisplayText(); // Update tab title
			shouldRemount = true;
		} else {
			console.log(
				"ReactViewHost: State did not change file path or view key significantly."
			);
			// Maybe just update scroll position etc. from state if needed
		}

		if (shouldRemount) {
			// Trigger React component mount/update
			await this.mountReactComponent();
		}

		// Important: Inform Obsidian we are done setting the state
		await super.setState(state, result);
		// Using setResult() is deprecated, super.setState handles it.
	}

	// Called when the view is first loaded into the DOM
	async onOpen(): Promise<void> {
		console.log("ReactViewHost: onOpen");
		// Initial state should be set by the time onOpen is called if navigated to
		// If opened directly (less common), state might be minimal
		const state = this.getState();
		this.currentFilePath = state.filePath;
		this.currentViewKey = state.viewKey;

		this.updateDisplayText();

		// Add action to switch back to Markdown
		this.addAction(
			"document", // Icon name
			"Switch to Markdown View",
			this.switchToMarkdownView
		);

		// Listen for modifications to the current file
		this.registerEvent(this.app.vault.on("modify", this.handleVaultModify));

		await this.mountReactComponent();
	}

	// Called when the view is closed
	async onClose(): Promise<void> {
		console.log("ReactViewHost: onClose");
		this.unmountReactComponent();
	}

	private updateDisplayText(): void {
		// Update tab title - call this after currentFilePath changes
		const title = this.getDisplayText();
		// this.leaf.setDisplayText(title); // Remove this line - getDisplayText handles it
		// Update icon if desired: this.leaf.tabHeaderInnerIconEl.empty(); this.leaf.tabHeaderInnerIconEl.createEl(...)
	}

	private unmountReactComponent(): void {
		if (this.reactRoot) {
			console.log("ReactViewHost: Unmounting React component.");
			this.reactRoot.unmount();
			this.reactRoot = null;
			this.contentEl.empty(); // Clear the container
		}
	}

	private async mountReactComponent(): Promise<void> {
		console.log(
			`ReactViewHost: Attempting to mount component for Key: ${this.currentViewKey}, File: ${this.currentFilePath}`
		);
		this.unmountReactComponent(); // Ensure previous component is unmounted

		if (!this.currentFilePath || !this.currentViewKey) {
			console.error("ReactViewHost: Missing file path or view key.");
			this.contentEl.setText(
				"Error: Missing file path or view key for React component."
			);
			return;
		}

		const ReactComponent = getReactViewComponent(this.currentViewKey);
		if (!ReactComponent) {
			console.error(
				`ReactViewHost: No React component registered for key "${this.currentViewKey}".`
			);
			this.contentEl.setText(
				`Error: No React component registered for key "${this.currentViewKey}".`
			);
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(this.currentFilePath);
		if (!(file instanceof TFile)) {
			console.error(
				`ReactViewHost: File not found or is not a TFile: ${this.currentFilePath}`
			);
			this.contentEl.setText(
				`Error: File not found: ${this.currentFilePath}`
			);
			return;
		}

		try {
			this.currentMarkdownContent = await this.app.vault.read(file);

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
				console.error("ReactViewHost: contentEl is not available!");
				return;
			}

			console.log("ReactViewHost: Rendering React component...");
			this.reactRoot = createRoot(this.contentEl);
			this.reactRoot.render(React.createElement(ReactComponent, props));
			console.log("ReactViewHost: React component rendered.");
		} catch (error) {
			console.error(
				"ReactViewHost: Error mounting React component:",
				error
			);
			this.contentEl.setText(
				`Error loading component: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
	}

	// --- Callback for React Component to Update Markdown ---
	// Use arrow function to bind 'this' correctly
	updateMarkdownContent = async (newContent: string): Promise<void> => {
		if (!this.currentFilePath) {
			console.error(
				"ReactViewHost: Cannot update markdown, currentFilePath is null."
			);
			new Notice("Error: Cannot save changes, file context lost.", 5000);
			return;
		}

		// Optional: Only write if content actually changed
		if (newContent === this.currentMarkdownContent) {
			console.log(
				"ReactViewHost: Skipping markdown update, content unchanged."
			);
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(this.currentFilePath);
		if (!(file instanceof TFile)) {
			console.error(
				`ReactViewHost: File not found during update: ${this.currentFilePath}`
			);
			new Notice("Error: File not found, cannot save changes.", 5000);
			return;
		}

		try {
			console.log(
				`ReactViewHost: Updating markdown for ${this.currentFilePath}`
			);
			await this.app.vault.modify(file, newContent);
			this.currentMarkdownContent = newContent; // Update internal cache
			new Notice(`${file.basename} updated.`, 1500); // Brief confirmation
		} catch (error) {
			console.error(
				`ReactViewHost: Error updating markdown file ${this.currentFilePath}:`,
				error
			);
			new Notice(
				`Error saving changes to ${file.basename}: ${
					error instanceof Error ? error.message : "Unknown error"
				}`,
				5000
			);
		}
	};

	// --- Callback for React Component or Action to Switch to Markdown View ---
	// Use arrow function to bind 'this' correctly
	switchToMarkdownView = async (): Promise<void> => {
		if (!this.currentFilePath) {
			console.error(
				"ReactViewHost: Cannot switch to markdown, currentFilePath is null."
			);
			return;
		}
		console.log(
			`ReactViewHost: Switching leaf to Markdown view for ${this.currentFilePath}`
		);

		// Preserve scroll state etc. if possible
		const state = this.getState();
		delete state.viewKey; // Remove our custom key for markdown view

		await this.leaf.setViewState({
			type: "markdown",
			state: { ...state, file: this.currentFilePath }, // Ensure file is passed
		});
	};

	// --- Handle External File Modifications ---
	// Use arrow function to bind 'this' correctly
	private handleVaultModify = async (file: TAbstractFile): Promise<void> => {
		// Check if the modified file is the one currently displayed
		if (file instanceof TFile && file.path === this.currentFilePath) {
			console.log(
				`ReactViewHost: Detected external modification for ${this.currentFilePath}`
			);
			try {
				const newContent = await this.app.vault.read(file);
				// Check if content actually changed before remounting
				if (newContent !== this.currentMarkdownContent) {
					console.log(
						`ReactViewHost: Content changed externally, remounting component for ${this.currentFilePath}`
					);
					this.currentMarkdownContent = newContent; // Update cache *before* remount
					await this.mountReactComponent(); // Re-render with new content
				} else {
					console.log(
						`ReactViewHost: External modification detected but content is identical for ${this.currentFilePath}, skipping remount.`
					);
				}
			} catch (error) {
				console.error(
					`ReactViewHost: Error reading modified file ${this.currentFilePath}:`,
					error
				);
				// Optionally show an error message to the user
				new Notice(
					`Error reloading ${file.basename} after external modification.`,
					5000
				);
			}
		}
	};
}
