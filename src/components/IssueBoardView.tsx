import * as React from "react";
import { useState, useEffect } from "react";
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

const IssueBoardView: React.FC<ReactViewProps> = ({
	filePath,
	markdownContent,
	updateMarkdownContent,
	// app, plugin, switchToMarkdownView // available if needed
}) => {
	// State now holds an array of cards or null
	const [cardsData, setCardsData] = useState<IssueCardData[] | null>(null);
	const [error, setError] = useState<string | null>(null);

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

		// --- Calculate the updated line content ---
		// Read the *current* markdown content directly here to avoid stale state from rapid clicks
		// Although updateMarkdownContent now reads fresh vault data, reading it here too
		// ensures our line modification logic operates on the latest known state.
		// We could potentially optimize later if this becomes a bottleneck.
		const lines = markdownContent.split("\n");

		if (targetItem.lineIndex >= lines.length) {
			console.error(
				"IssueBoardView: Line index out of bounds during status update."
			);
			setError("Error updating status: line index mismatch.");
			return;
		}
		const originalLine = lines[targetItem.lineIndex];
		const checkMark = newCheckedState ? "x" : " ";
		const updatedLine = originalLine.replace(
			/-\s*\[( |x)\]/i,
			`- [${checkMark}]`
		); // Replace checkbox

		if (updatedLine === originalLine) {
			console.warn(
				"IssueBoardView: Status line update did not change the line content. Aborting update."
			);
			setError("Could not update checkbox state in the source markdown.");
			return;
		}
		// --- End calculate updated line content ---

		// Optimistically update local state before saving
		setCardsData((prevCardsData) => {
			if (!prevCardsData) return null; // Should not happen if handler called
			const newCardsData = [...prevCardsData]; // Clone outer array
			const cardToUpdate = { ...newCardsData[cardIndex] }; // Clone target card
			cardToUpdate.status = [...cardToUpdate.status]; // Clone status array
			cardToUpdate.status[statusIndex] = {
				...targetItem,
				checked: newCheckedState,
			}; // Update item
			newCardsData[cardIndex] = cardToUpdate; // Put cloned card back
			return newCardsData;
		});

		// Call the prop to save the specific line change back to the file
		updateMarkdownContent(
			markdownContent,
			targetItem.lineIndex,
			updatedLine
		).catch((err) => {
			console.error(
				"IssueBoardView: Failed to save markdown update:",
				err
			);
			setError("Failed to save changes.");
			// Consider reverting optimistic update on error by re-parsing
			// setCardsData(parseIssueCardMarkdown(markdownContent));
		});
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
			{cardsData.map((card, cardIndex) => (
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
								{card.items.map((item) => (
									<li
										key={item.lineIndex}
										style={styles.listItem}
									>
										{item.text}
									</li>
								))}
							</ul>
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
			))}
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
};

export default IssueBoardView;
