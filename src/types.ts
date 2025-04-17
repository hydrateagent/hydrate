// src/types.ts
import { App } from "obsidian";
import ProVibePlugin from "../main"; // Adjust path if needed

export interface ReactViewProps {
	app: App;
	plugin: ProVibePlugin;
	filePath: string;
	markdownContent: string;
	updateMarkdownContent: (
		newContent: string, // Full content (still needed as fallback)
		lineIndex?: number, // Optional line index for targeted update
		newLineContent?: string // Optional new content for that specific line
	) => Promise<void>;
	switchToMarkdownView: () => void;
}
