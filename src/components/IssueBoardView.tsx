import * as React from "react";
import { useState, useEffect, useRef } from "react";
import { ReactViewProps } from "../types";

interface IssueItem {
	text: string;
	lineIndex: number; // Original line index for updating
}

interface StatusItem {
	text: string;
	checked: boolean;
	lineIndex: number; // Original line index for updating
}

interface IssueCardData {
	name: string;
	number: string | null;
	items: IssueItem[];
	status: StatusItem[];
	headerLineIndex: number; // Store the starting line index of the card header
}

// --- Editing State Interface ---
interface EditingItemState {
	cardIndex: number;
	itemIndex: number;
	tempValue: string;
}

// Updated parser for multiple cards
const parseIssueCardMarkdown = (markdownContent: string): IssueCardData[] => {
	console.log("IssueBoardView: Starting parseIssueCardMarkdown (multi-card)");
	const lines = markdownContent.split("\n");
	console.log("IssueBoardView: Parsed lines:", lines);
	const cards: IssueCardData[] = [];
	let currentCard: IssueCardData | null = null;
	let currentSection: "items" | "status" | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]; // Don't trim here, preserve original spacing for indices
		const trimmedLine = line.trim();

		// Start of a new card
		if (trimmedLine.startsWith("## ")) {
			// Save previous card if exists
			if (currentCard) {
				cards.push(currentCard);
			}
			console.log(`IssueBoardView: Found new card header at line ${i}`);
			currentCard = {
				name: trimmedLine.substring(3).trim(),
				number: null,
				items: [],
				status: [],
				headerLineIndex: i,
			};
			currentSection = null; // Reset section for new card
			continue; // Move to next line
		}

		// If we haven't found the first card yet, skip lines
		if (!currentCard) continue;

		// Process lines within the current card
		if (trimmedLine.startsWith("### ISSUE No.")) {
			currentCard.number = trimmedLine.substring(14).trim();
			currentSection = null;
		} else if (trimmedLine.startsWith("### Items")) {
			currentSection = "items";
		} else if (trimmedLine.startsWith("### Status")) {
			currentSection = "status";
		} else if (trimmedLine.startsWith("- ")) {
			const itemText = trimmedLine.substring(2).trim();
			if (currentSection === "items") {
				currentCard.items.push({ text: itemText, lineIndex: i });
			} else if (currentSection === "status") {
				const checkboxMatch = itemText.match(/^\[( |x)\]\s*(.*)/i);
				if (checkboxMatch) {
					currentCard.status.push({
						text: checkboxMatch[2].trim(),
						checked: checkboxMatch[1].toLowerCase() === "x",
						lineIndex: i,
					});
				} else {
					currentCard.status.push({
						text: itemText,
						checked: false,
						lineIndex: i,
					});
				}
			}
		}
	}

	// Push the last card if it exists
	if (currentCard) {
		cards.push(currentCard);
	}

	console.log(
		`IssueBoardView: Parsing finished. Found ${cards.length} cards.`
	);
	return cards;
};

const MAX_VISIBLE_ITEMS = 3; // Threshold for collapsing items

