import ProVibePlugin from "../main";

export function injectPaneStyles(plugin: ProVibePlugin) {
	const css = `
        /* --- ProVibe Pane Width Adjustment --- */

        /* Target the workspace-tabs container within a vertical split *if* it contains the provibe-view */
        .workspace-split.mod-vertical > .workspace-tabs:has(.workspace-leaf-content[data-type='provibe-view']) {
            /* Set the basis to 35% and prevent growing/shrinking disproportionately */
            flex-basis: 35% !important;
            flex-grow: 0 !important; /* Prevent growing beyond basis */
            /* width: 35% !important; /* Alternative if flex-basis fails */
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
