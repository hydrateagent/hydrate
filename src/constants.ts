/**
 * Centralized constants for the Hydrate plugin.
 * Consolidates magic strings, URLs, timeouts, and configuration values.
 */

// --- Backend URLs ---
export const BACKEND_URLS = {
	PRODUCTION: "https://api.hydrateagent.com",
	DEVELOPMENT: "http://localhost:8000",
} as const;

// --- Timeouts (in milliseconds) ---
export const TIMEOUTS = {
	/** Default request timeout */
	DEFAULT: 30_000,
	/** Timeout for long operations like file processing */
	LONG_OPERATION: 120_000,
	/** Timeout for indexing operations */
	INDEXING: 300_000,
	/** Debounce delay for vault changes */
	VAULT_CHANGE_DEBOUNCE: 5_000,
	/** Delay between suggestion refreshes */
	SUGGESTION_REFRESH_THROTTLE: 5_000,
} as const;

// --- UI Constants ---
export const UI = {
	/** Maximum characters for chat history title */
	CHAT_TITLE_MAX_LENGTH: 50,
	/** Number of recent chat turns to use for context suggestions */
	RECENT_TURNS_FOR_SUGGESTIONS: 6,
	/** Maximum search queries for context suggestions */
	MAX_SUGGESTION_QUERIES: 4,
	/** Maximum suggested notes to display */
	MAX_SUGGESTED_NOTES: 5,
} as const;

// --- Storage Keys ---
export const STORAGE_KEYS = {
	/** Key prefix for conversation state in Redis */
	CONVERSATION_PREFIX: "conversation:",
	/** Key for chat history in plugin settings */
	CHAT_HISTORY: "chatHistories",
} as const;

// --- View Types ---
export const VIEW_TYPES = {
	HYDRATE: "hydrate-view",
} as const;

// --- API Header Names ---
export const HEADERS = {
	API_KEY: "X-API-Key",
	LICENSE_KEY: "X-License-Key",
	OPENAI_KEY: "X-OpenAI-Key",
	ANTHROPIC_KEY: "X-Anthropic-Key",
	GOOGLE_KEY: "X-Google-Key",
} as const;

// --- Tool Names ---
export const TOOLS = {
	READ_FILE: "readFile",
	EDIT_FILE: "editFile",
	REPLACE_SELECTION: "replaceSelectionInFile",
	APPLY_PATCHES: "applyPatchesToFile",
	SEARCH_PROJECT: "search_project",
} as const;

// --- Edit Tools (tools that require diff review) ---
export const EDIT_TOOLS = [
	TOOLS.EDIT_FILE,
	TOOLS.REPLACE_SELECTION,
	TOOLS.APPLY_PATCHES,
] as const;
