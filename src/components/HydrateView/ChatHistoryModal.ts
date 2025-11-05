import { App, FuzzySuggestModal, FuzzyMatch } from "obsidian";
import { ChatHistory } from "../../types";
import { HydrateView } from "./hydrateView";
import { devLog } from "../../utils/logger";
import { ConfirmationModal } from "../../utils/ConfirmationModal";

export class ChatHistoryModal extends FuzzySuggestModal<ChatHistory> {
	private view: HydrateView;
	private onSelect: (chatHistory: ChatHistory) => void;

	constructor(
		app: App,
		view: HydrateView,
		onSelect: (chatHistory: ChatHistory) => void,
	) {
		super(app);
		this.view = view;
		this.onSelect = onSelect;
		this.setPlaceholder("Search for a chat history to load...");
	}

	getItems(): ChatHistory[] {
		return this.view.plugin
			.getChatHistories()
			.sort(
				(a, b) =>
					new Date(b.lastModified).getTime() -
					new Date(a.lastModified).getTime(),
			);
	}

	getItemText(chatHistory: ChatHistory): string {
		return chatHistory.title;
	}

	renderSuggestion(item: FuzzyMatch<ChatHistory>, el: HTMLElement): void {
		const chat = item.item;

		// Create container for the suggestion content
		const contentContainer = el.createEl("div", {
			cls: "hydrate-suggestion-content",
		});

		// Main title
		contentContainer.createEl("div", {
			text: chat.title,
			cls: "hydrate-suggestion-title",
		});

		// Metadata line with date and message count
		const lastModified = new Date(chat.lastModified).toLocaleDateString();
		const messageCount = chat.turns.length;
		const metaText = `${messageCount} message${
			messageCount !== 1 ? "s" : ""
		} • ${lastModified}`;

		contentContainer.createEl("small", {
			text: metaText,
			cls: "hydrate-suggestion-note",
		});

		// Preview of first user message (if exists)
		const firstUserTurn = chat.turns.find((turn) => turn.role === "user");
		if (firstUserTurn) {
			const preview =
				firstUserTurn.content.length > 60
					? firstUserTurn.content.substring(0, 60) + "..."
					: firstUserTurn.content;
			contentContainer.createEl("small", {
				text: preview,
				cls: "hydrate-suggestion-note hydrate-chat-preview",
			});
		}

		// Create delete button
		const deleteButton = el.createEl("button", {
			cls: "hydrate-chat-history-delete-button",
			text: "✕",
			attr: { title: "Delete this chat" },
		});

		// Handle delete button click
		deleteButton.addEventListener("click", (e) => {
			e.stopPropagation(); // Prevent selecting the item
			e.preventDefault();

			// Confirm deletion using custom modal
			new ConfirmationModal(
				this.app,
				`Are you sure you want to delete "${chat.title}"?`,
				() => {
					void (async () => {
						try {
							await this.view.plugin.deleteChatHistory(chat.id);

							// Modal will automatically refresh since getItems() fetches current data
						} catch (error) {
							devLog.error("Error deleting chat history:", error);
						}
					})();
				},
				undefined,
				"Delete",
				"Cancel",
			).open();
		});

		// Apply flexbox layout styling via CSS class
		el.addClass("hydrate-flex-container");
	}

	onChooseItem(chatHistory: ChatHistory): void {
		this.onSelect(chatHistory);
	}
}
