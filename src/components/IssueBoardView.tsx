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
	headerLineIndex: number; // Line index of the H2 heading
	// rawLines: { [key: string]: string }; // Removed
}

// NEW: Group Interface
interface Group {
	id: string; // Unique ID for React key
	name: string; // From H1 heading text, or "Uncategorized"
	issues: Issue[]; // Cards belonging to this group
	headerLineIndex: number; // Line index of the H1 heading (-1 for default group)
}

// --- Editing State Interface (needs groupIndex) ---
interface EditingItemState {
	groupIndex: number; // NEW
	cardIndex: number;
	itemIndex: number;
	tempValue: string;
}

// --- Robust Parser using remark, remark-frontmatter, and remark-gfm ---
const parseIssueMarkdown = (
	markdownContent: string
): { groups: Group[]; parsingErrors: string[] } => {
	// Return groups instead of issues
	const groups: Group[] = [];
	const parsingErrors: string[] = [];
	let currentGroup: Group | null = null; // Track current H1 group
	let defaultGroupCreated = false; // Flag if default group was made

	try {
		const tree = unified()
			.use(remarkParse)
			.use(remarkFrontmatter, ["yaml"])
			.use(remarkGfm)
			.parse(markdownContent) as Root;

		let currentCardData: Partial<Issue> | null = null;
		let siblingsBetweenHeadings: Node[] = []; // Store nodes between H1/H2

		const contentNodes =
			tree.children?.filter((node) => node.type !== "yaml") || [];

		const nodesToProcess = [
			...contentNodes,
			{
				type: "thematicBreak", // Use thematic break as dummy end node
				position: { start: { line: Infinity } },
			} as Node,
		];

		nodesToProcess.forEach((node, nodeIndex) => {
			const isH1 =
				node.type === "heading" && (node as Heading).depth === 1;
			const isH2 =
				node.type === "heading" && (node as Heading).depth === 2;
			const isDummyEnd = node.type === "thematicBreak"; // Check for dummy explicitly

			// --- Trigger processing for the PREVIOUS card if we hit H1, H2, or dummy end ---
			if (isH1 || isH2 || isDummyEnd) {
				if (currentCardData) {
					// Process siblings collected for the card
					if (siblingsBetweenHeadings.length > 0) {
						processCardSiblings(
							siblingsBetweenHeadings,
							currentCardData,
							parsingErrors
						);
					}

					// Validate and push the completed card to the correct group
					if (
						currentCardData.items !== undefined &&
						currentCardData.status !== undefined &&
						currentCardData.name // Ensure name exists
					) {
						// Ensure currentGroup exists (create default if needed)
						if (!currentGroup) {
							if (!defaultGroupCreated) {
								currentGroup = {
									id: `group-default-${Date.now()}`,
									name: "Uncategorized", // Default name
									issues: [],
									headerLineIndex: -1, // Indicate no H1
								};
								groups.push(currentGroup);
								defaultGroupCreated = true; // Mark as created
							} else {
								// Find the existing default group if it was already added
								currentGroup =
									groups.find(
										(g) => g.headerLineIndex === -1
									) || null;
								if (!currentGroup) {
									// This case should be rare, indicates a logic issue
									console.error(
										"IssueBoardView Parser: Could not find existing default group!"
									);
									parsingErrors.push(
										"Internal error: Could not assign card to default group."
									);
									currentCardData = null; // Skip this card
									siblingsBetweenHeadings = [];
									return; // Move to next node
								}
							}
						}
						currentGroup.issues.push(currentCardData as Issue);
					} else {
						// Handle incomplete card data (same logic as before)
						const cardName =
							currentCardData.name || "[Unknown Name]";
						const cardLine =
							currentCardData.headerLineIndex !== undefined
								? currentCardData.headerLineIndex + 1
								: "[Unknown Line]";
						let missing = [];
						if (currentCardData.items === undefined)
							missing.push("### Items");
						if (currentCardData.status === undefined)
							missing.push("### Status");
						if (!currentCardData.name) missing.push("H2 Name");

						const errorMsg = `Skipped card starting near line ${cardLine} ("${cardName}"): Missing required sections (${missing.join(
							" & "
						)}). Ensure H2 name, '### Items', and '### Status' exist.`;
						console.warn(`IssueBoardView Parser: ${errorMsg}`);
						parsingErrors.push(errorMsg);
					}
					// Reset card data and siblings after processing
					currentCardData = null;
					siblingsBetweenHeadings = [];
				}
			}

			// --- Handle New Group (H1) ---
			if (isH1) {
				const headingNode = node as Heading;
				const groupName = toString(headingNode).trim();
				const groupLine = headingNode.position?.start?.line
					? headingNode.position.start.line - 1
					: -1;
				currentGroup = {
					id: `group-${groupLine}-${Date.now()}`, // Include line for uniqueness
					name: groupName,
					issues: [],
					headerLineIndex: groupLine,
				};
				groups.push(currentGroup);
				defaultGroupCreated = groups.some(
					(g) => g.headerLineIndex === -1
				); // Update flag if default exists
				currentCardData = null; // Reset card data when starting a new group
				siblingsBetweenHeadings = []; // Reset siblings
			}
			// --- Handle New Card (H2) ---
			else if (isH2) {
				// currentCardData should have been processed and reset by the block above
				if (currentCardData) {
					console.warn(
						"IssueBoardView Parser: Starting new H2 while previous card data was still present. Potential loss of siblings."
					);
					// Optionally process the lingering card here if needed, though it might indicate a logic flaw.
				}

				const headingNode = node as Heading;
				const cardName = toString(headingNode).trim();
				const cardLine = headingNode.position?.start?.line
					? headingNode.position.start.line - 1
					: -1;

				currentCardData = {
					id: `card-${cardLine}-${Date.now()}`,
					name: cardName,
					number: null, // Will be populated by sibling check
					items: [], // Initialize as empty
					status: [], // Initialize as empty
					headerLineIndex: cardLine,
				};
				siblingsBetweenHeadings = []; // Reset siblings for the new card

				// Check next sibling for issue number list (like before)
				const nextNodeIndex =
					contentNodes.findIndex((n) => n === node) + 1; // Find index in ORIGINAL nodes
				if (nextNodeIndex > 0 && nextNodeIndex < contentNodes.length) {
					const nextNode = contentNodes[nextNodeIndex];
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
							if (issueNumberText) {
								currentCardData.number = issueNumberText;
								// We'll filter this list node out in processCardSiblings
							}
						}
					}
				}
			}
			// --- Collect Siblings ---
			// Collect nodes only if we are between headings (or after last heading before dummy end)
			// Avoid collecting the dummy node itself.
			else if (!isDummyEnd && (currentCardData || currentGroup)) {
				// Only collect if inside a group or card context
				siblingsBetweenHeadings.push(node);
			}
			// --- Handle Dummy End ---
			else if (isDummyEnd) {
				// Processing of the last card/group happens via the check at the top
				currentGroup = null; // Ensure we stop processing
				currentCardData = null;
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

	// Final cleanup: Remove empty groups if any were created but had no valid issues
	const finalGroups = groups.filter(
		(g) => g.issues.length > 0 || g.name !== "Uncategorized"
	); // Keep named H1 groups even if empty? Maybe filter later.

	return { groups: finalGroups, parsingErrors };
};

// Helper function to process nodes between H2 headings (logic largely unchanged)
// This processes the siblings *for a specific card*
const processCardSiblings = (
	siblings: Node[],
	cardData: Partial<Issue>,
	parsingErrors: string[]
) => {
	// ---> Filter out the first list if it was the issue number list
	let processableSiblings = siblings;
	if (
		cardData.number && // If we found a number earlier
		siblings.length > 0 &&
		siblings[0].type === "list"
	) {
		const firstList = siblings[0] as List;
		if (firstList.children.length > 0) {
			const firstItemText = toString(firstList.children[0]).trim();
			if (firstItemText === cardData.number) {
				processableSiblings = siblings.slice(1); // Skip the first list node
			}
		}
	}
	// <--- END NEW

	// Iterate through processableSiblings to find H3 sections and their subsequent lists
	for (let i = 0; i < processableSiblings.length; i++) {
		const node = processableSiblings[i];

		if (node.type === "heading" && (node as Heading).depth === 3) {
			const headingNode = node as Heading;
			const headingText = toString(headingNode).trim();
			let sectionType: "items" | "status" | null = null;
			let targetArray: IssueItem[] | StatusItem[] | null = null;

			if (headingText === "Items") {
				sectionType = "items";
				cardData.items = cardData.items || []; // Ensure array exists
				targetArray = cardData.items;
			} else if (headingText === "Status") {
				sectionType = "status";
				cardData.status = cardData.status || []; // Ensure array exists
				targetArray = cardData.status;
			} else {
				continue; // Ignore other H3s
			}

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
						// GFM Task List Item Check (for status)
						const isTaskList =
							typeof listItem.checked === "boolean";

						if (sectionType === "items") {
							(targetArray as IssueItem[]).push({
								text: toString(listItem).trim(),
							});
						} else if (sectionType === "status" && isTaskList) {
							const paragraphChild = listItem.children?.find(
								(child) => child.type === "paragraph"
							) as Parent | undefined;
							const textContent = paragraphChild
								? toString(paragraphChild).trim()
								: toString(listItem).trim(); // Fallback

							(targetArray as StatusItem[]).push({
								text: textContent,
								checked: listItem.checked ?? false, // Use the checked value
							});
						} else if (sectionType === "status" && !isTaskList) {
							// Warn if a non-task item is under ### Status
							parsingErrors.push(
								`Card "${
									cardData.name || "Unknown"
								}": Non-task list item found under '### Status' section near line ${
									listItem.position?.start?.line || "?"
								}. It will be ignored.`
							);
							console.warn(
								`IssueBoardView Parser: Non-task list item under ### Status`,
								listItem
							);
						}
					});
					i++; // Skip the list node
				} else {
					const cardName = cardData.name || "[Unknown Name]";
					const nextNodeType =
						nextNodeIndex < processableSiblings.length
							? processableSiblings[nextNodeIndex].type
							: "end of card";
					parsingErrors.push(
						`Card "${cardName}": Expected list after '${headingText}' heading, but found ${nextNodeType}. Section ignored.`
					);
					console.warn(
						`IssueBoardView Parser: Expected list after '${headingText}' heading for card "${cardName}", but found ${nextNodeType}.`
					);
				}
			}
		}
	}
};

