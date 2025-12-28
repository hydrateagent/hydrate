// src/components/HydrateView/createViewHandler.ts
import { TFile, MarkdownView } from "obsidian";
import type { HydrateView } from "./hydrateView";
import { addMessageToChat, setLoadingState } from "./domUtils";
import { devLog } from "../../utils/logger";
import { REACT_HOST_VIEW_TYPE } from "../../main";

interface GenerateViewResponse {
	content: string;
}

// System prompt for view generation
const VIEW_GENERATION_SYSTEM_PROMPT = `You are a React component generator for Hydrate, an Obsidian plugin.

Your task is to create a React functional component that renders markdown content as an interactive UI.

## Component Interface

Your component receives these props:
\`\`\`typescript
interface ReactViewProps {
  app: App;                    // Obsidian app instance
  plugin: HydratePlugin;       // Plugin instance
  filePath: string;            // Path to the markdown file
  markdownContent: string;     // Current file content
  updateMarkdownContent: (content: string) => Promise<boolean>;  // Save changes
  switchToMarkdownView: () => Promise<void>;  // Switch to editor
}
\`\`\`

## Requirements

1. Export a default React functional component
2. Parse the markdown to extract structured data (use regex or simple parsing)
3. Render interactive UI based on the user's description
4. Call updateMarkdownContent() when user makes changes (for editable views)
5. Handle loading and error states gracefully
6. Import React from 'react' at the top

## CRITICAL: Styling in Obsidian

**DO NOT use Tailwind CSS classes** - they will not work in Obsidian.

Instead, use Obsidian's CSS variables for theming. Use inline styles or className with CSS variables.

### Common Obsidian CSS Variables:

**Colors:**
- var(--background-primary) - Main background
- var(--background-secondary) - Cards, panels
- var(--background-modifier-border) - Borders
- var(--background-modifier-hover) - Hover states
- var(--text-normal) - Primary text
- var(--text-muted) - Secondary/dimmed text
- var(--text-accent) - Links, accents
- var(--interactive-accent) - Buttons, checkboxes
- var(--interactive-accent-hover) - Button hover

**Semantic:**
- var(--background-modifier-error) - Error background
- var(--text-error) - Error text
- var(--background-modifier-success) - Success background

### Styling Example:
\`\`\`jsx
// Card container
<div style={{
  backgroundColor: 'var(--background-secondary)',
  border: '1px solid var(--background-modifier-border)',
  borderRadius: '8px',
  padding: '12px'
}}>

// Text
<h2 style={{ color: 'var(--text-normal)', margin: 0 }}>Title</h2>
<p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Subtitle</p>

// Button
<button style={{
  backgroundColor: 'var(--interactive-accent)',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  padding: '6px 12px',
  cursor: 'pointer'
}}>Click me</button>

// Input
<input style={{
  backgroundColor: 'var(--background-primary)',
  border: '1px solid var(--background-modifier-border)',
  borderRadius: '4px',
  padding: '6px',
  color: 'var(--text-normal)'
}} />
\`\`\`

## Output Format

Return ONLY the JSX code for the component. Do not include markdown code fences or explanations.
Start directly with: import React from 'react';

## Example: Kanban Board

import React from 'react';

export default function KanbanView({ markdownContent, updateMarkdownContent }) {
  const [columns, setColumns] = React.useState([]);

  React.useEffect(() => {
    const parsed = parseMarkdown(markdownContent);
    setColumns(parsed);
  }, [markdownContent]);

  const saveChanges = async (newColumns) => {
    setColumns(newColumns);
    const md = serializeToMarkdown(newColumns);
    await updateMarkdownContent(md);
  };

  return (
    <div style={{
      display: 'flex',
      gap: '16px',
      padding: '16px',
      overflowX: 'auto',
      height: '100%'
    }}>
      {columns.map((col, colIndex) => (
        <div key={col.id} style={{
          minWidth: '280px',
          backgroundColor: 'var(--background-secondary)',
          borderRadius: '8px',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <h3 style={{
            margin: '0 0 12px 0',
            color: 'var(--text-normal)',
            fontWeight: 600
          }}>{col.title}</h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {col.cards.map((card, cardIndex) => (
              <div key={card.id} style={{
                backgroundColor: 'var(--background-primary)',
                border: '1px solid var(--background-modifier-border)',
                borderRadius: '6px',
                padding: '10px',
                cursor: 'grab'
              }}>
                <div style={{
                  fontWeight: 500,
                  color: 'var(--text-normal)',
                  marginBottom: '4px'
                }}>{card.title}</div>
                {card.description && (
                  <div style={{
                    fontSize: '12px',
                    color: 'var(--text-muted)'
                  }}>{card.description}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function parseMarkdown(content) {
  // Parse # headings as columns, ## as cards
  const columns = [];
  let currentCol = null;

  content.split('\\n').forEach(line => {
    if (line.startsWith('# ')) {
      currentCol = { id: Date.now() + Math.random(), title: line.slice(2), cards: [] };
      columns.push(currentCol);
    } else if (line.startsWith('## ') && currentCol) {
      currentCol.cards.push({
        id: Date.now() + Math.random(),
        title: line.slice(3),
        description: ''
      });
    }
  });

  return columns;
}

function serializeToMarkdown(columns) {
  let md = '---\\nhydrate-plugin: kanban\\n---\\n\\n';
  columns.forEach(col => {
    md += \`# \${col.title}\\n\\n\`;
    col.cards.forEach(card => {
      md += \`## \${card.title}\\n\\n\`;
    });
  });
  return md;
}`;

