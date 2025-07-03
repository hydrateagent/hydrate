import { App, FuzzySuggestModal, TFile, FuzzyMatch } from "obsidian";
import { HydrateView } from "./hydrateView";
import { renderFilePills } from "./domUtils";

export class NoteSearchModal extends FuzzySuggestModal<TFile> {
	private view: HydrateView;
	private onSelect: (file: TFile) => void;

	constructor(app: App, view: HydrateView, onSelect: (file: TFile) => void) {
		super(app);
		this.view = view;
		this.onSelect = onSelect;
		this.setPlaceholder("Search for a note to add to context...");
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.basename;
	}

	renderSuggestion(item: FuzzyMatch<TFile>, el: HTMLElement): void {
		const file = item.item;
		el.createEl("div", { text: file.basename, cls: "suggestion-title" });

		if (file.path !== file.basename + ".md") {
			el.createEl("small", { text: file.path, cls: "suggestion-note" });
		}
	}

	onChooseItem(file: TFile): void {
		this.onSelect(file);
	}
}
