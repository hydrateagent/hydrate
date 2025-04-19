// src/components/PlaceholderView.tsx
import * as React from "react";
import { useState } from "react";
import { ReactViewProps } from "../types"; // Adjust path if needed

const PlaceholderView: React.FC<ReactViewProps> = ({
	app, // Can use app API if needed
	plugin, // Can use plugin settings/methods if needed
	filePath,
	markdownContent,
	updateMarkdownContent,
	switchToMarkdownView,
}) => {
	const [internalContent, setInternalContent] = useState(markdownContent);

	const handleSave = () => {
		console.log("PlaceholderView: Calling updateMarkdownContent");
		updateMarkdownContent(internalContent)
			.then(() => console.log("PlaceholderView: Update successful"))
			.catch((err) =>
				console.error("PlaceholderView: Update failed", err)
			);
	};

	const handleSwitchView = () => {
		console.log("PlaceholderView: Calling switchToMarkdownView");
		switchToMarkdownView();
	};

	const handleTextAreaChange = (
		event: React.ChangeEvent<HTMLTextAreaElement>
	) => {
		setInternalContent(event.target.value);
	};

	console.log("PlaceholderView: Rendering component for", filePath);

	return (
		<div className="p-4 font-sans">
			<h2 className="text-xl font-semibold mb-3">
				ProVibe Placeholder View
			</h2>
			<p className="mb-2">
				<strong>File Path:</strong> {filePath}
			</p>
			<p className="mb-2">
				<strong>Content Length:</strong> {markdownContent.length}{" "}
				characters
			</p>
			<p className="text-sm italic mb-4">
				(This is a basic React component replacing the standard Markdown
				view)
			</p>

			<hr className="my-4 border-[var(--background-modifier-border)]" />

			<h3 className="text-lg font-semibold mb-2">Edit Content:</h3>
			<textarea
				value={internalContent}
				onChange={handleTextAreaChange}
				rows={10}
				className="w-full mb-4 p-2 border border-[var(--background-modifier-border)] rounded bg-[var(--background-primary)] text-[var(--text-normal)] focus:border-[var(--interactive-accent)] focus:outline-none"
			/>

			<div className="flex gap-3">
				<button
					onClick={handleSave}
					className="px-3 py-1.5 bg-[var(--interactive-accent)] text-[var(--text-on-accent)] rounded hover:bg-[var(--interactive-accent-hover)] transition-colors duration-150"
				>
					Save Changes to File
				</button>
				<button
					onClick={handleSwitchView}
					className="px-3 py-1.5 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors duration-150"
				>
					Switch to Markdown View
				</button>
			</div>

			{/* You can add more complex React UI here */}
		</div>
	);
};

export default PlaceholderView;