/**
 * Extract the hydrate-plugin view name from frontmatter
 */
function extractViewNameFromFrontmatter(content: string): string | null {
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!frontmatterMatch) return null;

	const frontmatter = frontmatterMatch[1];
	const viewMatch = frontmatter.match(/hydrate-plugin:\s*(.+)/);
	if (!viewMatch) return null;

	return viewMatch[1].trim();
}

/**
 * Check if this is a /create-view command
 */
export function isCreateViewCommand(message: string): boolean {
	return message.trim().toLowerCase().startsWith("/create-view");
}

/**
 * Check if this is a /edit-view command
 */
export function isEditViewCommand(message: string): boolean {
	return message.trim().toLowerCase().startsWith("/edit-view");
}

/**
 * Extract the description from a /create-view command
 */
export function extractViewDescription(message: string): string {
	return message.replace(/^\/create-view\s*/i, "").trim();
}

/**
 * Extract the description from a /edit-view command
 */
export function extractEditViewDescription(message: string): string {
	return message.replace(/^\/edit-view\s*/i, "").trim();
}

/**
 * Switch any leaves showing the file to the React view (or refresh if already React)
 */
async function switchFileToReactView(
	view: HydrateView,
	filePath: string,
	viewName: string
): Promise<void> {
	const app = view.plugin.app;
	const refreshToken = Date.now(); // Unique token to force remount

	// Find all leaves showing this file
	app.workspace.iterateAllLeaves((leaf) => {
		const leafView = leaf.view;

		// Handle MarkdownView - switch to React
		if (leafView instanceof MarkdownView && leafView.file?.path === filePath) {
			devLog.debug(`Switching MarkdownView to React view for ${filePath}`);
			leaf.setViewState({
				type: REACT_HOST_VIEW_TYPE,
				state: {
					filePath: filePath,
					viewKey: viewName,
					refreshToken: refreshToken,
				},
				active: leaf === app.workspace.getLeaf(),
			});
		}

		// Handle ReactViewHost - force remount by re-setting state with new refreshToken
		if (
			leafView.getViewType() === REACT_HOST_VIEW_TYPE &&
			(leafView as any).currentFilePath === filePath
		) {
			devLog.debug(`Refreshing React view for ${filePath}`);
			leaf.setViewState({
				type: REACT_HOST_VIEW_TYPE,
				state: {
					filePath: filePath,
					viewKey: viewName,
					refreshToken: refreshToken,
				},
				active: leaf === app.workspace.getLeaf(),
			});
		}
	});
}

/**
 * Handle the /create-view command
 */
