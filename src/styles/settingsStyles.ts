import HydratePlugin from "../main"; // Corrected path

export function injectSettingsStyles(plugin: HydratePlugin) {
	// Consolidate all CSS rules here, removing duplicates
	// These setting are used to override pesky Obsidian styles that otherwise cannot be
	const css = `
        /* --- General Settings Styles --- */
        .hydrate-settings-section {
            border-top: 1px solid var(--background-modifier-border);
            padding-top: 20px;
            margin-top: 20px;
        }
        .hydrate-settings-heading {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 5px; /* Space below heading */
        }
        .hydrate-settings-heading h3 {
            margin-bottom: 0; /* Remove default margin from h3 */
        }

        /* --- Input Error State --- */
        .hydrate-input-error {
            /* Using more specific theme variable */
            border-color: var(--text-error) !important;
            box-shadow: 0 0 0 1px var(--text-error) !important;
        }

        /* --- Registry List Styles --- */
        .hydrate-registry-list {
            margin-top: 15px;
            border: 1px solid var(--background-modifier-border);
            border-radius: var(--radius-m);
            padding: 5px 0px 5px 15px;
            max-height: 400px;
            overflow-y: auto;
            background-color: var(--background-secondary);
        }
        .hydrate-registry-item {
             border-bottom: 1px solid var(--background-modifier-border);
             align-items: center;
        }
        .hydrate-registry-item:last-child {
             border-bottom: none;
        }
        .hydrate-registry-item .setting-item-info {
            flex-grow: 1;
            margin-right: var(--size-4-2);
        }
        .hydrate-registry-item .setting-item-control {
             flex-shrink: 0;
             margin-left: auto;
        }
        .hydrate-empty-list-message {
            color: var(--text-muted);
            padding: 15px;
            text-align: center;
            font-style: italic;
        }

        /* --- Registry Edit Modal Styles --- */

        /* Wider Modal */
        .hydrate-registry-edit-modal-wide .modal {
            width: 70%; /* Adjust width as desired */
            max-width: 900px; /* Set a maximum width */
        }

        /* Vertical Layout for the Custom Content Setting */
        .setting-item.hydrate-content-setting-vertical {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            width: 100%;
            /* Remove default setting padding that might interfere */
            padding-top: 0;
            padding-bottom: 0;
        }

        /* Content Setting Info Block (Label + Description) */
        .hydrate-content-setting-vertical .setting-item-info {
            width: 100%; /* Take full width */
            /* Remove default right margin if any */
            margin-right: 0;
            margin-bottom: var(--size-4-2); /* Space below the description */
        }

        /* Content Setting Control Block (Textarea Container) */
        .hydrate-content-setting-vertical .setting-item-control {
            width: 100%; /* Take full width */
        }

        /* Content Text Area Specific Styling */
        .hydrate-content-textarea {
            width: 100%;
            min-height: 250px; /* Set desired minimum height */
            resize: vertical; /* Allow vertical resizing */
            font-family: var(--font-monospace); /* Use monospace font */
            margin-top: var(--size-4-1); /* Small space above textarea */
            border: 1px solid var(--background-modifier-border); /* Add border for clarity */
            border-radius: var(--radius-s); /* Small radius */
        }

        /* Modal Button Bar Alignment */
        .hydrate-modal-button-bar {
            display: flex; /* Use flex directly on the setting item */
            justify-content: flex-end; /* Align content (buttons) to the right */
            gap: var(--size-4-2); /* Space between buttons */
            margin-top: var(--size-4-4); /* Add some space above buttons */
            /* Override standard setting padding */
            padding-top: var(--size-4-3);
            padding-bottom: var(--size-4-1);
            border: none; /* Remove default setting border if present */
        }

        /* Hide default info/description for button bar */
        .hydrate-modal-button-bar .setting-item-info {
            display: none;
        }

        /* Ensure control block for buttons doesn't take unnecessary space */
        .hydrate-modal-button-bar .setting-item-control {
            width: auto; /* Let buttons determine width */
            flex-grow: 0; /* Prevent it from growing */
        }
    
        /* MCP Server Configuration Styles */
        .hydrate-mcp-server-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            border: 1px solid var(--background-modifier-border);
            border-radius: 6px;
            margin-bottom: 8px;
            background: var(--background-primary-alt);
            min-height: 60px;
        }

        .hydrate-mcp-server-info {
            flex: 1;
            min-width: 0;
            margin-right: 16px;
        }

        .hydrate-mcp-server-title {
            font-weight: 500;
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 16px;
        }

        .hydrate-mcp-health {
            font-size: 14px;
            cursor: help;
        }

        .hydrate-mcp-health.healthy {
            color: var(--text-success, #22c55e);
        }

        .hydrate-mcp-health.unhealthy {
            color: var(--text-error, #ef4444);
        }

        .hydrate-mcp-health.starting,
        .hydrate-mcp-health.stopping,
        .hydrate-mcp-health.unknown {
            color: var(--text-warning, #f59e0b);
        }

        .hydrate-mcp-health.disabled,
        .hydrate-mcp-health.stopped {
            color: var(--text-muted, #6b7280);
        }

        .hydrate-mcp-server-details {
            font-size: 0.85em;
            color: var(--text-muted, #6b7280);
        }

        .hydrate-mcp-server-controls {
            display: flex;
            align-items: center;
            gap: 16px;
            flex-shrink: 0;
        }

        .hydrate-mcp-toggle {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 80px;
        }

        .hydrate-mcp-checkbox {
            margin: 0;
        }

        .hydrate-mcp-enabled {
            color: var(--text-success, #22c55e);
            font-weight: 500;
        }

        .hydrate-mcp-disabled {
            color: var(--text-muted, #6b7280);
        }

        .hydrate-mcp-actions {
            display: flex;
            gap: 8px;
        }

        .hydrate-mcp-action-btn {
            padding: 6px 12px;
            font-size: 0.9em;
            border: 1px solid var(--background-modifier-border);
            border-radius: 4px;
            background: var(--background-primary);
            color: var(--text-normal);
            cursor: pointer;
            white-space: nowrap;
        }

        .hydrate-mcp-action-btn:hover {
            background: var(--background-modifier-hover);
        }

        /* Modal Configuration Styles */
        .mcp-config-example {
            margin-top: 16px;
            padding: 12px;
            background: var(--background-secondary);
            border-radius: 6px;
        }

        .mcp-config-example h3 {
            margin-top: 0;
            margin-bottom: 12px;
        }

        .mcp-config-example pre {
            margin: 4px 0;
            padding: 8px;
            background: var(--background-primary);
            border-radius: 4px;
            overflow-x: auto;
        }

        .mcp-config-example code {
            font-family: var(--font-monospace);
            font-size: 0.9em;
        }

        .mcp-config-info {
            margin-top: 16px;
            padding: 12px;
            background: var(--background-secondary);
            border-radius: 6px;
        }

        .mcp-config-info h4 {
            margin-top: 0;
            margin-bottom: 8px;
        }

        .mcp-config-info ul {
            margin: 0;
            padding-left: 16px;
        }

        .mcp-config-info li {
            margin-bottom: 4px;
        }

        .mcp-error {
            padding: 8px;
            background: var(--background-modifier-error);
            border-radius: 4px;
            border-left: 3px solid var(--text-error);
        }

        .modal-button-container {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 16px;
        }

        .modal-button-container button {
            padding: 8px 16px;
            border-radius: 4px;
            border: 1px solid var(--background-modifier-border);
            background: var(--background-primary);
            color: var(--text-normal);
            cursor: pointer;
        }

        .modal-button-container button:hover {
            background: var(--background-modifier-hover);
        }

        .modal-button-container .mod-cta {
            background: var(--interactive-accent);
            color: var(--text-on-accent);
            border-color: var(--interactive-accent);
        }

        .modal-button-container .mod-cta:hover {
            background: var(--interactive-accent-hover);
        }

    `;
	// Use Obsidian's mechanism to add/remove styles
	const styleId = "hydrate-settings-styles";
	let styleEl = document.getElementById(styleId);
	if (!styleEl) {
		styleEl = document.createElement("style");
		styleEl.id = styleId;
		styleEl.textContent = css;
		document.head.appendChild(styleEl);
		// Register cleanup using the plugin's register method
		plugin.register(() => styleEl?.remove());
	} else {
		// If style already exists, update its content
		styleEl.textContent = css;
	}
}