// --- Markdown Serializer ---
const serializeIssuesToMarkdown = (groups: Group[]): string => {
	// Accept groups
	let lines: string[] = [];

	groups.forEach((group, groupIndex) => {
		// Add H1 only if it's not the default "Uncategorized" group *or* if it's the only group
		if (group.headerLineIndex !== -1 || groups.length === 1) {
			// Don't add H1 for default group if there are other named groups
			if (!(group.headerLineIndex === -1 && groups.length > 1)) {
				lines.push(`# ${group.name}`);
				lines.push(""); // Add space after H1
			}
		}

		group.issues.forEach((issue, issueIndex) => {
			lines.push(`## ${issue.name}`);
			if (issue.number) {
				lines.push(`- ${issue.number}`);
			}
			if (issue.items.length > 0) {
				lines.push("### Items");
				issue.items.forEach((item) => {
					lines.push(`- ${item.text}`);
				});
			} else {
				// Optionally add placeholder if needed for consistency?
				// lines.push("### Items");
				// lines.push("- (No items)");
			}
			if (issue.status.length > 0) {
				lines.push("### Status");
				issue.status.forEach((item) => {
					const check = item.checked ? "x" : " ";
					lines.push(`- [${check}] ${item.text}`);
				});
			} else {
				// Optionally add placeholder if needed for consistency?
				// lines.push("### Status");
				// lines.push("- [ ] (No status items)");
			}
			// Add spacing between issues within a group
			if (issueIndex < group.issues.length - 1) {
				lines.push("");
			}
		});

		// Add spacing between groups
		if (groupIndex < groups.length - 1) {
			lines.push("");
			// Optionally add a separator like ---
			// lines.push("---");
			// lines.push("");
		}
	});

	// Needs integration with frontmatter/pre-issue content preservation (in handleUpdate)
	return lines.join("\n");
};

