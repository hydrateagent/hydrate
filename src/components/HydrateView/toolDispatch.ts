import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import type { HydratePluginSettings } from "../../main";
import type { MCPServerManager } from "../../mcp/MCPServerManager";
import {
	toolReadFile,
	toolReplaceSelectionInFile,
	toolReadImage,
	toolFetchImage,
} from "./toolImplementations"; // Ensure this path is correct for your setup
import { handleSearchProject } from "../../toolHandlers"; // <<< ADD THIS IMPORT
import { devLog } from "../../utils/logger";
import type { BackendToolCall } from "./backendTypes";
import { MEMORIES_FOLDER, saveMemory, type SaveMemoryParams } from "../../memoryTools";

export interface ToolDispatchDeps {
	app: App;
	settings: HydratePluginSettings;
	mcpManager: MCPServerManager | null;
	// Optional so existing callers/tests that don't touch memory usage
	// tracking keep working unchanged. Wired from the view to the plugin's
	// saveSettings() so readFile-of-a-memory-path can persist the LRU bump.
	saveSettings?: () => Promise<void>;
}

export async function executeSingleTool(
	toolCall: BackendToolCall,
	deps: ToolDispatchDeps,
): Promise<unknown> {
	// Check if this is an MCP tool
	if (toolCall.mcp_info && toolCall.mcp_info.is_mcp_tool) {
		return await executeMCPTool(toolCall, deps);
	}

	// Handle native tools
	switch (toolCall.tool) {
		case "readFile": { // Match tool name from backend
			const path = toolCall.params.path as string;
			const result = await toolReadFile(
				deps.app,
				path,
				toolCall.params.offset as number | undefined,
				toolCall.params.limit as number | undefined,
			);
			// Usage (LRU) signal for buildMemoryIndex's eviction order — reads
			// are reads regardless of the enableMemories toggle, so this is
			// not gated on it. Only bump on a successful read (toolReadFile
			// throws above on failure, so reaching here means it succeeded).
			// Normalize before the prefix check and as the map key so
			// "./"-style variants bump the same canonical entry the
			// index builder lists (raw variants would silently miss or
			// create dead keys).
			{
				const canonical = normalizePath(path);
				if (canonical.startsWith(`${MEMORIES_FOLDER}/`)) {
					deps.settings.memoryLastUsed[canonical] = Date.now();
					await deps.saveSettings?.();
				}
			}
			return result;
		}
		case "save_memory":
			if (!deps.settings.enableMemories) {
				return "Memory saving is disabled in the plugin settings.";
			}
			return await saveMemory(
				deps.app,
				toolCall.params as unknown as SaveMemoryParams,
			);
		case "readImage":
			return await toolReadImage(
				deps.app,
				toolCall.params.path as string,
			);
		case "fetchImage":
			return await toolFetchImage(toolCall.params.url as string);
		case "replaceSelectionInFile": // <<< KEPT CASE (but now also goes through review)
			// This case should ideally not be hit directly anymore if filtering is correct,
			// but kept for safety. Review logic handles execution.
			devLog.warn(
				"executeSingleTool called for replaceSelectionInFile - should go through review.",
			);
			// Fallback to direct execution if somehow called directly (not ideal)
			return await toolReplaceSelectionInFile(
				deps.app,
				toolCall.params.path as string,
				toolCall.params.original_selection as string,
				toolCall.params.new_content as string,
			);
		case "search_project": {
			// handleSearchProject returns a full {id, result} envelope;
			// unwrap to the raw string so processToolCalls wraps it once
			// and capToolResult can bound it like every other tool.
			const searchOutcome = await handleSearchProject(
				toolCall,
				deps.app,
				deps.settings,
			);
			return searchOutcome.result;
		}

		default:
			throw new Error(
				`Unknown or unsupported tool for direct execution: ${toolCall.tool}`,
			);
	}
}

export async function executeMCPTool(
	toolCall: BackendToolCall,
	deps: ToolDispatchDeps,
): Promise<unknown> {
	if (!toolCall.mcp_info) {
		throw new Error("MCP tool call missing routing information");
	}

	// Check if MCPServerManager is available
	if (!deps.mcpManager) {
		throw new Error("MCP Server Manager not available");
	}

	try {
		// Validate parameters
		if (!toolCall.params || typeof toolCall.params !== "object") {
			throw new Error("Invalid parameters for MCP tool call");
		}

		// Unwrap kwargs if present (LangChain wraps MCP tool parameters in kwargs)
		let actualParams: Record<string, unknown> = toolCall.params;
		if (
			toolCall.params.kwargs &&
			typeof toolCall.params.kwargs === "object"
		) {
			actualParams = toolCall.params.kwargs as Record<
				string,
				unknown
			>;
		}

		// Execute the tool via MCPServerManager
		const result = await deps.mcpManager.executeToolCall(
			toolCall.mcp_info.server_id,
			toolCall.tool,
			actualParams,
		);

		return result;
	} catch (error) {
		devLog.error(
			`MCP tool execution failed for ${toolCall.tool}:`,
			error,
		);

		// Provide more specific error messages
		if (error instanceof Error) {
			if (error.message.includes("Server not found")) {
				throw new Error(
					`MCP server '${toolCall.mcp_info.server_name}' (${toolCall.mcp_info.server_id}) is not available. Please check server configuration.`,
				);
			} else if (error.message.includes("Tool not found")) {
				throw new Error(
					`Tool '${toolCall.tool}' not found on MCP server '${toolCall.mcp_info.server_name}'. The tool may have been removed or the server may need to be restarted.`,
				);
			} else if (error.message.includes("timeout")) {
				throw new Error(
					`MCP tool '${toolCall.tool}' timed out. The operation may be taking longer than expected.`,
				);
			}
		}

		throw new Error(
			`MCP tool execution failed: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}