const IssueBoardView: React.FC<ReactViewProps> = ({
	filePath,
	markdownContent,
	updateMarkdownContent,
	// app, plugin, switchToMarkdownView // available if needed
}) => {
	// State now holds an array of cards or null
	const [cardsData, setCardsData] = useState<IssueCardData[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	// --- State for tracking which item is being edited ---
	const [editingItem, setEditingItem] = useState<EditingItemState | null>(
		null
	);
	// --- State for tracking expanded cards ---
	const [isExpanded, setIsExpanded] = useState<{
		[cardIndex: number]: boolean;
	}>({});
	// Ref to track if initial parse is done to avoid auto-expanding on subsequent renders
	const isInitialParseDone = useRef(false);
	// --- Refs for focus management ---
	const itemAddedToCardIndexRef = useRef<{
		cardIndex: number;
		previousItemLineIndex: number;
	} | null>(null);
	// Store refs for each potential input element
	const inputRefs = useRef<{ [lineIndex: number]: HTMLInputElement | null }>(
		{}
	);

	// Parse content when the component mounts or markdownContent changes
	useEffect(() => {
		console.log(
			"IssueBoardView: useEffect - Parsing markdown content for",
			filePath
		);
		setError(null); // Clear previous errors
		try {
			const parsedData = parseIssueCardMarkdown(markdownContent);
			setCardsData(parsedData);

			// Initialize expansion state only after the first successful parse
			if (
				parsedData &&
				parsedData.length > 0 &&
				!isInitialParseDone.current
			) {
				const initialExpansionState: { [cardIndex: number]: boolean } =
					{};
				parsedData.forEach((_, index) => {
					initialExpansionState[index] = false; // Default to collapsed
				});
				setIsExpanded(initialExpansionState);
				isInitialParseDone.current = true;
			}

			if (!parsedData || parsedData.length === 0) {
				// Set error only if content exists but couldn't be parsed into cards
				if (markdownContent.trim().length > 0) {
					setError(
						"Could not parse any issue cards. Ensure the format follows the required structure (each card starts with ## Header)."
					);
				}
			}
		} catch (e) {
			console.error("IssueBoardView: Error parsing markdown:", e);
			setError(
				`Failed to parse markdown: ${
					e instanceof Error ? e.message : String(e)
				}
				}`
			);
			setCardsData(null);
		}
	}, [markdownContent, filePath]); // Re-run if content or file changes

	// --- Effect to handle setting edit state AFTER parsing is complete ---
	useEffect(() => {
		// Check if we just added an item to a specific card
		if (itemAddedToCardIndexRef.current !== null && cardsData) {
			const targetCardIndex = itemAddedToCardIndexRef.current.cardIndex;
			const previousItemLineIndex =
				itemAddedToCardIndexRef.current.previousItemLineIndex;
			console.log(
				`IssueBoardView: useEffect[cardsData] - Attempting to set focus after adding item to card ${targetCardIndex} (after line ${previousItemLineIndex}).`
			);

			const targetCard = cardsData[targetCardIndex];
			let newItem: IssueItem | null = null;
			let newItemIndex = -1;

			// Find the item whose lineIndex is previousItemLineIndex + 1
			if (targetCard) {
				for (let i = 0; i < targetCard.items.length; i++) {
					// Check if this item's line index is the one immediately following the previously edited item
					// This relies on the parser correctly assigning contiguous line numbers after insertion
					if (
						targetCard.items[i].lineIndex ===
						previousItemLineIndex + 1
					) {
						newItem = targetCard.items[i];
						newItemIndex = i;
						break;
					}
				}
			}

			if (newItem && newItemIndex !== -1) {
				console.log(
					`IssueBoardView: Found new item at C:${targetCardIndex} I:${newItemIndex}, Line: ${newItem.lineIndex}`
				);
				setEditingItem({
					cardIndex: targetCardIndex,
					itemIndex: newItemIndex,
					tempValue: newItem.text, // Start editing with its current text ("item")
				});
			} else {
				console.warn(
					`IssueBoardView: Could not find item with line index ${
						previousItemLineIndex + 1
					} in card ${targetCardIndex} after adding.`
				);
			}
			// Always clear the ref after checking
			itemAddedToCardIndexRef.current = null;
		}
	}, [cardsData]); // Run this effect when cardsData state is updated

	// --- Effect to focus the input element when editingItem changes ---
	useEffect(() => {
		if (editingItem && cardsData) {
			const targetCard = cardsData[editingItem.cardIndex];
			const targetItem = targetCard?.items[editingItem.itemIndex];
			if (targetItem) {
				const inputElement = inputRefs.current[targetItem.lineIndex];
				if (inputElement) {
					console.log(
						`IssueBoardView: useEffect[editingItem] - Focusing input for line ${targetItem.lineIndex}`
					);
					inputElement.focus();
					// Select the text if we just added the item
					if (inputElement.value === "item") {
						// Check if it has the default text
						inputElement.select();
						console.log(
							`IssueBoardView: Selected default text in input for line ${targetItem.lineIndex}`
						);
					}
				} else {
					console.warn(
						`IssueBoardView: Input ref not found for line ${targetItem.lineIndex}`
					);
				}
			}
		}
	}, [editingItem, cardsData]); // Rerun when editingItem or cardsData changes

	// Updated handler for status change - needs card index too
	const handleStatusChange = (
		cardIndex: number,
		statusIndex: number,
		newCheckedState: boolean
	) => {
		if (!cardsData || !cardsData[cardIndex]) return;

		const targetCard = cardsData[cardIndex];
		const targetItem = targetCard.status[statusIndex];
		if (!targetItem) return;

		console.log(
			`IssueBoardView: Toggling status for Card ${cardIndex} "${targetCard.name}", Item "${targetItem.text}" (line ${targetItem.lineIndex}) to ${newCheckedState}`
		);

		// --- Calculate the next state BEFORE setting it ---
		let nextCardsData: IssueCardData[] | null = null;
		if (cardsData) {
			// Use current cardsData to calculate next
			const tempNextData = [...cardsData];
			const cardToUpdate = { ...tempNextData[cardIndex] };
			cardToUpdate.status = [...cardToUpdate.status];
			cardToUpdate.status[statusIndex] = {
				...targetItem,
				checked: newCheckedState,
			};
			tempNextData[cardIndex] = cardToUpdate;
			nextCardsData = tempNextData;
		} else {
			// Should not happen if handler is called, but handle defensively
			console.error(
				"IssueBoardView: cardsData is null during status change calculation."
			);
			setError("Internal error processing status change.");
			return;
		}

		// --- Optimistically update local state ---
		setCardsData(nextCardsData);

		// --- Reconstruct Markdown from the CALCULATED next state ---
		let reconstructedLines: string[] = [];
		const originalLinesForPrefix = markdownContent.split("\n"); // Still need original for prefix/spacing
		if (nextCardsData.length > 0 && nextCardsData[0].headerLineIndex > 0) {
			// Use nextCardsData
			reconstructedLines.push(
				...originalLinesForPrefix.slice(
					0,
					nextCardsData[0].headerLineIndex
				)
			); // Use nextCardsData
		}
		nextCardsData.forEach((card, cIndex) => {
			// Use nextCardsData
			reconstructedLines.push(`## ${card.name}`);
			if (card.number) {
				reconstructedLines.push(`### ISSUE No. ${card.number}`);
			}
			if (card.items.length > 0) {
				reconstructedLines.push("### Items");
				card.items.forEach((item) =>
					reconstructedLines.push(`- ${item.text}`)
				);
			}
			if (card.status.length > 0) {
				reconstructedLines.push("### Status");
				card.status.forEach((item) => {
					const check = item.checked ? "x" : " ";
					reconstructedLines.push(`- [${check}] ${item.text}`);
				});
			}
			if (cIndex < nextCardsData.length - 1) {
				// Use nextCardsData
				reconstructedLines.push("");
			}
		});
		const newMarkdownContent = reconstructedLines.join("\n");
		// --- End Reconstruct Markdown ---

		// Save the fully reconstructed content
		// The check if content changed is now implicitly handled by ReactViewHost
		updateMarkdownContent(newMarkdownContent)
			.then((success) => {
				if (success) {
					console.log(
						"IssueBoardView: Status update saved successfully."
					);
				} else {
					setError("Failed to save status changes.");
					// Consider reverting optimistic update here if save fails
				}
			})
			.catch((err) => {
				console.error(
					"IssueBoardView: Unexpected error during status update save:",
					err
				);
				setError("Unexpected error saving status changes.");
			});
	};

	// --- Handlers for Editing Items ---
	const handleItemClick = (
		cardIndex: number,
		itemIndex: number,
		currentItem: IssueItem
	) => {
		// Don't allow editing if another item is already being edited
		if (editingItem) return;
		console.log(
			`IssueBoardView: Start editing item C:${cardIndex} I:${itemIndex} L:${currentItem.lineIndex}`
		);
		setEditingItem({
			cardIndex,
			itemIndex,
			tempValue: currentItem.text,
		});
	};

	const handleItemChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		if (editingItem) {
			setEditingItem({ ...editingItem, tempValue: event.target.value });
		}
	};

	const handleItemSave = (insertNewLine: boolean = false) => {
		if (!editingItem || !cardsData) {
			setEditingItem(null); // Clear editing state if something went wrong
			return;
		}

		const { cardIndex, itemIndex, tempValue } = editingItem;
		const targetCard = cardsData[cardIndex];
		const targetItem = targetCard?.items[itemIndex];

		if (!targetItem) {
			console.error(
				"IssueBoardView: Could not find target item during save."
			);
			setError("Error saving item: target not found.");
			setEditingItem(null);
			return;
		}

		// Only save if the value actually changed
		// If inserting a new line, we always proceed, even if text didn't change.
		if (!insertNewLine && tempValue.trim() === targetItem.text.trim()) {
			console.log(
				"IssueBoardView: Item text unchanged and not inserting new, cancelling save."
			);
			setEditingItem(null); // Clear editing state
			return;
		}

		const newText = tempValue.trim(); // Use trimmed value for saving
		console.log(
			`IssueBoardView: Saving item C:${cardIndex} I:${itemIndex} L:${targetItem.lineIndex} with new text: "${newText}"`
		);

		// --- Prepare Markdown Update ---
		let newFullContent = markdownContent; // Start with original content
		let insertedLineIndex = -1; // Track the index where the new line was inserted

		// Only modify if text changed OR inserting new line
		if (newText !== targetItem.text || insertNewLine) {
			const lines = markdownContent.split("\n");
			if (targetItem.lineIndex >= lines.length) {
				console.error(
					"IssueBoardView: Line index out of bounds during item save."
				);
				setError("Error updating item: line index mismatch.");
				setEditingItem(null);
				return;
			}
			const originalLine = lines[targetItem.lineIndex];
			const lineStartMatch = originalLine.match(/^(\s*-\s*)/);
			const prefix = lineStartMatch ? lineStartMatch[1] : "- ";
			const updatedLine = prefix + newText;

			lines[targetItem.lineIndex] = updatedLine; // Update the current line

			if (insertNewLine) {
				const newLineContent = prefix + "item"; // New line with default text
				insertedLineIndex = targetItem.lineIndex + 1; // Calculate insertion point
				lines.splice(insertedLineIndex, 0, newLineContent);
				console.log(
					`IssueBoardView: Inserting new item line at index ${insertedLineIndex}`
				);
			}
			newFullContent = lines.join("\n"); // Reconstruct the whole content
		}
		// --- End Prepare Markdown Update ---

		// Save if content changed
		if (newFullContent !== markdownContent) {
			console.log(
				`IssueBoardView: Saving updated content (insert: ${insertNewLine})`
			);
			// Store the CARD index to focus *before* calling update
			if (insertNewLine) {
				itemAddedToCardIndexRef.current = {
					cardIndex,
					previousItemLineIndex: targetItem.lineIndex,
				}; // Store card index AND previous item line index
				console.log(
					`IssueBoardView: Set itemAdded ref for card ${cardIndex}, previous line ${targetItem.lineIndex}`
				);
			} else {
				itemAddedToCardIndexRef.current = null; // Clear if not inserting
			}

			// Clear editing state *before* triggering the async save
			setEditingItem(null);

			updateMarkdownContent(newFullContent)
				.then((success) => {
					if (success) {
						console.log(
							"IssueBoardView: Item update saved successfully."
						);
						// Manually re-parse ONLY if inserting new line, to trigger focus effect reliably
						if (insertNewLine) {
							console.log(
								"IssueBoardView: Manual re-parse triggered after adding line."
							);
							try {
								// Use the content we know we just successfully saved
								setCardsData(
									parseIssueCardMarkdown(newFullContent)
								);
							} catch (parseError) {
								console.error(
									"IssueBoardView: Error during manual re-parse:",
									parseError
								);
								setError(
									"Error updating view after adding item."
								);
							}
						}
					} else {
						setError("Failed to save item change.");
						itemAddedToCardIndexRef.current = null; // Clear ref on failed save
					}
				})
				.catch((err) => {
					console.error(
						"IssueBoardView: Unexpected error during item update save:",
						err
					);
					setError("Unexpected error saving item change.");
					itemAddedToCardIndexRef.current = null;
				});
		} else {
			console.log("IssueBoardView: Content identical, skipping save.");
			setEditingItem(null); // Still clear editing state if no save needed
		}
	};

	const handleItemKeyDown = (
		event: React.KeyboardEvent<HTMLInputElement>
	) => {
		if (event.key === "Enter") {
			event.preventDefault(); // Prevent default form submission/newline in input
			handleItemSave(true); // Save current and insert new line
		} else if (event.key === "Escape") {
			console.log("IssueBoardView: Cancelling item edit.");
			setEditingItem(null); // Cancel edit
		}
	};
	// --- End Handlers for Editing Items ---

	// Handler to toggle expansion state for a card
	const toggleExpand = (cardIndex: number) => {
		setIsExpanded((prev) => ({
			...prev,
			[cardIndex]: !prev[cardIndex],
		}));
	};

	if (error) {
		return (
			<div style={styles.container}>
				<h2>Error Loading Issue Board</h2>
				<p style={styles.errorText}>{error}</p>
				<p>File: {filePath}</p>
			</div>
		);
	}

	if (!cardsData) {
		// Loading state
		return (
			<div style={styles.container}>
				<p>Loading issue data...</p>
			</div>
		);
	}

	if (cardsData.length === 0 && markdownContent.trim().length > 0) {
		// Handle case where file has content but no valid cards were parsed
		// This condition might be redundant if the useEffect error handling is sufficient
		return (
			<div style={styles.container}>
				<h2>No Issue Cards Found</h2>
				<p>Could not parse any issue cards from the file content.</p>
				<p>
					Ensure each card starts with a Level 2 Markdown header
					(e.g., `## Card Name`).
				</p>
			</div>
		);
	}

	return (
		<div style={styles.container}>
			{/* Map over the cards array to render each card */}
			{cardsData.map((card, cardIndex) => {
				const needsExpansion = card.items.length > MAX_VISIBLE_ITEMS;
				const isCardExpanded = !!isExpanded[cardIndex]; // Default to false if not set
				const visibleItems =
					needsExpansion && !isCardExpanded
						? card.items.slice(0, MAX_VISIBLE_ITEMS)
						: card.items;

				return (
					<div key={card.headerLineIndex} style={styles.card}>
						<h2 style={styles.cardHeader}>{card.name}</h2>
						{card.number && (
							<div style={styles.issueNumber}>
								ISSUE No. {card.number}
							</div>
						)}
						<div style={styles.columns}>
							{/* Left Column */}
							<div style={styles.column}>
								<h3 style={styles.columnHeader}>Items</h3>
								<ul style={styles.list}>
									{visibleItems.map((item, itemIndex) => {
										const isEditing =
											editingItem?.cardIndex ===
												cardIndex &&
											editingItem?.itemIndex ===
												itemIndex;

										return (
											<li
												key={item.lineIndex}
												style={styles.listItem}
												onClick={() =>
													!isEditing &&
													handleItemClick(
														cardIndex,
														itemIndex,
														item
													)
												}
											>
												{isEditing ? (
													<input
														ref={(el) => {
															// Assign input element to ref based on lineIndex
															inputRefs.current[
																item.lineIndex
															] = el;
														}}
														type="text"
														value={
															editingItem.tempValue
														} // Controlled input
														onChange={
															handleItemChange
														}
														onBlur={() =>
															handleItemSave(
																false
															)
														} // Simple save on blur
														onKeyDown={
															handleItemKeyDown
														} // Save+Add on Enter, Cancel on Escape
														autoFocus // Focus the input when it appears
														style={styles.itemInput}
													/>
												) : (
													item.text || (
														<span
															style={{
																color: "var(--text-faint)",
															}}
														>
															&nbsp;
														</span>
													) // Render non-breaking space for blank items
												)}
											</li>
										);
									})}
								</ul>
								{/* --- Expansion Toggle - Moved AFTER the list --- */}
								{needsExpansion && (
									<div // Using div for block layout below list
										onClick={() => toggleExpand(cardIndex)}
										style={styles.expandToggle}
									>
										{isCardExpanded ? "▼" : "▶"}
										{/* Use carets only */}
									</div>
								)}
							</div>

							{/* Right Column */}
							<div style={styles.column}>
								<h3 style={styles.columnHeader}>Status</h3>
								<ul style={styles.list}>
									{card.status.map((item, statusIndex) => (
										<li
											key={item.lineIndex}
											style={styles.statusItem}
										>
											<label style={styles.checkboxLabel}>
												<input
													type="checkbox"
													checked={item.checked}
													onChange={(e) =>
														handleStatusChange(
															cardIndex, // Pass card index
															statusIndex, // Pass status index
															e.target.checked
														)
													}
													style={styles.checkbox}
												/>
												{item.text}
											</label>
										</li>
									))}
								</ul>
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
};

// Basic inline styles (consider moving to styles.css)
const styles: { [key: string]: React.CSSProperties } = {
	container: {
		padding: "15px",
		height: "100%",
		overflowY: "auto", // Allow scrolling if content overflows
	},
	card: {
		border: "1px solid var(--background-modifier-border)",
		borderRadius: "8px",
		padding: "20px",
		backgroundColor: "var(--background-secondary)",
		marginBottom: "15px", // Add space if multiple cards were supported
	},
	cardHeader: {
		marginTop: "0",
		marginBottom: "5px",
		borderBottom: "1px solid var(--background-modifier-border)",
		paddingBottom: "10px",
	},
	issueNumber: {
		fontSize: "0.9em",
		color: "var(--text-muted)",
		marginBottom: "15px",
	},
	columns: {
		display: "flex",
		flexDirection: "row",
		gap: "20px",
	},
	column: {
		flex: 1, // Each column takes equal space
		minWidth: 0, // Prevent overflow issues with flex items
	},
	columnHeader: {
		fontSize: "1.1em",
		marginTop: "0",
		marginBottom: "10px",
		color: "var(--text-accent)",
	},
	list: {
		listStyle: "none",
		paddingLeft: "5px",
		margin: 0,
	},
	listItem: {
		marginBottom: "5px",
		cursor: "pointer",
		padding: "2px 4px",
		borderRadius: "3px",
	},
	itemInput: {
		width: "100%", // Take full width of list item
		padding: "2px 4px",
		margin: 0,
		border: "1px solid var(--background-modifier-border)",
		borderRadius: "3px",
		backgroundColor: "var(--background-primary)",
		color: "var(--text-normal)",
	},
	statusItem: {
		marginBottom: "8px",
	},
	checkboxLabel: {
		display: "flex",
		alignItems: "center",
		cursor: "pointer",
	},
	checkbox: {
		marginRight: "8px",
		cursor: "pointer",
	},
	errorText: {
		color: "var(--text-error)",
		whiteSpace: "pre-wrap", // Preserve formatting in error messages
	},
	expandToggle: {
		color: "var(--text-muted)",
		cursor: "pointer",
		padding: "4px 0px 0px 5px", // Adjust padding (more top padding?)
		marginTop: "4px", // Space between list and toggle
		fontSize: "0.9em",
		userSelect: "none",
	},
};

export default IssueBoardView;
