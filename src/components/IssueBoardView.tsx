import * as React from "react";
import { useState, useEffect, useRef } from "react";
import { ReactViewProps } from "../types";

// Markdown Processing Imports
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import { toString } from "mdast-util-to-string";
import { Node, Parent } from "unist"; // Import Node and Parent types
import { Root, Heading, List, ListItem, Text } from "mdast"; // Import specific mdast types

// --- Data Model Interfaces ---
interface IssueItem {
	text: string;
}

interface StatusItem {
	text: string;
	checked: boolean;
}

interface Issue {
	id: string; // Unique ID for React key, based on headerLineIndex
	name: string;
	number: string | null;
	items: IssueItem[];
	status: StatusItem[];
	headerLineIndex: number;
	// Store original line text to preserve formatting/comments during serialization - REMOVED
	// rawLines: { [key: string]: string };
}

// --- Editing State Interface (no changes needed) ---
interface EditingItemState {
	cardIndex: number;
	itemIndex: number;
	tempValue: string;
}

// --- Robust Parser using remark, remark-frontmatter, and remark-gfm ---
const parseIssueMarkdown = (
	markdownContent: string
): { issues: Issue[]; parsingErrors: string[] } => {
	const issues: Issue[] = [];
	const parsingErrors: string[] = [];
	try {
		// Add remarkGfm to the pipeline
		const tree = unified()
			.use(remarkParse)
			.use(remarkFrontmatter, ["yaml"]) // Specify YAML variant
			.use(remarkGfm) // Add GFM plugin
			.parse(markdownContent) as Root;

		let currentCardData: Partial<Issue> | null = null;
		let siblingsBetweenH2: Node[] = []; // Store nodes between H2 headings

		// Process children, skipping the frontmatter node
		const contentNodes =
			tree.children?.filter((node) => node.type !== "yaml") || [];

		// Add a dummy end node to process the last card
		const nodesToProcess = [
			...contentNodes,
			{
				type: "thematicBreak",
				position: { start: { line: Infinity } },
			} as Node,
		];

		nodesToProcess.forEach((node, nodeIndex) => {
			// Trigger processing for the previous card if we hit an H2 OR the dummy end node
			if (
				(node.type === "heading" && (node as Heading).depth === 2) ||
				node.type === "thematicBreak"
			) {
				// --- Process the PREVIOUS card based on collected siblings ---
				if (currentCardData) {
					// Make sure siblings were collected before processing
					if (siblingsBetweenH2.length > 0) {
						processCardSiblings(
							siblingsBetweenH2,
							currentCardData,
							parsingErrors
						);
					} else {
					}

					// Log state before validation

					// Final validation before pushing - RELAXED CHECK
					// Check if the sections were *found* (arrays initialized), not necessarily non-empty
					if (
						currentCardData.items !== undefined &&
						currentCardData.status !== undefined
					) {
						issues.push(currentCardData as Issue);
					} else {
						const cardName =
							currentCardData.name || "[Unknown Name]";
						const cardLine =
							currentCardData.headerLineIndex !== undefined
								? currentCardData.headerLineIndex + 1
								: "[Unknown Line]";
						// Refine error message based on what's missing
						let missing = [];
						if (currentCardData.items === undefined)
							missing.push("### Items section"); // Check for undefined specifically
						if (currentCardData.status === undefined)
							missing.push("### Status section"); // Check for undefined specifically
						const errorMsg = `Skipped card starting on line ${cardLine} ("${cardName}"): Missing required sections (${missing.join(
							" & "
						)}). Ensure '### Items' and '### Status' headings exist.`;
						console.warn(`IssueBoardView Parser: ${errorMsg}`);
						parsingErrors.push(errorMsg);
					}
				}

				// --- Start NEW card (Only if it was an H2, not the dummy node) ---
				if (node.type === "heading") {
					// Check if it's actually the H2
					siblingsBetweenH2 = []; // Reset siblings for the new card
					const headingNode = node as Heading;
					currentCardData = {
						id: `card-${
							headingNode.position?.start?.line ?? Math.random()
						}`,
						name: toString(headingNode).trim(),
						number: null,
						items: [],
						status: [],
						headerLineIndex: headingNode.position?.start?.line
							? headingNode.position.start.line - 1
							: -1,
					};

					// ---> NEW: Check next sibling for issue number list
					const nextNode = contentNodes[nodeIndex + 1]; // Look ahead in the original content nodes
					if (
						nextNode &&
						nextNode.type === "list" &&
						(nextNode as List).children.length > 0
					) {
						const firstNumberListItem = (nextNode as List)
							.children[0] as ListItem;
						if (firstNumberListItem) {
							const issueNumberText =
								toString(firstNumberListItem).trim();
							// Basic check if it looks like an ID (optional)
							if (issueNumberText) {
								currentCardData.number = issueNumberText;
								// Mark this list node as processed so it's not collected as a sibling
								// (Requires adjusting sibling collection logic slightly)
								// OR, easier: just remove it from siblings later in processCardSiblings
							}
						}
					}
					// <--- END NEW
				} else {
					// If it was the dummy node, ensure we stop processing by clearing currentCardData
					currentCardData = null;
				}
			} else if (currentCardData) {
				// Collect siblings ONLY if we are inside a card
				// Do not collect the dummy node itself
				if (node.type !== "thematicBreak") {
					siblingsBetweenH2.push(node);
				}
			}
		});
	} catch (e) {
		console.error(
			"IssueBoardView: Error during Markdown parsing with remark:",
			e
		);
		parsingErrors.push(
			`Critical Markdown parsing error: ${
				e instanceof Error ? e.message : String(e)
			}`
		);
	}

	return { issues, parsingErrors };
};

