import { App, FuzzySuggestModal, FuzzyMatch } from "obsidian";
import { HydrateView } from "./hydrateView";
import { RegistryEntry } from "../../types";

export class SlashCommandModal extends FuzzySuggestModal<RegistryEntry> {
	private view: HydrateView;
	private onSelect: (entry: RegistryEntry) => void;
	private entries: RegistryEntry[];
	private query: string;

	constructor(
		app: App,
		view: HydrateView,
		entries: RegistryEntry[],
		initialQuery: string = "",
		onSelect: (entry: RegistryEntry) => void
	) {
		super(app);
		this.view = view;
		this.entries = entries;
		this.query = initialQuery;
		this.onSelect = onSelect;
		this.setPlaceholder("Search for a slash command...");

		// Set initial query if provided
		if (initialQuery) {
			// @ts-ignore - accessing private inputEl
			this.inputEl.value = initialQuery;
		}
	}

	getItems(): RegistryEntry[] {
		if (!this.query) {
			return this.entries;
		}

		return this.entries.filter(
			(entry) =>
				entry.slashCommandTrigger
					?.toLowerCase()
					.includes(this.query.toLowerCase()) ||
				entry.description
					?.toLowerCase()
					.includes(this.query.toLowerCase())
		);
	}

	getItemText(entry: RegistryEntry): string {
		return entry.slashCommandTrigger || "";
	}

	renderSuggestion(item: FuzzyMatch<RegistryEntry>, el: HTMLElement): void {
		const entry = item.item;
		const titleEl = el.createEl("div", {
			text: entry.slashCommandTrigger || "",
			cls: "suggestion-title",
		});
		titleEl.style.color = "#000000 !important"; // Force black text

		if (entry.description) {
			const noteEl = el.createEl("small", {
				text: entry.description,
				cls: "suggestion-note",
			});
			noteEl.style.color = "#666666 !important"; // Force gray text
		}
	}

	onChooseItem(entry: RegistryEntry): void {
		this.onSelect(entry);
	}
}
