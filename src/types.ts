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
