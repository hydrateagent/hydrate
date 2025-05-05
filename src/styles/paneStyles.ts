import HydratePlugin from "../main";

export function injectPaneStyles(plugin: HydratePlugin) {
	const css = `
        /* --- Hydrate Pane Width Adjustment --- */

        /* Default grow for tabs when Hydrate pane is open (targets the sibling pane) */
        .workspace-split.mod-vertical:has(.workspace-leaf-content[data-type='hydrate-view']) > .workspace-tabs {
            flex-grow: 0.65; /* Default grow for the other pane(s) */
        }

        /* Specific grow for the Hydrate pane */
        .workspace-split.mod-vertical > .workspace-tabs:has(.workspace-leaf-content[data-type='hydrate-view']) {
            flex-grow: 0.35; /* Override default, aim for ~35% width */
            /* flex-basis removed as grow handles initial sizing */
        }

        /* --- User Chat Bubble Text Selection --- */
        .hydrate-user-message::selection {
            background-color: #003bff; /* A distinct blue background for selection */
            color: #ffffff; /* White text for contrast */
        }

        /* For Firefox */
        .hydrate-user-message::-moz-selection {
            background-color: #007bff;
            color: #ffffff;
        }
    `;

	const styleId = "hydrate-pane-styles";
	let styleEl = document.getElementById(styleId);

	if (!styleEl) {
		styleEl = document.createElement("style");
		styleEl.id = styleId;
		styleEl.textContent = css;
		document.head.appendChild(styleEl);
		// Register cleanup using the plugin's register method
		plugin.register(() => styleEl?.remove());
	} else {
		// If style already exists, update its content (e.g., if settings change)
		styleEl.textContent = css;
	}
}