const MAX_VISIBLE_ITEMS = 3;

const IssueBoardView: React.FC<ReactViewProps> = ({
	filePath,
	markdownContent,
	updateMarkdownContent,
	// app, plugin, switchToMarkdownView // available if needed
}) => {
	// State holds the array of successfully parsed groups
	const [groups, setGroups] = useState<Group[]>([]); // <<<< CHANGED STATE
	const [parsingErrors, setParsingErrors] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null); // For general errors
	const [editingItem, setEditingItem] = useState<EditingItemState | null>(
		null
	);
	// State for expanding individual cards (Issues)
	const [isCardExpanded, setIsCardExpanded] = useState<{
		[issueId: string]: boolean;
	}>({});
	// NEW: State for expanding groups (H1 sections)
	const [isGroupExpanded, setIsGroupExpanded] = useState<{
		[groupId: string]: boolean;
	}>({});
	const isInitialParseDone = useRef(false);
	// Adjust refs to handle group structure? For now, keep issueId as key.
	const inputRefs = useRef<{
		[issueId: string]: { [itemIndex: number]: HTMLInputElement | null };
	}>({});
	// Adjust focus ref to include group info? Using issueId might still work if IDs are unique.
	const newItemFocusRef = useRef<{
		issueId: string; // Keep using issue ID for simplicity if unique
		itemIndex: number;
	} | null>(null);

	// --- Effect for Parsing ---
	useEffect(() => {
		setError(null);
		setParsingErrors([]);
		try {
			// <<<< PARSER CALL CHANGED >>>>
			const { groups: parsedGroups, parsingErrors: pErrors } =
				parseIssueMarkdown(markdownContent);
			setGroups(parsedGroups); // <<<< SET GROUPS >>>>
			setParsingErrors(pErrors);

			// Initialize expansion state for groups and cards
			if (parsedGroups.length > 0 && !isInitialParseDone.current) {
				const initialGroupExpansionState: {
					[groupId: string]: boolean;
				} = {};
				const initialCardExpansionState: {
					[issueId: string]: boolean;
				} = {};

				parsedGroups.forEach((group) => {
					// Default groups to expanded, cards to collapsed
					initialGroupExpansionState[group.id] = true; // << Default groups expanded
					group.issues.forEach((issue) => {
						initialCardExpansionState[issue.id] = false; // Default cards collapsed
					});
				});
				setIsGroupExpanded(initialGroupExpansionState);
				setIsCardExpanded(initialCardExpansionState);
				isInitialParseDone.current = true;
			} else if (parsedGroups.length === 0) {
				// Reset expansion state if no groups are found after an update
				setIsGroupExpanded({});
				setIsCardExpanded({});
			}
		} catch (e) {
			console.error("IssueBoardView: Critical error during parsing:", e);
			setError(
				`Failed to parse markdown: ${
					e instanceof Error ? e.message : String(e)
				}`
			);
			setGroups([]); // Clear groups on critical error
			setParsingErrors([
				`A critical error occurred during parsing: ${
					e instanceof Error ? e.message : String(e)
				}`,
			]);
		}
	}, [markdownContent]);

	// --- Effect to Focus New Item (Logic might need adjustment if IDs aren't globally unique) ---
	useEffect(() => {
		if (newItemFocusRef.current && groups.length > 0) {
			const { issueId, itemIndex } = newItemFocusRef.current;
			// Find the input element using the potentially nested refs structure or flat structure if IDs are unique
			const inputElement = inputRefs.current[issueId]?.[itemIndex];
			if (inputElement) {
				inputElement.focus();
				// Select default text "item"
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
	}, [groups]); // Run when groups state updates

	// --- Effect to Focus Existing Item ---
	useEffect(() => {
		if (editingItem && groups.length > 0) {
			// Find the target issue within the correct group
			const targetGroup = groups[editingItem.groupIndex];
			const targetIssue = targetGroup?.issues[editingItem.cardIndex];
			if (targetIssue) {
				const inputElement =
					inputRefs.current[targetIssue.id]?.[editingItem.itemIndex];
				if (inputElement) {
					inputElement.focus();
				} else {
					console.warn(
						`IssueBoardView: Input ref not found for existing item: group ${editingItem.groupIndex}, issue ${targetIssue.id}, item ${editingItem.itemIndex}`
					);
				}
			}
		}
	}, [editingItem, groups]); // Depend on groups as well

	// --- Event Handlers ---

	// <<<< handleUpdate NEEDS TO BE MODIFIED >>>>
	const handleUpdate = (updatedGroups: Group[]) => {
		// Accept groups
		// Serialize the updated data model back to Markdown
		const lines = markdownContent.split("\n");

		// --- Preserve Frontmatter and Pre-Issue Content ---
		let frontmatter = "";
		let preIssueContent = "";
		let firstContentStartIndex = lines.length; // Default to end

		// Find frontmatter end
		const fmEndIndex = lines.findIndex(
			(line, index) => index > 0 && line.trim() === "---"
		);

		if (fmEndIndex === -1) {
			console.error(
				"IssueBoardView: Could not find closing frontmatter fence ('---')!"
			);
			setError(
				"Error: Could not find end of frontmatter. Cannot safely save."
			);
			return;
		}

		frontmatter = lines.slice(0, fmEndIndex + 1).join("\n");

		// Find start of the first *actual* content (H1 or H2)
		let firstValidHeaderIndex = -1;
		for (const group of updatedGroups) {
			if (group.headerLineIndex !== -1) {
				// Found an explicit H1
				firstValidHeaderIndex = group.headerLineIndex;
				break;
			} else if (group.issues.length > 0) {
				// Found issues in default group
				// Ensure issue header index is valid
				if (group.issues[0].headerLineIndex !== -1) {
					firstValidHeaderIndex = group.issues[0].headerLineIndex;
					break;
				}
			}
		}

		// Determine where the managed content starts
		if (
			firstValidHeaderIndex !== -1 &&
			firstValidHeaderIndex > fmEndIndex
		) {
			firstContentStartIndex = firstValidHeaderIndex;
		} else {
			// Fallback: Start content immediately after frontmatter if no valid headers found
			// or if the first header index is invalid (e.g., inside frontmatter)
			if (firstValidHeaderIndex !== -1) {
				console.warn(
					"IssueBoardView: First header index is within or before frontmatter. Starting content after frontmatter."
				);
			}
			firstContentStartIndex = fmEndIndex + 1;
		}

		// Extract content *between* frontmatter and first managed header
		preIssueContent = lines
			.slice(fmEndIndex + 1, firstContentStartIndex)
			.join("\n");

		// --- Combine preserved content with serialized groups ---
		const serializedGroups = serializeIssuesToMarkdown(updatedGroups); // <<<< SERIALIZE GROUPS >>>>

		let newMarkdown = frontmatter;
		// Add pre-issue content if it exists (trim check)
		if (preIssueContent.trim()) {
			// Ensure newline before pre-issue content if frontmatter doesn't end with one
			if (!frontmatter.endsWith("\n")) {
				newMarkdown += "\n";
			}
			newMarkdown += preIssueContent;
		}

		// Add serialized groups, ensuring appropriate spacing
		if (serializedGroups) {
			// Ensure separation from frontmatter/pre-content
			if (newMarkdown.length > 0 && !newMarkdown.endsWith("\n\n")) {
				newMarkdown += newMarkdown.endsWith("\n") ? "\n" : "\n\n";
			}
			newMarkdown += serializedGroups;
		} else {
			// Ensure at least one newline after frontmatter/pre-content if no groups exist
			if (newMarkdown.length > 0 && !newMarkdown.endsWith("\n")) {
				newMarkdown += "\n";
			}
		}

		// Update the state optimistically FIRST
		setGroups(updatedGroups); // <<<< SET GROUPS >>>>

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

	// <<<< handleStatusChange NEEDS groupIndex >>>>
	const handleStatusChange = (
		groupIndex: number, // NEW
		issueIndex: number,
		statusIndex: number,
		newCheckedState: boolean
	) => {
		setError(null); // Clear general errors on interaction
		const newGroups = groups.map((group, gIdx) => {
			// Map groups
			if (gIdx === groupIndex) {
				const newIssues = group.issues.map((issue, iIdx) => {
					// Map issues within group
					if (iIdx === issueIndex) {
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
				return { ...group, issues: newIssues }; // Return updated group
			}
			return group; // Return unchanged group
		});
		handleUpdate(newGroups); // <<<< Pass updated groups >>>>
	};

	// <<<< handleItemClick NEEDS groupIndex >>>>
	const handleItemClick = (
		groupIndex: number,
		issueIndex: number,
		itemIndex: number
	) => {
		if (editingItem) return; // Prevent multiple edits
		setError(null);
		const group = groups[groupIndex];
		const issue = group?.issues[issueIndex];
		const item = issue?.items[itemIndex];
		if (item) {
			setEditingItem({
				groupIndex: groupIndex, // NEW
				cardIndex: issueIndex,
				itemIndex: itemIndex,
				tempValue: item.text,
			});
		}
	};

	// handleItemChange remains the same
	const handleItemChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		if (editingItem) {
			setEditingItem({ ...editingItem, tempValue: event.target.value });
		}
	};

	// <<<< handleItemSave NEEDS groupIndex >>>>
	const handleItemSave = (insertNewLine: boolean = false) => {
		if (!editingItem) return;
		setError(null);
		const { groupIndex, cardIndex, itemIndex, tempValue } = editingItem; // Destructure groupIndex
		const newText = tempValue.trim();
		let addFocusRequest: { issueId: string; itemIndex: number } | null =
			null;

		const newGroups = groups.map((group, gIdx) => {
			// Map groups
			if (gIdx === groupIndex) {
				const newIssues = group.issues.map((issue, iIdx) => {
					// Map issues
					if (iIdx === cardIndex) {
						const newItems = issue.items.map((item, itemIdx) => {
							// Map items
							if (itemIdx === itemIndex) {
								return { ...item, text: newText }; // Update text
							}
							return item;
						});
						// Insert new item if requested
						if (insertNewLine) {
							const newItem: IssueItem = { text: "item" }; // Default text
							const insertAtIndex = itemIndex + 1;
							newItems.splice(insertAtIndex, 0, newItem);
							// Focus request uses the issue ID, assuming it's unique
							addFocusRequest = {
								issueId: issue.id,
								itemIndex: insertAtIndex,
							};
						}
						return { ...issue, items: newItems }; // Return updated issue
					}
					return issue;
				});
				return { ...group, issues: newIssues }; // Return updated group
			}
			return group; // Return unchanged group
		});

		// Set focus request *before* updating state/saving
		newItemFocusRef.current = addFocusRequest;
		setEditingItem(null); // Clear editing state FIRST
		handleUpdate(newGroups); // <<<< Pass updated groups >>>>
	};

	// <<<< handleItemKeyDown remains the same functionally, but calls modified save >>>>
	const handleItemKeyDown = (
		event: React.KeyboardEvent<HTMLInputElement>
	) => {
		if (event.key === "Enter") {
			event.preventDefault();
			handleItemSave(true); // Calls the updated save handler
		} else if (event.key === "Escape") {
			setEditingItem(null);
		}
	};

	// <<<< toggleExpand renamed to toggleCardExpand >>>>
	const toggleCardExpand = (issueId: string) => {
		setIsCardExpanded((prev) => ({ ...prev, [issueId]: !prev[issueId] }));
	};

	// <<<< NEW: toggleGroupExpand >>>>
	const toggleGroupExpand = (groupId: string) => {
		setIsGroupExpanded((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
	};

	// --- Render Logic ---
	if (error) {
		return (
			<div className="p-4 h-full overflow-y-auto">
				<h2 className="text-lg font-semibold mb-2">
					Error Loading Issue Board
				</h2>
				<p className="text-red-600 whitespace-pre-wrap">{error}</p>
				<p>File: {filePath}</p>
				{parsingErrors.length > 0 && (
					<div className="mt-4">
						<h4 className="font-semibold text-sm text-[var(--text-muted)]">
							Specific Parsing Issues:
						</h4>
						<ul className="text-xs text-[var(--text-muted)] list-disc list-inside pl-2 mt-1">
							{parsingErrors.map((err, i) => (
								<li key={i}>{err}</li>
							))}
						</ul>
					</div>
				)}
			</div>
		);
	}

	// Changed loading message slightly
	if (!groups && !error) {
		// Check groups instead of issues
		return (
			<div className="p-4 h-full overflow-y-auto">
				<p>Loading issue board data...</p>
			</div>
		);
	}

	// Check for no groups AFTER initial loading attempt
	if (
		groups.length === 0 &&
		parsingErrors.length === 0 &&
		markdownContent.trim().length > 0 && // Ensure content isn't just whitespace/frontmatter
		isInitialParseDone.current // Only show after the first parse attempt
	) {
		return (
			<div className="p-4 h-full overflow-y-auto">
				<h2 className="text-lg font-semibold mb-2">
					No Issue Groups or Cards Found
				</h2>
				<p>
					Could not parse any H1 groups or H2 issue cards from the
					file content after the frontmatter.
				</p>
				<p>
					Ensure cards start with a Level 2 Markdown header (e.g., `##
					Card Name`) and contain `### Items` and `### Status`
					sections. Optionally, group cards under Level 1 headers (`#
					Group Name`).
				</p>
			</div>
		);
	}

	return (
		<div className="p-3 h-full overflow-y-auto font-sans">
			{/* Parsing Error Box (unchanged styling) */}
			{parsingErrors.length > 0 && (
				<div className="border border-[var(--background-modifier-error-border)] bg-[var(--background-modifier-error)] text-[var(--text-error)] p-3 rounded-md mb-4">
					<h4 className="font-semibold">
						Note Parsing Issues Found:
					</h4>
					<ul className="text-sm text-[var(--text-muted)] list-disc list-inside">
						{parsingErrors.map((err, i) => (
							<li key={i}>{err}</li>
						))}
					</ul>
				</div>
			)}

			{/* <<<< OUTER LOOP: Render Groups >>>> */}
			{groups.map((group, groupIndex) => {
				const groupIsExpanded = isGroupExpanded[group.id] ?? true; // Default to expanded

				return (
					<div key={group.id} className="mb-4">
						{" "}
						{/* Spacing between groups */}
						{/* Render H1 only if it has a name (i.e., not the default group IF other groups exist) */}
						{!(
							group.headerLineIndex === -1 && groups.length > 1
						) && (
							<div
								className="flex items-center mb-2 cursor-pointer group" // Group hover effect for H1
								onClick={() => toggleGroupExpand(group.id)}
							>
								{/* Toggle Icon */}
								<span className="inline-block w-4 mr-1 text-lg text-[var(--text-muted)] group-hover:text-[var(--text-normal)]">
									{groupIsExpanded ? "▼" : "▶"}
								</span>
								{/* Group Title (H1 equivalent) */}
								<h1 className="!text-2xl !font-bold !m-0 !p-0 flex-grow text-[var(--text-normal)] group-hover:text-[var(--text-accent)]">
									{group.name}
								</h1>
							</div>
						)}
						{/* <<<< INNER CONTENT: Render Issues within Group (Conditionally) >>>> */}
						{groupIsExpanded && (
							<div
								className={
									!(
										group.headerLineIndex === -1 &&
										groups.length > 1
									)
										? "pl-5"
										: ""
								}
							>
								{" "}
								{/* Indent content under explicit H1 */}
								{group.issues.length === 0 &&
									!(
										group.headerLineIndex === -1 &&
										groups.length > 1
									) && (
										<p className="text-sm text-[var(--text-muted)] italic pl-1">
											No cards in this group.
										</p>
									)}
								{group.issues.map((issue, issueIndex) => {
									const needsExpansion =
										issue.items.length > MAX_VISIBLE_ITEMS;
									// Use isCardExpanded state for individual cards
									const isCurrentCardExpanded =
										isCardExpanded[issue.id] ?? false; // Default collapsed
									const visibleItems =
										needsExpansion && !isCurrentCardExpanded
											? issue.items.slice(
													0,
													MAX_VISIBLE_ITEMS
											  )
											: issue.items;

									// Initialize refs for the issue if not present
									if (!inputRefs.current[issue.id]) {
										inputRefs.current[issue.id] = {};
									}

									return (
										// Card Styling (largely unchanged, maybe add margin-top/bottom)
										<div
											key={issue.id}
											className="border border-[var(--background-modifier-border)] rounded-lg p-3 bg-[var(--background-secondary)] mb-2 shadow-sm"
										>
											{/* Card Title (H2) */}
											<h2 className="!m-0 !text-xl !font-semibold !leading-snug">
												{issue.name}
											</h2>
											{/* Issue Number */}
											{issue.number && (
												<div className="text-sm text-[var(--text-muted)] mb-1">
													{issue.number}
												</div>
											)}
											{/* Columns Container */}
											<div className="flex flex-row gap-5 pt-0">
												{/* Left Column - Items */}
												<div className="flex-grow-[3] min-w-0">
													<h3 className="text-sm font-semibold !m-0 !mb-0.5 text-[var(--text-accent)] leading-snug">
														Items
													</h3>
													<ul className="list-none pl-0 m-0 space-y-0 text-sm">
														{visibleItems.map(
															(
																item,
																itemIndex
															) => {
																const isEditing =
																	editingItem?.groupIndex ===
																		groupIndex && // Check groupIndex
																	editingItem?.cardIndex ===
																		issueIndex &&
																	editingItem?.itemIndex ===
																		itemIndex;

																return (
																	<li
																		key={`${issue.id}-item-${itemIndex}`}
																		className="cursor-pointer px-1 py-0 rounded-sm min-h-[1.3em] hover:bg-[var(--background-modifier-hover)]"
																		onClick={() =>
																			!isEditing &&
																			// Pass groupIndex to handler
																			handleItemClick(
																				groupIndex,
																				issueIndex,
																				itemIndex
																			)
																		}
																	>
																		{isEditing ? (
																			<input
																				ref={(
																					el
																				) => {
																					if (
																						inputRefs
																							.current[
																							issue
																								.id
																						]
																					) {
																						inputRefs.current[
																							issue.id
																						][
																							itemIndex
																						] =
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
																				} // Calls updated save
																				onKeyDown={
																					handleItemKeyDown
																				} // Calls updated keydown
																				autoFocus
																				className="w-full px-1 py-0 m-0 text-sm border border-[var(--background-modifier-border)] rounded-sm bg-[var(--background-primary)] text-[var(--text-normal)] focus:outline-none focus:border-[var(--interactive-accent)]"
																			/>
																		) : (
																			item.text
																		)}
																	</li>
																);
															}
														)}
													</ul>
													{/* Card Expansion Toggle */}
													{needsExpansion && (
														<div
															onClick={() =>
																toggleCardExpand(
																	issue.id
																)
															} // Use card toggle
															className="text-[var(--text-muted)] cursor-pointer pt-0.5 pl-1 mt-1 text-xs select-none hover:text-[var(--text-normal)]"
														>
															{isCurrentCardExpanded
																? "Collapse Items ▲"
																: `Show ${
																		issue
																			.items
																			.length -
																		MAX_VISIBLE_ITEMS
																  } More ▼`}
														</div>
													)}
												</div>

												{/* Right Column - Status */}
												<div className="flex-grow min-w-40">
													<h3 className="text-sm font-semibold !m-0 !mb-0.5 text-[var(--text-accent)] leading-snug">
														Status
													</h3>
													<ul className="list-none pl-0 m-0 space-y-0.5 text-sm">
														{issue.status.map(
															(
																item,
																statusIndex
															) => (
																<li
																	key={`${issue.id}-status-${statusIndex}`}
																>
																	<label className="flex items-center cursor-pointer">
																		<input
																			type="checkbox"
																			checked={
																				item.checked
																			}
																			onChange={(
																				e
																			) =>
																				// Pass groupIndex to handler
																				handleStatusChange(
																					groupIndex,
																					issueIndex,
																					statusIndex,
																					e
																						.target
																						.checked
																				)
																			}
																			className="mr-1.5 cursor-pointer h-4 w-4 rounded border-gray-300 text-[var(--interactive-accent)] focus:ring-[var(--interactive-accent)] focus:ring-offset-0 focus:ring-1"
																		/>
																		<span className="select-none">
																			{
																				item.text
																			}
																		</span>
																	</label>
																</li>
															)
														)}
													</ul>
												</div>
											</div>
										</div>
									);
								})}
							</div> // End group content div
						)}
					</div> // End group wrapper div
				);
			})}
		</div>
	);
};

export default IssueBoardView;
