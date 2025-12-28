// src/types.ts
import { App } from "obsidian";
import HydratePlugin from "./main"; // Corrected path

export interface ReactViewProps {
	app: App;
	plugin: HydratePlugin;
	filePath: string;
	markdownContent: string;
	updateMarkdownContent: (newContent: string) => Promise<boolean>;
	switchToMarkdownView: () => Promise<void>;
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
	id: string; // Unique identifier, corresponds to a `hydrate-rule` tag value
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

// --- Image Attachment Types ---

/** Represents an attached image for chat messages (in-memory, base64) */
export interface ImageAttachment {
	data: string;      // base64-encoded image data (without data URI prefix)
	mimeType: string;  // e.g., "image/png", "image/jpeg", "image/webp", "image/gif"
	filename?: string; // optional original filename
}

/** Represents an image stored as a file in the vault (for chat history persistence) */
export interface StoredImageAttachment {
	vaultPath: string;  // e.g., ".hydrate/images/img_1703789123456_0.png"
	mimeType: string;
	filename?: string;
}

/** Union type for images that may be base64 or vault-stored */
export type ChatImage = ImageAttachment | StoredImageAttachment;

/** Type guard to check if an image is stored in vault */
export function isStoredImage(img: ChatImage): img is StoredImageAttachment {
	return "vaultPath" in img;
}

// --- END Image Attachment Types ---

// --- Chat History Types ---

/** Represents a single turn in a chat conversation */
export interface ChatTurn {
	role: "user" | "agent";
	content: string;
	images?: ChatImage[]; // optional images (base64 or vault-stored)
	timestamp: string; // ISO timestamp
}

/** Represents a complete saved chat history */
export interface ChatHistory {
	id: string; // Unique identifier for the chat
	title: string; // Display name for the chat (auto-generated from first user message)
	turns: ChatTurn[]; // All user/agent message exchanges
	conversationId: string | null; // Backend conversation ID if any
	attachedFiles: string[]; // File paths that were attached to this chat
	created: string; // ISO timestamp when chat was created
	lastModified: string; // ISO timestamp when chat was last updated
}

// --- END Chat History Types ---
