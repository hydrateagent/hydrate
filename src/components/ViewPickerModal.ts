import { App, FuzzySuggestModal, FuzzyMatch, TFile } from "obsidian";

interface ViewOption {
	name: string;
	source: "built-in" | "custom";
}

export class ViewPickerModal extends FuzzySuggestModal<ViewOption> {
	private views: ViewOption[];
	private onSelect: (viewName: string) => void;

	constructor(
		app: App,
		views: ViewOption[],
		onSelect: (viewName: string) => void,
	) {
		super(app);
		this.views = views;
		this.onSelect = onSelect;
		this.setPlaceholder("Select a view to apply...");
	}

	getItems(): ViewOption[] {
		return this.views;
	}

	getItemText(view: ViewOption): string {
		return view.name;
	}

	renderSuggestion(item: FuzzyMatch<ViewOption>, el: HTMLElement): void {
		const view = item.item;
		el.createEl("div", {
			text: view.name,
			cls: "hydrate-suggestion-title",
		});
		el.createEl("small", {
			text: view.source === "built-in" ? "Built-in view" : "Custom view",
			cls: "hydrate-suggestion-note",
		});
	}

	onChooseItem(view: ViewOption): void {
		this.onSelect(view.name);
	}
}
