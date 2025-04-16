// src/types.ts
import { App } from "obsidian";
import ProVibePlugin from "../main"; // Adjust path if needed

export interface ReactViewProps {
	app: App;
	plugin: ProVibePlugin;
	filePath: string;
	markdownContent: string;
	updateMarkdownContent: (newContent: string) => Promise<void>;
	switchToMarkdownView: () => void;
}
