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
		<div style={{ padding: "10px", fontFamily: "sans-serif" }}>
			<h2>ProVibe Placeholder View</h2>
			<p>
				<strong>File Path:</strong> {filePath}
			</p>
			<p>
				<strong>Content Length:</strong> {markdownContent.length}{" "}
				characters
			</p>
			<p>
				<em>
					(This is a basic React component replacing the standard
					Markdown view)
				</em>
			</p>

			<hr style={{ margin: "15px 0" }} />

			<h3>Edit Content:</h3>
			<textarea
				value={internalContent}
				onChange={handleTextAreaChange}
				rows={10}
				style={{ width: "100%", marginBottom: "10px" }}
			/>

			<div style={{ display: "flex", gap: "10px" }}>
				<button onClick={handleSave}>Save Changes to File</button>
				<button onClick={handleSwitchView}>
					Switch to Markdown View
				</button>
			</div>

			{/* You can add more complex React UI here */}
		</div>
	);
};

export default PlaceholderView;
