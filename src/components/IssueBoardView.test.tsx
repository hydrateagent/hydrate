// <reference types="@testing-library/jest-dom" />
import * as React from "react";
import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest"; // Import from vitest
import IssueBoardView from "./IssueBoardView";
import { ReactViewProps } from "../types";
import { App } from "obsidian";
import HydratePlugin from "../main";

// Mock the updateMarkdownContent prop
// Make it return a resolved promise to allow .catch() in the component
const mockUpdateMarkdownContent = vi.fn().mockResolvedValue(undefined);
const mockSwitchToMarkdownView = vi.fn(); // Mock for switchToMarkdownView

const defaultProps: ReactViewProps = {
	filePath: "test.md",
	markdownContent: "", // Start with empty, override in tests
	updateMarkdownContent: mockUpdateMarkdownContent,
	// Add basic mocks for other required props
	app: {} as Partial<App> as App, // Provide a minimal mock if specific app methods aren't needed
	plugin: {} as Partial<HydratePlugin> as HydratePlugin, // Provide a minimal mock if specific plugin methods aren't needed
	switchToMarkdownView: mockSwitchToMarkdownView, // Use the vi.fn() mock
	// Add mocks for other props if they become necessary for specific tests
	// app: {} as any,
	// plugin: {} as any,
	// switchToMarkdownView: vi.fn(),
};

// Helper to render the component with specific markdown
const renderBoard = (markdown: string) => {
	return render(
		<IssueBoardView {...defaultProps} markdownContent={markdown} />,
	);
};

// Basic valid markdown structure with frontmatter
const basicValidMarkdown = `\
---
some: frontmatter
tags: [test]
---

# Group 1

## Card One
- Issue-1
### Items
- Item 1.1
- Item 1.2
### Status
- [ ] Status 1.1
- [x] Status 1.2

## Card Two
### Items
- Item 2.1
### Status
- [ ] Status 2.1

# Group 2

## Card Three
### Items
### Status
`;

const frontmatterOnly = `\
---
some: frontmatter
---
`;