export async function handleCreateView(
	view: HydrateView,
	message: string
): Promise<boolean> {
	const description = extractViewDescription(message);

	if (!description) {
		addMessageToChat(
			view,
			"system",
			"Please provide a description of the view you want to create.\n\nExample: /create-view card layout with images, title, and cooking time",
			true
		);
		return true; // Handled, but with error
	}

	// Get the currently active/attached file
	const attachedFile = view.attachedFiles[0];
	if (!attachedFile) {
		addMessageToChat(
			view,
			"system",
			"Please attach a markdown file with your sample data structure first.\n\nThe file should have `hydrate-plugin: your-view-name` in the frontmatter.",
			true
		);
		return true;
	}

	// Read the file content
	const file = view.plugin.app.vault.getAbstractFileByPath(attachedFile);
	if (!(file instanceof TFile)) {
		addMessageToChat(view, "system", "Could not read the attached file.", true);
		return true;
	}

	const fileContent = await view.plugin.app.vault.read(file);

	// Extract view name from frontmatter
	const viewName = extractViewNameFromFrontmatter(fileContent);
	if (!viewName) {
		addMessageToChat(
			view,
			"system",
			"The attached file needs `hydrate-plugin: your-view-name` in the frontmatter.\n\nExample:\n```\n---\nhydrate-plugin: recipe-cards\n---\n```",
			true
		);
		return true;
	}

	// Check if it's a built-in view
	if (viewName === "issue-board") {
		addMessageToChat(
			view,
			"system",
			"Cannot overwrite the built-in 'issue-board' view. Please choose a different name.",
			true
		);
		return true;
	}

	// Check Max subscription
	if (!view.plugin.hasMaxLicense()) {
		addMessageToChat(
			view,
			"system",
			"Custom view creation is a Hydrate Max feature. Visit hydrateagent.com to upgrade.",
			true
		);
		return true;
	}

	// Show user message
	addMessageToChat(view, "user", message);

	// Show loading state
	setLoadingState(view, true);
	addMessageToChat(
		view,
		"system",
		`Creating view "${viewName}"...`
	);

	try {
		// Build the prompt for the LLM
		const userPrompt = `Create a React view component for the following:

## View Name
${viewName}

## User's Vision
${description}

## Sample Markdown Structure
\`\`\`markdown
${fileContent}
\`\`\`

Generate a React component that:
1. Parses this markdown structure
2. Renders it according to the user's vision
3. Allows editing where appropriate (updates should write back to markdown)

Return ONLY the JSX code, starting with "import React from 'react';".`;

		// Call the backend to generate the view
		const backendUrl = view.plugin.getBackendUrl();
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		// Add license key if available
		const licenseKey = view.plugin.settings.licenseKey;
		if (licenseKey) {
			headers["X-License-Key"] = licenseKey;
		}

		// Add API keys for BYOK
		const settings = view.plugin.settings;
		if (settings.openaiApiKey) headers["X-OpenAI-Key"] = settings.openaiApiKey;
		if (settings.anthropicApiKey) headers["X-Anthropic-Key"] = settings.anthropicApiKey;
		if (settings.googleApiKey) headers["X-Gemini-Key"] = settings.googleApiKey;

		const fetchResponse = await fetch(`${backendUrl}/generate-view`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				system_prompt: VIEW_GENERATION_SYSTEM_PROMPT,
				user_prompt: userPrompt,
				model: view.plugin.settings.selectedModel,
			}),
		});

		if (!fetchResponse.ok) {
			const errorData = await fetchResponse.json().catch(() => ({}));
			throw new Error(
				errorData.detail || `Server error: ${fetchResponse.status}`
			);
		}

		const response: GenerateViewResponse = await fetchResponse.json();

		if (!response || !response.content) {
			throw new Error("No response from view generation");
		}

		let generatedCode = response.content;

		// Clean up the response - remove markdown code fences if present
		generatedCode = generatedCode
			.replace(/^```(?:jsx|javascript|tsx|typescript)?\n?/i, "")
			.replace(/\n?```$/i, "")
			.trim();

		// Validate it starts with import
		if (!generatedCode.startsWith("import")) {
			throw new Error(
				"Generated code does not appear to be valid. Expected 'import' statement."
			);
		}

		// Save the view
		const saved = await view.plugin.viewLoader?.saveView(viewName, generatedCode);

		if (saved) {
			addMessageToChat(
				view,
				"agent",
				`View "${viewName}" created successfully!\n\nThe file is now being rendered with your custom view. If you want to make changes, just describe what you'd like to modify.`
			);

			// Switch any leaves showing the attached file to the React view
			await switchFileToReactView(view, attachedFile, viewName);
		} else {
			throw new Error("Failed to save view file");
		}
	} catch (error) {
		devLog.error("Failed to create view:", error);
		addMessageToChat(
			view,
			"system",
			`Failed to create view: ${error instanceof Error ? error.message : "Unknown error"}`,
			true
		);
	} finally {
		setLoadingState(view, false);
	}

	return true; // Command was handled
}

/**
 * Handle the /edit-view command
 */