// Helper function to process nodes between H2 headings
const processCardSiblings = (
	siblings: Node[],
	cardData: Partial<Issue>,
	parsingErrors: string[]
) => {
	// ---> NEW: Filter out the first list if it was the issue number list
	let processableSiblings = siblings;
	if (
		cardData.number && // If we found a number earlier
		siblings.length > 0 &&
		siblings[0].type === "list"
	) {
		// Check if the first item of this list matches the stored number
		const firstList = siblings[0] as List;
		if (firstList.children.length > 0) {
			const firstItemText = toString(firstList.children[0]).trim();
			if (firstItemText === cardData.number) {
				processableSiblings = siblings.slice(1); // Skip the first list node
			}
		}
	}
	// <--- END NEW

	// Iterate through siblings to find H3 sections and their subsequent lists
	// Use processableSiblings instead of siblings from now on
	for (let i = 0; i < processableSiblings.length; i++) {
		const node = processableSiblings[i];

		// Look for Level 3 Headings
		if (node.type === "heading" && (node as Heading).depth === 3) {
			const headingNode = node as Heading;
			const headingText = toString(headingNode).trim();
			let sectionType: "items" | "status" | null = null; // Removed 'issueNo'
			let targetArray: IssueItem[] | StatusItem[] | null = null;

			// Identify the type of section
			if (headingText === "Items") {
				sectionType = "items";
				cardData.items = cardData.items || []; // Ensure array exists
				targetArray = cardData.items;
			} else if (headingText === "Status") {
				sectionType = "status";
				cardData.status = cardData.status || []; // Ensure array exists
				targetArray = cardData.status;
			} else {
				// Ignore other H3 headings
				continue;
			}

			// If it's an "Items" or "Status" heading, check the *next* sibling for a list
			if (
				(sectionType === "items" || sectionType === "status") &&
				targetArray
			) {
				const nextNodeIndex = i + 1;
				if (
					nextNodeIndex < processableSiblings.length &&
					processableSiblings[nextNodeIndex].type === "list"
				) {
					const listNode = processableSiblings[nextNodeIndex] as List;

					visit(listNode, "listItem", (listItem: ListItem) => {
						let textContent = ""; // Initialize text content

						if (sectionType === "items") {
							// For regular items, just use toString on the listItem itself
							(targetArray as IssueItem[]).push({
								text: toString(listItem).trim(),
							});
						} else if (sectionType === "status") {
							// *** STRICT CHECK: Only process if it IS a GFM task list item ***
							if (typeof listItem.checked === "boolean") {
								// Find the paragraph child within the list item (standard for GFM tasks)
								const paragraphChild = listItem.children?.find(
									(child) => child.type === "paragraph"
								) as Parent | undefined;

								if (paragraphChild) {
									// Extract text from the paragraph node
									textContent =
										toString(paragraphChild).trim();
								} else {
									// Fallback if no paragraph found (structure might be unexpected)
									console.warn(
										"IssueBoardView processCardSiblings: Status List item did not contain expected paragraph child. Falling back to toString(listItem).",
										listItem
									);
									textContent = toString(listItem).trim();
								}
								const isChecked = listItem.checked; // Already know it's boolean here
								(targetArray as StatusItem[]).push({
									text: textContent,
									checked: isChecked,
								});
							}
						}
					});

					// IMPORTANT: Skip the next node (the list) since we've processed it
					i++;
				} else {
					// Log a warning if the expected list is missing
					const nextNodeType =
						nextNodeIndex < processableSiblings.length
							? processableSiblings[nextNodeIndex].type
							: "end of card";
					console.warn(
						`IssueBoardView Parser: Expected list after '${headingText}' heading, but found ${nextNodeType}.`
					);
					// Optionally add to parsingErrors if this should invalidate the card section
					// parsingErrors.push(`Card "${cardData.name}": Expected list after '${headingText}' heading.`);
				}
			}
		}
		// Ignore other node types (like paragraphs, thematic breaks, etc.) between sections
	}
};

