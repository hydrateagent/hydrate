import { App, Modal, ButtonComponent } from "obsidian";
import { diff_match_patch, Diff, patch_obj } from "diff-match-patch";
import HydratePlugin from "../main"; // May need plugin/app access later

// Define the structure for a diff hunk
interface DiffHunk {
	originalStartLine: number;
	originalLineCount: number;
	newStartLine: number;
	newLineCount: number;
	header: string; // e.g., @@ -1,5 +1,6 @@
	lines: { type: "context" | "addition" | "deletion"; content: string }[];
	applied: boolean; // Track user selection
}

// Define the structure for the result returned by the modal
export interface DiffReviewResult {
	toolCallId: string;
	applied: boolean; // Did the user click apply?
	finalContent?: string; // The content after applying selected hunks
	message: string; // User-facing message (Applied, Cancelled, Error)
}

export class DiffReviewModal extends Modal {
	private originalContent: string;
	private proposedContent: string;
	private filePath: string;
	private instructions: string;
	private toolCallId: string;
	private plugin: HydratePlugin;
	private resolvePromise: (result: DiffReviewResult) => void; // Function to resolve the promise when done
	private hunks: DiffHunk[] = [];
	// The following is fine, ts is confused.
	// @ts-ignore
	private dmp: diff_match_patch;
	private patches: patch_obj[] = []; // Store the raw patches from dmp

	constructor(
		app: App,
		plugin: HydratePlugin,
		filePath: string,
		originalContent: string,
		proposedContent: string,
		instructions: string,
		toolCallId: string,
		resolvePromise: (result: DiffReviewResult) => void
	) {
		super(app);
		this.plugin = plugin;
		this.filePath = filePath;
		this.originalContent = originalContent;
		this.proposedContent = proposedContent;
		this.instructions = instructions;
		this.toolCallId = toolCallId;
		this.resolvePromise = resolvePromise;
		this.dmp = new diff_match_patch();
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.empty();
		contentEl.addClass("hydrate-diff-modal-content");

		this.modalEl.addClass("hydrate-diff-modal"); // Add class to the modal container itself for sizing

		// --- Set Modal Width via JS --- //
		this.modalEl.style.width = "90vw";
		this.modalEl.style.maxWidth = "1400px";
		// --- End Set Modal Width --- //

		contentEl.createEl("h2", {
			text: `Review Proposed Changes for ${this.filePath}`,
		});
		contentEl.createEl("p", {
			text: `Based on instruction: "${this.instructions}"`,
		});

		// --- Diff Hunk Rendering ---
		const diffContainer = contentEl.createDiv({
			cls: "diff-hunks-container !w-full",
		});

		// Generate and Render Hunks
		this.generatePatchesAndHunks(); // Combined generation
		this.renderHunks(diffContainer);

		// --- Action Buttons ---
		const buttonContainer = contentEl.createDiv({
			cls: "diff-modal-buttons flex justify-end gap-2",
		});

		new ButtonComponent(buttonContainer)
			.setButtonText("Apply Selected Changes")
			.setCta() // Make it visually prominent
			.onClick(this.handleApply);

		new ButtonComponent(buttonContainer)
			.setButtonText("Cancel")
			.onClick(this.handleCancel);
	}

	// Renamed and implemented patch/hunk generation
	private generatePatchesAndHunks(): void {
		// Use patch_make for better hunk structure
		this.patches = this.dmp.patch_make(
			this.originalContent,
			this.proposedContent
		);
		this.hunks = []; // Reset hunks

		this.patches.forEach((patch, index) => {
			const hunk: DiffHunk = {
				// patch_obj properties: diffs, start1, start2, length1, length2
				originalStartLine: patch.start1 ?? 0, // DMP uses 0-based indexing internally for patches
				originalLineCount: patch.length1,
				newStartLine: patch.start2 ?? 0,
				newLineCount: patch.length2,
				header: `@@ -${(patch.start1 ?? 0) + 1},${patch.length1} +${
					(patch.start2 ?? 0) + 1
				},${patch.length2} @@`, // Create standard header (1-based)
				lines: [],
				applied: true, // Default to applying the hunk
			};

			patch.diffs.forEach((diff: Diff) => {
				const [type, text] = diff;
				const lines = text
					.split("\n")
					.filter(
						(line, idx, arr) => idx < arr.length - 1 || line !== ""
					); // Split lines, remove trailing empty line

				lines.forEach((lineContent) => {
					switch (type) {
						case 0: // Context
							hunk.lines.push({
								type: "context",
								content: lineContent,
							});
							break;
						case 1: // Addition
							hunk.lines.push({
								type: "addition",
								content: lineContent,
							});
							break;
						case -1: // Deletion
							hunk.lines.push({
								type: "deletion",
								content: lineContent,
							});
							break;
					}
				});
			});
			this.hunks.push(hunk);
		});
	}