describe("IssueBoardView", () => {
	beforeEach(() => {
		// Reset mocks before each test
		mockUpdateMarkdownContent.mockClear();
		mockSwitchToMarkdownView.mockClear();
		// Reset component's internal state simulation if needed (React Testing Library usually handles this via unmounting)
	});

	it("renders without crashing with basic valid markdown", () => {
		renderBoard(basicValidMarkdown);
		expect(screen.getByText("Group 1")).toBeInTheDocument();
		expect(screen.getByText("Card One")).toBeInTheDocument();
		expect(screen.getByText("Item 1.1")).toBeInTheDocument();
		expect(screen.getByLabelText("Status 1.1")).toBeInTheDocument();
	});

	it('shows "No issue groups or cards found" message for frontmatter-only content', async () => {
		renderBoard(frontmatterOnly);
		// Wait for the initial parse effect to complete
		await screen.findByText(/No issue groups or cards found/i);
	});

	it("renders groups and cards correctly", () => {
		renderBoard(basicValidMarkdown);
		// Check Groups
		const group1Heading = screen.getByRole("heading", {
			level: 1,
			name: "Group 1",
		});
		const group2Heading = screen.getByRole("heading", {
			level: 1,
			name: "Group 2",
		});
		expect(group1Heading).toBeInTheDocument();
		expect(group2Heading).toBeInTheDocument();

		// Check Cards within Group 1
		const group1Container = group1Heading.closest("div[class*='mb-4']"); // Find the outer group container
		expect(group1Container).toBeInTheDocument();
		// Use within to query inside the specific group container
		expect(
			within(group1Container! as HTMLElement).getByRole("heading", {
				level: 2,
				name: "Card One",
			}),
		).toBeInTheDocument();
		expect(
			within(group1Container! as HTMLElement).getByRole("heading", {
				level: 2,
				name: "Card Two",
			}),
		).toBeInTheDocument();
		expect(
			within(group1Container! as HTMLElement).queryByRole("heading", {
				level: 2,
				name: "Card Three",
			}),
		).not.toBeInTheDocument();

		// Check Cards within Group 2
		const group2Container = group2Heading.closest("div[class*='mb-4']");
		expect(group2Container).toBeInTheDocument();
		expect(
			within(group2Container! as HTMLElement).getByRole("heading", {
				level: 2,
				name: "Card Three",
			}),
		).toBeInTheDocument();
		expect(
			within(group2Container! as HTMLElement).queryByRole("heading", {
				level: 2,
				name: "Card One",
			}),
		).not.toBeInTheDocument();

		// Check specific item and status in Card One (can remain the same or use within)
		const cardOne = within(group1Container! as HTMLElement)
			.getByRole("heading", { level: 2, name: "Card One" })
			.closest("div[class*='mb-2']");
		expect(
			within(cardOne! as HTMLElement).getByText("Item 1.1"),
		).toBeInTheDocument();
		expect(
			within(cardOne! as HTMLElement).getByLabelText("Status 1.1"),
		).not.toBeChecked();
		expect(
			within(cardOne! as HTMLElement).getByLabelText("Status 1.2"),
		).toBeChecked();
	});

	it("displays parsing errors when parser returns them", () => {
		// Simulate a markdown structure that the parser identifies as problematic
		// (e.g., missing Items/Status, non-task list under status)
		const markdownWithParsingError = `\
---
valid: frontmatter
---

## Card With Bad Status List
### Items
- Good item
### Status
- This is not a task list item!
- [ ] This one is okay
`;
		renderBoard(markdownWithParsingError);

		// Check for the error container and specific error messages generated by the parser
		expect(
			screen.getByText(/Note parsing issues found:/i),
		).toBeInTheDocument();
		expect(
			screen.getByText(/Non-task list item found under '### Status'/i),
		).toBeInTheDocument();

		// Also check that the valid parts are still rendered
		expect(
			screen.getByText("Card With Bad Status List"),
		).toBeInTheDocument();
		expect(screen.getByText("Good item")).toBeInTheDocument();
		expect(screen.getByLabelText("This one is okay")).toBeInTheDocument();
		// The bad item text itself might not be rendered as a status item, depending on parser logic
		expect(
			screen.queryByLabelText("This is not a task list item!"),
		).not.toBeInTheDocument();
	});

	it("updates markdown when a status checkbox is clicked", async () => {
		renderBoard(basicValidMarkdown);
		const user = userEvent.setup();

		const checkbox = screen.getByLabelText("Status 1.1");
		expect(checkbox).not.toBeChecked();

		await user.click(checkbox);

		// Check if the mock function was called
		await waitFor(() => {
			expect(mockUpdateMarkdownContent).toHaveBeenCalledTimes(1);
		});

		// Verify the content passed to the update function
		const expectedMarkdownAfterCheck = `\
---
some: frontmatter
tags: [test]
---

# Group 1

## Card One
- Issue-1
### Items
- Item 1.1
- Item 1.2
### Status
- [x] Status 1.1
- [x] Status 1.2

## Card Two
### Items
- Item 2.1
### Status
- [ ] Status 2.1

# Group 2

## Card Three
### Items
### Status`; // Trailing newline might vary, check actual output

		// Check the argument passed to the mock function
		await waitFor(() => {
			// Normalize newlines for comparison robustness
			const actualContent =
				mockUpdateMarkdownContent.mock.calls[0][0].replace(
					/\\r\\n/g,
					"\\n",
				);
			const expectedContent = expectedMarkdownAfterCheck.replace(
				/\\r\\n/g,
				"\\n",
			);
			// Trim trailing whitespace which can be inconsistent
			expect(actualContent.trim()).toEqual(expectedContent.trim());
		});

		// Check if the checkbox is now checked in the DOM (optimistic update)
		await waitFor(() => {
			expect(screen.getByLabelText("Status 1.1")).toBeChecked();
		});
	});

	it("allows editing an item text and saves on blur", async () => {
		renderBoard(basicValidMarkdown);
		const user = userEvent.setup();
		const itemToEdit = screen.getByText("Item 1.1");

		await user.click(itemToEdit);

		const input = screen.getByDisplayValue("Item 1.1");
		expect(input).toBeInTheDocument();

		await user.clear(input);
		await user.type(input, "Updated Item 1.1");
		await user.tab(); // Blur the input

		// Check if the update function was called
		await waitFor(() => {
			expect(mockUpdateMarkdownContent).toHaveBeenCalledTimes(1);
		});

		// Verify the updated content in the DOM (optimistic update)
		await waitFor(() => {
			expect(screen.getByText("Updated Item 1.1")).toBeInTheDocument();
			expect(
				screen.queryByDisplayValue("Updated Item 1.1"),
			).not.toBeInTheDocument(); // Input should be gone
		});

		// Verify the content passed to the update function
		const expectedMarkdownAfterEdit = `\
---
some: frontmatter
tags: [test]
---

# Group 1

## Card One
- Issue-1
### Items
- Updated Item 1.1
- Item 1.2
### Status
- [ ] Status 1.1
- [x] Status 1.2

## Card Two
### Items
- Item 2.1
### Status
- [ ] Status 2.1

# Group 2

## Card Three
### Items
### Status`;

		await waitFor(() => {
			const actualContent =
				mockUpdateMarkdownContent.mock.calls[0][0].replace(
					/\\r\\n/g,
					"\\n",
				);
			const expectedContent = expectedMarkdownAfterEdit.replace(
				/\\r\\n/g,
				"\\n",
			);
			expect(actualContent.trim()).toEqual(expectedContent.trim());
		});
	});

	// Add more tests:
	// - Item editing save with Enter (should add new item)
	// - Card expansion toggle
	// - Group expansion toggle
	// - Handling edge cases (e.g., no frontmatter, empty sections)
});
