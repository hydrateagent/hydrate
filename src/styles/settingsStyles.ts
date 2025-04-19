import ProVibePlugin from "../../main"; // Adjust path if needed

export function injectSettingsStyles(plugin: ProVibePlugin) {
	// Consolidate all CSS rules here, removing duplicates
	// These setting are used to override pesky Obsidian styles that otherwise cannot be
	const css = `
        /* --- General Settings Styles --- */
        .provibe-settings-section {
            border-top: 1px solid var(--background-modifier-border);
            padding-top: 20px;
            margin-top: 20px;
        }
        .provibe-settings-heading {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 5px; /* Space below heading */
        }
        .provibe-settings-heading h3 {
            margin-bottom: 0; /* Remove default margin from h3 */
        }

        /* --- Input Error State --- */
        .provibe-input-error {
            /* Using more specific theme variable */
            border-color: var(--text-error) !important;
            box-shadow: 0 0 0 1px var(--text-error) !important;
        }

        /* --- Registry List Styles --- */
        .provibe-registry-list {
            margin-top: 15px;
            border: 1px solid var(--background-modifier-border);
            border-radius: var(--radius-m);
            padding: 5px 0px 5px 15px;
            max-height: 400px;
            overflow-y: auto;
            background-color: var(--background-secondary);
        }
        .provibe-registry-item {
             border-bottom: 1px solid var(--background-modifier-border);
             align-items: center;
        }
        .provibe-registry-item:last-child {
             border-bottom: none;
        }
        .provibe-registry-item .setting-item-info {
            flex-grow: 1;
            margin-right: var(--size-4-2);
        }
        .provibe-registry-item .setting-item-control {
             flex-shrink: 0;
             margin-left: auto;
        }
        .provibe-empty-list-message {
            color: var(--text-muted);
            padding: 15px;
            text-align: center;
            font-style: italic;
        }

        /* --- Registry Edit Modal Styles --- */

        /* Wider Modal */
        .provibe-registry-edit-modal-wide .modal {
            width: 70%; /* Adjust width as desired */
            max-width: 900px; /* Set a maximum width */
        }

        /* Vertical Layout for the Custom Content Setting */
        .setting-item.provibe-content-setting-vertical {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            width: 100%;
            /* Remove default setting padding that might interfere */
            padding-top: 0;
            padding-bottom: 0;
        }

        /* Content Setting Info Block (Label + Description) */
        .provibe-content-setting-vertical .setting-item-info {
            width: 100%; /* Take full width */
            /* Remove default right margin if any */
            margin-right: 0;
            margin-bottom: var(--size-4-2); /* Space below the description */
        }

        /* Content Setting Control Block (Textarea Container) */
        .provibe-content-setting-vertical .setting-item-control {
            width: 100%; /* Take full width */
        }

        /* Content Text Area Specific Styling */
        .provibe-content-textarea {
            width: 100%;
            min-height: 250px; /* Set desired minimum height */
            resize: vertical; /* Allow vertical resizing */
            font-family: var(--font-monospace); /* Use monospace font */
            margin-top: var(--size-4-1); /* Small space above textarea */
            border: 1px solid var(--background-modifier-border); /* Add border for clarity */
            border-radius: var(--radius-s); /* Small radius */
        }

        /* Modal Button Bar Alignment */
        .provibe-modal-button-bar {
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
        .provibe-modal-button-bar .setting-item-info {
            display: none;
        }

        /* Ensure control block for buttons doesn't take unnecessary space */
        .provibe-modal-button-bar .setting-item-control {
            width: auto; /* Let buttons determine width */
            flex-grow: 0; /* Prevent it from growing */
        }

    `;
	// Use Obsidian's mechanism to add/remove styles
	const styleId = "provibe-settings-styles";
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
