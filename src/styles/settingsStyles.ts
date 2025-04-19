import ProVibePlugin from "../../main"; // Adjust path if needed

export function injectSettingsStyles(plugin: ProVibePlugin) {
  const css = `
        /* Settings Sections */
        .provibe-settings-section {
            border-top: 1px solid var(--background-modifier-border);
            padding-top: 20px;
            margin-top: 20px;
        }
        /* Heading with Action Button */
        .provibe-settings-heading {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 5px; /* Space below heading */
        }
        .provibe-settings-heading h3 {
            margin-bottom: 0; /* Remove default margin from h3 */
        }
         /* Input Error State */
        .provibe-input-error {
            border-color: var(--text-error) !important; /* More prominent error color */
            box-shadow: 0 0 0 1px var(--text-error) !important;
        }
        /* Tall setting item for Text Area in Modal */
        .provibe-registry-content-setting.is-tall .setting-item-control {
             height: auto; /* Allow text area to determine height */
             align-self: stretch;
        }
        .provibe-registry-content-setting.is-tall .setting-item-info {
             width: 100%; /* Ensure label takes full width */
             margin-bottom: var(--size-4-2); /* Obsidian variable for spacing */
        }
        .provibe-registry-content-setting.is-tall textarea {
            min-height: 150px; /* Ensure minimum height */
            height: 200px; /* Default height */
            resize: vertical; /* Allow vertical resize */
        }

         /* Modal button bar */
        .provibe-modal-button-bar .setting-item-control {
            display: flex;
            justify-content: flex-end; /* Align buttons to the right */
            gap: var(--size-4-2); /* Space between buttons */
        }

        /* Registry List Container */
        .provibe-registry-list {
            margin-top: 15px;
            border: 1px solid var(--background-modifier-border);
            border-radius: var(--radius-m); /* Use Obsidian radius variable */
            padding: 5px 0px 5px 15px; /* Padding inside container, less on right for buttons */
            max-height: 400px; /* Limit height and allow scrolling */
            overflow-y: auto;   /* Enable vertical scroll */
            background-color: var(--background-secondary); /* Subtle background */
        }
        /* Individual Registry Item */
        .provibe-registry-item {
             border-bottom: 1px solid var(--background-modifier-border);
             /* padding: 10px 0; */ /* Use Obsidian's default padding */
             /* margin: 0; */ /* Use Obsidian's default margin */
             align-items: center; /* Vertically align items */
        }
        .provibe-registry-item:last-child {
             border-bottom: none; /* No border for the last item */
        }
        /* Let description grow */
        .provibe-registry-item .setting-item-info {
            flex-grow: 1;
            margin-right: var(--size-4-2); /* Space before buttons */
        }
         /* Prevent buttons shrinking */
        .provibe-registry-item .setting-item-control {
             flex-shrink: 0;
             margin-left: auto; /* Push buttons to the right */
        }
        /* Message for empty list */
        .provibe-empty-list-message {
            color: var(--text-muted);
            padding: 15px;
            text-align: center;
            font-style: italic;
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
