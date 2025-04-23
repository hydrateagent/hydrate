// src/types.ts
import { App } from "obsidian";
import ProVibePlugin from "./main"; // Corrected path

export interface ReactViewProps {
	app: App;
	plugin: ProVibePlugin;
	filePath: string;
	markdownContent: string;
	updateMarkdownContent: (newContent: string) => Promise<boolean>;
	switchToMarkdownView: () => void;
}

// --- NEW: Format & Context Registry Types ---

/** Defines the type of content stored in a registry entry. */
export type RegistryEntryContentType = "markdown" | "json" | "text";

/** Represents a single entry in the Format & Context Registry. */
export interface RegistryEntry {
	id: string; // Unique identifier (e.g., UUID or user-defined)
	description: string; // User-friendly description of the entry
	version: number; // Simple version number, incremented on update
	contentType: RegistryEntryContentType; // Type of the content
	content: string; // The actual format, schema, or text
	slashCommandTrigger?: string; // Optional trigger (e.g., "/issue") - must start with '/' if defined
}
// --- END NEW ---

// --- Rules Registry Types ---

/** Represents a single rule in the Rules Registry. */
export interface RuleEntry {
	id: string; // Unique identifier, corresponds to a `provibe-rule` tag value
	description: string; // User-friendly description of the rule
	ruleText: string; // The actual rule text to inject into the agent context
	version: number; // Simple version number, incremented on update
}

// --- END Rules Registry Types ---

// --- Patch Type for applyPatchesToFile Tool ---

export interface Patch {
	before?: string; // Optional context before the edit
	after?: string; // Optional context after the edit
	old: string; // Text to be replaced (can be empty for insertions)
	new: string; // Replacement text (can be empty for deletions)
}

// --- END Patch Type ---