export async function handleEditViewCommand(
	view: HydrateView,
	message: string
): Promise<boolean> {
	const description = extractEditViewDescription(message);

	if (!description) {
		addMessageToChat(
			view,
			"system",
			"Please describe what changes you want to make.\n\nExample: /edit-view make the cards larger and add a delete button",
			true
		);
		return true;
	}

	// Get the currently attached file
	const attachedFile = view.attachedFiles[0];
	if (!attachedFile) {
		addMessageToChat(
			view,
			"system",
			"Please attach a markdown file that uses the view you want to edit.\n\nThe file should have `hydrate-plugin: your-view-name` in the frontmatter.",
			true
		);
		return true;
	}

	// Read the file content to get the view name
	const file = view.plugin.app.vault.getAbstractFileByPath(attachedFile);
	if (!(file instanceof TFile)) {
		addMessageToChat(view, "system", "Could not read the attached file.", true);
		return true;
	}

	const fileContent = await view.plugin.app.vault.read(file);
	const viewName = extractViewNameFromFrontmatter(fileContent);

	if (!viewName) {
		addMessageToChat(
			view,
			"system",
			"The attached file needs `hydrate-plugin: your-view-name` in the frontmatter to identify which view to edit.",
			true
		);
		return true;
	}

	// Check if it's a built-in view
	if (viewName === "issue-board") {
		addMessageToChat(
			view,
			"system",
			"Cannot edit the built-in 'issue-board' view.",
			true
		);
		return true;
	}

	// Check Max subscription
	if (!view.plugin.hasMaxLicense()) {
		addMessageToChat(
			view,
			"system",
			"Custom view editing is a Hydrate Max feature. Visit hydrateagent.com to upgrade.",
			true
		);
		return true;
	}

	// Show user message
	addMessageToChat(view, "user", message);

	// Delegate to the existing edit handler
	return handleViewEdit(view, description, viewName);
}

/**
 * Handle view iteration/editing via chat (internal)
 */
async function handleViewEdit(
	view: HydrateView,
	message: string,
	viewName: string
): Promise<boolean> {
	// TODO: Check Max subscription

	const viewLoader = view.plugin.viewLoader;
	if (!viewLoader) {
		addMessageToChat(view, "system", "View loader not available.", true);
		return false;
	}

	// Get the current view code
	const viewPath = viewLoader.getViewFilePath(viewName);
	let currentCode: string;

	try {
		currentCode = await view.plugin.app.vault.adapter.read(viewPath);
	} catch {
		addMessageToChat(
			view,
			"system",
			`View "${viewName}" not found. Use /create-view to create it first.`,
			true
		);
		return false;
	}

	// Get the current file content for context
	const attachedFile = view.attachedFiles[0];
	let fileContent = "";
	if (attachedFile) {
		const file = view.plugin.app.vault.getAbstractFileByPath(attachedFile);
		if (file instanceof TFile) {
			fileContent = await view.plugin.app.vault.read(file);
		}
	}

	setLoadingState(view, true);

	try {
		const userPrompt = `Modify this existing React view component based on the user's feedback:

## Current Component Code
\`\`\`jsx
${currentCode}
\`\`\`

## User's Feedback
${message}

## Current Markdown Content (for context)
\`\`\`markdown
${fileContent}
\`\`\`

Update the component according to the user's feedback. Return ONLY the complete updated JSX code, starting with "import React from 'react';".`;

		// Call the backend to update the view
		const backendUrl = view.plugin.getBackendUrl();
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		// Add license key if available
		const licenseKey = view.plugin.settings.licenseKey;
		if (licenseKey) {
			headers["X-License-Key"] = licenseKey;
		}

		// Add API keys for BYOK
		const settings = view.plugin.settings;
		if (settings.openaiApiKey) headers["X-OpenAI-Key"] = settings.openaiApiKey;
		if (settings.anthropicApiKey) headers["X-Anthropic-Key"] = settings.anthropicApiKey;
		if (settings.googleApiKey) headers["X-Gemini-Key"] = settings.googleApiKey;

		const fetchResponse = await fetch(`${backendUrl}/generate-view`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				system_prompt: VIEW_GENERATION_SYSTEM_PROMPT,
				user_prompt: userPrompt,
				model: view.plugin.settings.selectedModel,
			}),
		});

		if (!fetchResponse.ok) {
			const errorData = await fetchResponse.json().catch(() => ({}));
			throw new Error(
				errorData.detail || `Server error: ${fetchResponse.status}`
			);
		}

		const response: GenerateViewResponse = await fetchResponse.json();

		if (!response || !response.content) {
			throw new Error("No response from view generation");
		}

		let updatedCode = response.content;
		updatedCode = updatedCode
			.replace(/^```(?:jsx|javascript|tsx|typescript)?\n?/i, "")
			.replace(/\n?```$/i, "")
			.trim();

		if (!updatedCode.startsWith("import")) {
			throw new Error("Generated code does not appear to be valid");
		}

		const saved = await viewLoader.saveView(viewName, updatedCode);

		if (saved) {
			addMessageToChat(
				view,
				"agent",
				`View "${viewName}" updated! The changes should be visible now.`
			);

			// Refresh any leaves showing the attached file
			if (attachedFile) {
				await switchFileToReactView(view, attachedFile, viewName);
			}
		} else {
			throw new Error("Failed to save updated view");
		}
	} catch (error) {
		devLog.error("Failed to update view:", error);
		addMessageToChat(
			view,
			"system",
			`Failed to update view: ${error instanceof Error ? error.message : "Unknown error"}`,
			true
		);
	} finally {
		setLoadingState(view, false);
	}

	return true;
}
