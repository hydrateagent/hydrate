import { App, Notice } from "obsidian";
// Assuming HydratePluginSettings is defined in main.ts or a types.ts file
// and VectorIndexSettings is compatible or part of HydratePluginSettings.
// For now, let's assume HydratePluginSettings can be passed to searchIndexRemote.
import { HydratePluginSettings } from "./main"; // Adjust path if settings are in types.ts
import { searchIndexRemote, VectorIndexSettings } from "./vectorIndex";
import { devLog } from "./utils/logger";

// Interface for the structure of tool call parameters for search_project
interface SearchProjectParams {
	query: string;
	explanation?: string;
	target_directories?: string[]; // This is defined in the Python tool
}

// Interface for the incoming tool call object from the agent/FastAPI
// (align with how it's structured in main.ts when processing agent_response_data.tool_calls_prepared)
interface AgentToolCall {
	id: string;
	tool: string;
	params: SearchProjectParams | Record<string, unknown>; // Use Record<string, unknown> for params if other tools have different structures
}

// Interface for the result structure to be sent back to the agent
interface ToolResult {
	id: string;
	result: string;
}

export async function handleSearchProject(
	call: AgentToolCall,
	app: App, // app might be needed by searchIndexRemote or its dependencies indirectly
	settings: HydratePluginSettings, // Assuming HydratePluginSettings is compatible with VectorIndexSettings
	topN: number = 5, // Default number of results to return
): Promise<ToolResult> {
	const params = call.params as SearchProjectParams;

	if (!params.query) {
		devLog.warn("[Hydrate Plugin] search_project called without a query.");
		new Notice("Search project: Query is missing.");
		return {
			id: call.id,
			result: "Error: search_project called without a query parameter.",
		};
	}

	try {
		// Validate required settings for remote embeddings
		if (!settings.enableRemoteEmbeddings) {
			const errorMsg =
				"Remote embeddings are not enabled. Cannot perform project search.";
			devLog.error(`[Hydrate Plugin] ${errorMsg}`);
			new Notice(errorMsg);
			throw new Error(errorMsg);
		}
		if (
			!settings.remoteEmbeddingUrl ||
			!settings.remoteEmbeddingApiKey ||
			!settings.remoteEmbeddingModelName
		) {
			const errorMsg =
				"Remote embedding settings are incomplete. Cannot perform project search.";
			devLog.error(`[Hydrate Plugin] ${errorMsg}`);
			new Notice(errorMsg);
			throw new Error(errorMsg);
		}

		// Note: searchIndexRemote currently expects VectorIndexSettings.
		// We are passing HydratePluginSettings. Ensure they are compatible
		// or refactor settings handling if necessary.
		// Also, searchIndexRemote does not currently use target_directories.
		// If target_directories functionality is needed, searchIndexRemote
		// and potentially Vectra querying logic will need to be updated.

		const searchResults = await searchIndexRemote(
			params.query,
			settings as VectorIndexSettings, // Casting, ensure compatibility
			topN,
		);

		let resultSummary: string;
		if (searchResults.length > 0) {
			const snippets = searchResults
				.map(
					(chunk) =>
						`- File: ${chunk.filePath} (Score: ${
							chunk.score?.toFixed(4) || "N/A"
						})`,
				)
				.join("\n");
			resultSummary = `Found ${searchResults.length} relevant snippet(s) for "${params.query}":\n${snippets}`;
		} else {
			resultSummary = `No relevant snippets found for your query: "${params.query}"`;
		}

		return {
			id: call.id,
			result: resultSummary,
		};
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : String(error);
		devLog.error(
			`[Hydrate Plugin] Error executing search_project for query "${params.query}":`,
			error,
		);
		new Notice(`Project Search Error: ${errorMessage}`);
		return {
			id: call.id,
			result: `Error during project search for query "${params.query}": ${errorMessage}`,
		};
	}
}
