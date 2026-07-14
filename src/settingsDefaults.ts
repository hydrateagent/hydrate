import type { HydratePluginSettings } from "./main"; // type-only: no runtime cycle
import type { RuleEntry } from "./types";

// Default content for the /issue command
const DEFAULT_ISSUE_COMMAND_CONTENT = `When creating an issue, use the following guide exactly.  Otherwise the content will not be viewable. Items that are in [] must be verbatim  Items that are in {} should be replaced with content.  instructional comments below are in (), do not include them in your output.  The markdown structure must be followed exactly, including the yaml header:

---
hydrate-plugin: issue-board
---

# {Category} (not necessary for each Issue, groups multiple Issues)

## {New Issue Title} (give it a name)
- {issue-number-placeholder}  (assign a number)
### Items (must be this exact word)
- item 1 (content about the issue)
- item 2 (content about the issue)
### Status (must be this exact word, and everything below)
- [ ] Specced
- [ ] Built
- [ ] Tested
- [ ] Deployed
`;

// --- Default Rule Content ---
const DEFAULT_CONVERSATION_RULE_TEXT = `This rules controls how text can be added to this file.  Whenever the user asks for an edit to this file, he wants you to follow the following rules. This file is structured as a conversation between you and the user.  It must be structured with alternating headers, noting who is to speaking:


## User

<their questions go here>

## Agent

<your responses go here>


This alternating pattern should repeat down the page.  When the user makes their input, you answer with an edit that appends the new exchange to the end of the file:

1) First their question under a new User heading
2) Next your answer under a new Agent heading.`;

export const DEFAULT_CONVERSATION_RULE: RuleEntry = {
	id: "default-conversation-rule", // The ID used in `hydrate-rule: [default-conversation-rule]` tag
	description: "Example rule: Structure file as User/Agent conversation.",
	ruleText: DEFAULT_CONVERSATION_RULE_TEXT,
	version: 1,
};
// --- End Default Rule Content ---

export const DEFAULT_SETTINGS: HydratePluginSettings = {
	developmentPath: "", // <<< ADDED default empty developmentPath set dynamically
	backendUrl: "", // Empty default - getBackendUrl() handles dev vs prod
	registryEntries: [], // Existing initialization
	rulesRegistryEntries: [], // <<< Initialized as empty
	chatHistories: [], // Initialize chat histories as empty
	selectedModel: "gpt-5.4-mini", // Set default model
	apiKey: "", // <<< ADDED default empty API Key (deprecated, kept for compatibility)

	// --- BYOK Subscription Settings ---
	licenseKey: "", // Default to empty (free tier)
	openaiApiKey: "", // Default to empty
	anthropicApiKey: "", // Default to empty
	googleApiKey: "", // Default to empty

	// --- NEW: Default values for Remote Embeddings ---
	enableRemoteEmbeddings: false, // Default to disabled
	remoteEmbeddingUrl: "https://api.openai.com/v1/embeddings", // Default to OpenAI endpoint
	remoteEmbeddingApiKey: "", // Default to empty
	remoteEmbeddingModelName: "text-embedding-3-small", // Default to OpenAI's model
	indexFileExtensions: "md", // Default to only markdown
	mcpServers: [], // Initialize mcpServers
	mcpCustomPaths: "/usr/local/bin,/opt/homebrew/bin", // Default common paths

	enableVaultInstructions: true,
};

/**
 * Merges raw persisted data (from `loadData()`) over `DEFAULT_SETTINGS` and
 * repairs known-corruptible fields (registryEntries, rulesRegistryEntries,
 * chatHistories), exactly mirroring the old `HydratePlugin.loadSettings()`
 * repair logic.
 *
 * The base merge starts from a shallow copy of DEFAULT_SETTINGS' array
 * fields (not the singleton arrays themselves) so that repairs below -
 * which push() onto `settings.<field>` in place - never mutate the
 * exported DEFAULT_SETTINGS constant. When `raw` supplies its own array
 * for one of these fields, that array's reference is used as-is via
 * Object.assign (and may be mutated in place by the repair below), matching
 * the old behavior exactly.
 */
export function normalizeSettings(raw: unknown): HydratePluginSettings {
	const defaultsBase: HydratePluginSettings = {
		...DEFAULT_SETTINGS,
		registryEntries: [...DEFAULT_SETTINGS.registryEntries],
		rulesRegistryEntries: [...DEFAULT_SETTINGS.rulesRegistryEntries],
		chatHistories: [...DEFAULT_SETTINGS.chatHistories],
		mcpServers: [...DEFAULT_SETTINGS.mcpServers],
	};

	const settings: HydratePluginSettings = Object.assign(
		{},
		defaultsBase,
		(raw ?? {}) as Partial<HydratePluginSettings>,
	);

	// --- Initialize Default Format Registry Entry ---
	// Ensure array exists
	if (
		!settings.registryEntries ||
		!Array.isArray(settings.registryEntries)
	) {
		// If empty or not an array, initialize it with the default entry
		settings.registryEntries = [
			{
				id: "default-issue-board",
				description:
					"Default template for creating an issue board.",
				version: 1,
				contentType: "markdown",
				content: DEFAULT_ISSUE_COMMAND_CONTENT,
				slashCommandTrigger: "/issue",
			},
		];
	} else {
		// If it exists as an array, check if the default entry is present
		const defaultIssueExists = settings.registryEntries.some(
			(entry) =>
				entry.id === "default-issue-board" ||
				entry.slashCommandTrigger === "/issue",
		);
		if (!defaultIssueExists) {
			// Add it if missing
			settings.registryEntries.push({
				id: "default-issue-board",
				description:
					"Default template for creating an issue board.",
				version: 1,
				contentType: "markdown",
				content: DEFAULT_ISSUE_COMMAND_CONTENT,
				slashCommandTrigger: "/issue",
			});
		}
	}
	// --- End Initialize Default Format Registry Entry ---

	// --- Initialize Default Rules Registry Entry ---
	// Ensure array exists
	if (
		!settings.rulesRegistryEntries ||
		!Array.isArray(settings.rulesRegistryEntries)
	) {
		// Initialize with the default rule if empty or invalid
		settings.rulesRegistryEntries = [DEFAULT_CONVERSATION_RULE];
	} else {
		// Check if the default conversation rule is present if array already exists
		const defaultConversationRuleExists =
			settings.rulesRegistryEntries.some(
				(rule) => rule.id === DEFAULT_CONVERSATION_RULE.id,
			);
		if (!defaultConversationRuleExists) {
			settings.rulesRegistryEntries.push(DEFAULT_CONVERSATION_RULE);
		}
	}
	// --- End Initialize Default Rules Registry Entry ---

	// --- Initialize Chat Histories Array ---
	if (
		!settings.chatHistories ||
		!Array.isArray(settings.chatHistories)
	) {
		settings.chatHistories = [];
	}
	// --- End Initialize Chat Histories Array ---

	return settings;
}