// --- Markdown Serializer ---
const serializeIssuesToMarkdown = (issues: Issue[]): string => {
	let lines: string[] = [];
	// Regenerates markdown purely from the structured data model.

	issues.forEach((issue, index) => {
		lines.push(`## ${issue.name}`); // Always regenerate header
		if (issue.number) {
			lines.push(`- ${issue.number}`);
		}
		if (issue.items.length > 0) {
			lines.push("### Items"); // Always regenerate
			issue.items.forEach((item) => {
				lines.push(`- ${item.text}`); // Regenerate from data
			});
		}
		if (issue.status.length > 0) {
			lines.push("### Status"); // Always regenerate
			issue.status.forEach((item) => {
				const check = item.checked ? "x" : " ";
				lines.push(`- [${check}] ${item.text}`); // Regenerate from data
			});
		}
		if (index < issues.length - 1) {
			lines.push(""); // Add spacing between issues
		}
	});

	// Note: Still needs integration with frontmatter/pre-issue content preservation
	// which happens in the handleUpdate function.
	return lines.join("\n");
};

const MAX_VISIBLE_ITEMS = 3; // Threshold for collapsing items

const IssueBoardView: React.FC<ReactViewProps> = ({
	filePath,
	markdownContent,
	updateMarkdownContent,
	// app, plugin, switchToMarkdownView // available if needed
}) => {
	// State holds the array of successfully parsed issues
	const [issues, setIssues] = useState<Issue[]>([]);
	const [parsingErrors, setParsingErrors] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null); // For general errors
	const [editingItem, setEditingItem] = useState<EditingItemState | null>(
		null
	);
	const [isExpanded, setIsExpanded] = useState<{
		[issueId: string]: boolean;
	}>({});
	const isInitialParseDone = useRef(false);
	const inputRefs = useRef<{
		[issueId: string]: { [itemIndex: number]: HTMLInputElement | null };
	}>({});
	const newItemFocusRef = useRef<{
		issueId: string;
		itemIndex: number;
	} | null>(null);

	// --- Effect for Parsing ---
	useEffect(() => {
		setError(null);
		setParsingErrors([]);
		try {
			const { issues: parsedIssues, parsingErrors: pErrors } =
				parseIssueMarkdown(markdownContent);
			setIssues(parsedIssues);
			setParsingErrors(pErrors);

			// Initialize expansion state
			if (parsedIssues.length > 0 && !isInitialParseDone.current) {
				const initialExpansionState: { [issueId: string]: boolean } =
					{};
				parsedIssues.forEach((issue) => {
					initialExpansionState[issue.id] = false; // Default collapsed
				});
				setIsExpanded(initialExpansionState);
				isInitialParseDone.current = true;
			}
		} catch (e) {
			console.error("IssueBoardView: Critical error during parsing:", e);
			setError(
				`Failed to parse markdown: ${
					e instanceof Error ? e.message : String(e)
				}`
			);
			setIssues([]); // Clear issues on critical error
			setParsingErrors([
				`A critical error occurred during parsing: ${
					e instanceof Error ? e.message : String(e)
				}`,
			]);
		}
	}, [markdownContent]); // Only depends on markdownContent now

	// --- Effect to Focus New Item ---
	useEffect(() => {
		if (newItemFocusRef.current && issues.length > 0) {
			const { issueId, itemIndex } = newItemFocusRef.current;
			const inputElement = inputRefs.current[issueId]?.[itemIndex];
			if (inputElement) {
				inputElement.focus();
				if (inputElement.value === "item") {
					inputElement.select();
				}
			} else {
				console.warn(
					`IssueBoardView: Input ref not found for new item: issue ${issueId}, item ${itemIndex}`
				);
			}
			newItemFocusRef.current = null; // Clear the ref
		}
	}, [issues]); // Run when issues state updates (after re-parse)

	// --- Effect to Focus Existing Item ---
	useEffect(() => {
		if (editingItem && issues.length > 0) {
			const targetIssue = issues[editingItem.cardIndex]; // Assuming cardIndex maps correctly
			if (targetIssue) {
				const inputElement =
					inputRefs.current[targetIssue.id]?.[editingItem.itemIndex];
				if (inputElement) {
					inputElement.focus();
				} else {
					console.warn(
						`IssueBoardView: Input ref not found for existing item: issue ${targetIssue.id}, item ${editingItem.itemIndex}`
					);
				}
			}
		}
	}, [editingItem]); // Run when editingItem changes

	// --- Event Handlers ---

	const handleUpdate = (updatedIssues: Issue[]) => {
		// Serialize the updated data model back to Markdown
		const lines = markdownContent.split("\n");

		// --- Preserve Frontmatter and Pre-Issue Content ---
		// ASSUMPTION: This view only renders if valid frontmatter exists.
		let frontmatter = "";
		let preIssueContent = "";
		let firstIssueStartIndex = lines.length; // Default to end if no issues

		// Find frontmatter end (starts at line 0, find next '---')
		const fmEndIndex = lines.findIndex(
			(line, index) => index > 0 && line.trim() === "---"
		);

		if (fmEndIndex === -1) {
			// This should ideally not happen if the view switching logic is correct.
			console.error(
				"IssueBoardView: Could not find closing frontmatter fence ('---')! Saving might corrupt the file."
			);
			setError(
				"Error: Could not find end of frontmatter. Cannot safely save."
			);
			return; // Abort save
		}

		// Extract frontmatter (including the fences)
		frontmatter = lines.slice(0, fmEndIndex + 1).join("\n");

		// Find start of the first *parsed* issue
		if (updatedIssues.length > 0) {
			// Ensure the headerLineIndex is valid and after the frontmatter
			if (updatedIssues[0].headerLineIndex > fmEndIndex) {
				firstIssueStartIndex = updatedIssues[0].headerLineIndex;
			} else {
				// Fallback if first issue header index seems invalid relative to frontmatter (parser issue?)
				console.warn(
					"IssueBoardView: First issue header index seems invalid relative to frontmatter. Defaulting content start after frontmatter."
				);
				firstIssueStartIndex = fmEndIndex + 1;
			}
		} else {
			// No issues parsed, start content after frontmatter
			firstIssueStartIndex = fmEndIndex + 1;
		}

		// Extract content *between* frontmatter and first issue
		preIssueContent = lines
			.slice(fmEndIndex + 1, firstIssueStartIndex)
			.join("\n");

		// --- Combine preserved content with serialized issues ---
		const serializedIssues = serializeIssuesToMarkdown(updatedIssues);

		let newMarkdown = frontmatter;
		// Add pre-issue content if it exists
		if (preIssueContent.trim()) {
			newMarkdown += "\n" + preIssueContent;
		}

		// Add issues, ensuring appropriate spacing
		if (serializedIssues) {
			if (!newMarkdown.endsWith("\n\n")) {
				newMarkdown += newMarkdown.endsWith("\n") ? "\n" : "\n\n";
			}
			newMarkdown += serializedIssues;
		} else {
			// Ensure at least one newline after frontmatter/pre-content if no issues exist
			if (!newMarkdown.endsWith("\n")) {
				newMarkdown += "\n";
			}
		}

		// Update the state optimistically FIRST
		setIssues(updatedIssues); // Update with the array used for serialization

		// Call the prop to save the full content
		updateMarkdownContent(newMarkdown).catch((err) => {
			console.error(
				"IssueBoardView: Failed to save markdown update:",
				err
			);
			setError("Failed to save changes. Content may be out of sync.");
			// Consider adding a 'force reload/re-parse' button or logic here
		});
	};

	const handleStatusChange = (
		issueIndex: number,
		statusIndex: number,
		newCheckedState: boolean
	) => {
		setError(null); // Clear general errors on interaction
		const newIssues = issues.map((issue, idx) => {
			if (idx === issueIndex) {
				const newStatus = issue.status.map((item, sIdx) => {
					if (sIdx === statusIndex) {
						return { ...item, checked: newCheckedState };
					}
					return item;
				});
				return { ...issue, status: newStatus };
			}
			return issue;
		});
		handleUpdate(newIssues);
	};

	const handleItemClick = (issueIndex: number, itemIndex: number) => {
		if (editingItem) return; // Prevent multiple edits
		setError(null);
		const issue = issues[issueIndex];
		const item = issue?.items[itemIndex];
		if (item) {
			setEditingItem({
				cardIndex: issueIndex,
				itemIndex: itemIndex,
				tempValue: item.text,
			});
		}
	};

	const handleItemChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		if (editingItem) {
			setEditingItem({ ...editingItem, tempValue: event.target.value });
		}
	};

	const handleItemSave = (insertNewLine: boolean = false) => {
		if (!editingItem) return;
		setError(null);
		const { cardIndex, itemIndex, tempValue } = editingItem;
		const newText = tempValue.trim();
		let addFocusRequest: { issueId: string; itemIndex: number } | null =
			null;

		const newIssues = issues.map((issue, idx) => {
			if (idx === cardIndex) {
				const newItems = issue.items.map((item, iIdx) => {
					if (iIdx === itemIndex) {
						return { ...item, text: newText }; // Update text
					}
					return item;
				});
				// Insert new item if requested
				if (insertNewLine) {
					const newItem: IssueItem = { text: "item" }; // Default text
					const insertAtIndex = itemIndex + 1;
					newItems.splice(insertAtIndex, 0, newItem);
					addFocusRequest = {
						issueId: issue.id,
						itemIndex: insertAtIndex,
					}; // Request focus for the new item
				}
				return { ...issue, items: newItems };
			}
			return issue;
		});

		// Set focus request *before* updating state/saving
		newItemFocusRef.current = addFocusRequest;
		setEditingItem(null); // Clear editing state FIRST
		handleUpdate(newIssues); // Update state and trigger save
	};

	const handleItemKeyDown = (
		event: React.KeyboardEvent<HTMLInputElement>
	) => {
		if (event.key === "Enter") {
			event.preventDefault();
			handleItemSave(true);
		} else if (event.key === "Escape") {
			setEditingItem(null);
		}
	};

	const toggleExpand = (issueId: string) => {
		setIsExpanded((prev) => ({ ...prev, [issueId]: !prev[issueId] }));
	};

	// --- Render Logic ---
	if (error) {
		return (
			<div style={styles.container}>
				<h2>Error Loading Issue Board</h2>
				<p style={styles.errorText}>{error}</p>
				<p>File: {filePath}</p>
				{parsingErrors.length > 0 && (
					<div>
						<h4>Parsing Issues:</h4>
						<ul
							style={{
								fontSize: "0.9em",
								color: "var(--text-muted)",
							}}
						>
							{parsingErrors.map((err, i) => (
								<li key={i}>{err}</li>
							))}
						</ul>
					</div>
				)}
			</div>
		);
	}

	if (!issues) {
		// Check for null issues state (initial load)
		return (
			<div style={styles.container}>
				<p>Loading issue data...</p>
			</div>
		);
	}

	if (
		issues.length === 0 &&
		parsingErrors.length === 0 &&
		markdownContent.trim().length > 0
	) {
		// File has content, but nothing parsed as a valid issue
		return (
			<div style={styles.container}>
				<h2>No Issue Cards Found</h2>
				<p>Could not parse any issue cards from the file content.</p>
				<p>
					Ensure each card starts with a Level 2 Markdown header
					(e.g., `## Card Name`) and contains `### Items` and `###
					Status` sections.
				</p>
			</div>
		);
	}

	return (
		<div style={styles.container}>
			{/* Display any parsing errors at the top */}
			{parsingErrors.length > 0 && (
				<div style={styles.parsingErrorBox}>
					<h4>Note Parsing Issues Found:</h4>
					<ul
						style={{
							fontSize: "0.9em",
							color: "var(--text-muted)",
						}}
					>
						{parsingErrors.map((err, i) => (
							<li key={i}>{err}</li>
						))}
					</ul>
				</div>
			)}

			{/* Render successfully parsed issues */}
			{issues.map((issue, issueIndex) => {
				const needsExpansion = issue.items.length > MAX_VISIBLE_ITEMS;
				const isCardExpanded = !!isExpanded[issue.id];
				const visibleItems =
					needsExpansion && !isCardExpanded
						? issue.items.slice(0, MAX_VISIBLE_ITEMS)
						: issue.items;

				// Ensure inputRefs has an entry for this issue
				if (!inputRefs.current[issue.id]) {
					inputRefs.current[issue.id] = {};
				}

				return (
					<div key={issue.id} style={styles.card}>
						<h2 style={styles.cardHeader}>{issue.name}</h2>
						{/* ---> NEW: Display issue number simply if it exists */}
						{issue.number && (
							<div style={styles.issueNumberDisplay}>
								{issue.number}
							</div>
						)}
						{/* <--- END NEW */}
						<div style={styles.columns}>
							{/* Left Column - Items */}
							<div style={styles.column}>
								<h3 style={styles.columnHeader}>Items</h3>
								<ul style={styles.list}>
									{visibleItems.map((item, itemIndex) => {
										const isEditing =
											editingItem?.cardIndex ===
												issueIndex &&
											editingItem?.itemIndex ===
												itemIndex;

										return (
											<li
												key={`${issue.id}-item-${itemIndex}`} // Use composite key
												style={styles.listItem}
												onClick={() =>
													!isEditing &&
													handleItemClick(
														issueIndex,
														itemIndex
													)
												}
											>
												{isEditing ? (
													<input
														ref={(el) => {
															// Assign input element ref using issue.id and itemIndex
															if (
																inputRefs
																	.current[
																	issue.id
																]
															) {
																inputRefs.current[
																	issue.id
																][itemIndex] =
																	el;
															}
														}}
														type="text"
														value={
															editingItem.tempValue
														}
														onChange={
															handleItemChange
														}
														onBlur={() =>
															handleItemSave(
																false
															)
														}
														onKeyDown={
															handleItemKeyDown
														}
														autoFocus
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
													)
												)}
											</li>
										);
									})}
								</ul>
								{/* Expansion Toggle */}
								{needsExpansion && (
									<div
										onClick={() => toggleExpand(issue.id)}
										style={styles.expandToggle}
									>
										{isCardExpanded ? "▼" : "▶"}
									</div>
								)}
							</div>

							{/* Right Column - Status */}
							<div style={styles.column}>
								<h3 style={styles.columnHeader}>Status</h3>
								<ul style={styles.list}>
									{issue.status.map((item, statusIndex) => (
										<li
											key={`${issue.id}-status-${statusIndex}`}
											style={styles.statusItem}
										>
											<label style={styles.checkboxLabel}>
												<input
													type="checkbox"
													checked={item.checked}
													onChange={(e) =>
														handleStatusChange(
															issueIndex,
															statusIndex,
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
	issueNumberDisplay: {
		fontSize: "0.9em",
		color: "var(--text-muted)",
		marginBottom: "15px",
		paddingLeft: "5px",
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
	parsingErrorBox: {
		border: "1px solid var(--background-modifier-error-border)",
		backgroundColor: "var(--background-modifier-error)",
		color: "var(--text-error)",
		padding: "10px 15px",
		borderRadius: "5px",
		marginBottom: "15px",
	},
};

export default IssueBoardView;
