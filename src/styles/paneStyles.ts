import ProVibePlugin from "../main";

export function injectPaneStyles(plugin: ProVibePlugin) {
	const css = `
        /* --- ProVibe Pane Width Adjustment --- */

        /* Default grow for tabs when ProVibe pane is open (targets the sibling pane) */
        .workspace-split.mod-vertical:has(.workspace-leaf-content[data-type='provibe-view']) > .workspace-tabs {
            flex-grow: 0.65; /* Default grow for the other pane(s) */
        }

        /* Specific grow for the ProVibe pane */
        .workspace-split.mod-vertical > .workspace-tabs:has(.workspace-leaf-content[data-type='provibe-view']) {
            flex-grow: 0.35; /* Override default, aim for ~35% width */
            /* flex-basis removed as grow handles initial sizing */
        }
    `;

	const styleId = "provibe-pane-styles";
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