	// Implemented hunk rendering
	private renderHunks(container: HTMLElement): void {
		container.empty();

		// --- Special Handling for Empty Original File ---
		if (this.originalContent === "" && this.proposedContent !== "") {
			const lines = this.proposedContent.split("\n");
			// Remove trailing empty line if present from split
			if (lines[lines.length - 1] === "") {
				lines.pop();
			}

			const hunkContainer = container.createDiv({ cls: "diff-hunk" });
			const headerContainer = hunkContainer.createDiv({
				cls: "diff-hunk-header",
			});
			// No checkbox needed as it's all or nothing for new file content
			headerContainer.createSpan({
				// Simple header indicating full insertion
				text: `@@ +1,${lines.length} @@ New File Content`,
				cls: "diff-hunk-header-text",
			});

			const linesContainer = hunkContainer.createDiv({
				cls: "diff-hunk-lines !font-mono",
			});

			lines.forEach((lineContent) => {
				const lineEl = linesContainer.createDiv({
					cls: `diff-line diff-line-addition bg-green-100 dark:bg-green-900/50`, // Always addition style
				});
				lineEl.setText(`+ ${lineContent}`); // Always '+' prefix
			});

			// Skip the rest of the standard hunk rendering
			return;
		}
		// --- End Special Handling ---

		if (this.hunks.length === 0) {
			container.setText("No changes detected.");
			return;
		}

		this.hunks.forEach((hunk, index) => {
			const hunkContainer = container.createDiv({ cls: "diff-hunk" });
			// Add initial class if discarded by default (though default is applied: true)
			hunkContainer.toggleClass("diff-hunk-discarded", !hunk.applied);

			const headerContainer = hunkContainer.createDiv({
				cls: "diff-hunk-header",
			});

			// Use standard HTML checkbox
			const checkbox = headerContainer.createEl("input", {
				type: "checkbox",
				cls: "diff-hunk-checkbox",
			});
			checkbox.checked = hunk.applied;
			checkbox.addEventListener("change", () => {
				hunk.applied = checkbox.checked;
				hunkContainer.toggleClass("diff-hunk-discarded", !hunk.applied);
			});

			headerContainer.createSpan({
				text: hunk.header,
				cls: "diff-hunk-header-text",
			});

			const linesContainer = hunkContainer.createDiv({
				cls: "diff-hunk-lines !font-mono",
			});

			hunk.lines.forEach((line) => {
				const lineEl = linesContainer.createDiv({
					// Combine existing classes with new Tailwind classes
					cls: `diff-line diff-line-${line.type} ${
						line.type === "addition"
							? "bg-green-100 dark:bg-green-900/50" // Faint green for light/dark modes
							: line.type === "deletion"
							? "bg-red-100 dark:bg-red-900/50" // Faint red for light/dark modes
							: "" // No background for context lines
					}`,
				});
				let prefix = " ";
				if (line.type === "addition") prefix = "+";
				if (line.type === "deletion") prefix = "-";
				lineEl.setText(`${prefix} ${line.content}`);
			});
		});
	}

	private handleApply = () => {
		// TODO: Implement logic to reconstruct the final content
		// based on the `applied` status of each hunk in `this.hunks`
		const reconstructedContent = this.reconstructContent();

		this.resolvePromise({
			toolCallId: this.toolCallId,
			applied: true,
			finalContent: reconstructedContent, // Send the reconstructed content
			message: `Changes selected for ${this.filePath}.`, // Message might be updated after actual file write
		});
		this.close();
	};

	private handleCancel = () => {
		this.resolvePromise({
			toolCallId: this.toolCallId,
			applied: false,
			message: `Edit cancelled for ${this.filePath}.`,
		});
		this.close();
	};

	// TODO: Implement content reconstruction logic using patches
	private reconstructContent(): string {
		const selectedPatches = this.patches.filter(
			(patch, index) => this.hunks[index]?.applied
		);

		if (selectedPatches.length === 0) {
			return this.originalContent;
		}

		const [newContent, results] = this.dmp.patch_apply(
			selectedPatches,
			this.originalContent
		);

		// Check results for errors, add type annotation for the callback parameter
		const successful = results.every((r: boolean) => r === true);
		if (successful) {
			return newContent;
		} else {
			console.error("Patch application failed for some hunks:", results);
			throw new Error(
				"Failed to apply selected changes. Please review the console."
			);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		// Ensure promise is resolved even if closed unexpectedly?
		// Might need a flag or check in handleCancel/handleApply
	}
}
