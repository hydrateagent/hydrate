import { App, TFile } from "obsidian";
import type HydratePlugin from "../../main";
import { DiffReviewModal, DiffReviewResult } from "../DiffReviewModal";
import { Patch } from "../../types";
import {
	toolReadFile,
	toolReplaceSelectionInFile,
} from "./toolImplementations";
import { handleSearchProject } from "../../toolHandlers";
import { devLog } from "../../utils/logger";
import { BackendToolCall, ToolResult } from "./BackendClient";
import { EDIT_TOOLS, TOOLS } from "../../constants";

/**
 * Callback type for adding messages to chat
 */
export type AddMessageCallback = (
	role: "user" | "agent" | "system",
	content: string,
) => void;

/**
 * Callback type for sending tool results back to backend
 */
export type SendToolResultsCallback = (results: ToolResult[]) => Promise<void>;

/**
 * Handles execution of tool calls from the backend.
 * Manages both native tools and MCP tools, including diff review for edit operations.
 */
export class ToolExecutor {
	private app: App;
	private plugin: HydratePlugin;
	private addMessage: AddMessageCallback;
	private sendResults: SendToolResultsCallback;

	constructor(
		app: App,
		plugin: HydratePlugin,
		addMessage: AddMessageCallback,
		sendResults: SendToolResultsCallback,
	) {
		this.app = app;
		this.plugin = plugin;
		this.addMessage = addMessage;
		this.sendResults = sendResults;
	}

	/**
	 * Process multiple tool calls, separating edit tools (that need review) from direct execution tools
	 */
	async processToolCalls(toolCalls: BackendToolCall[]): Promise<void> {
		// Add tool call indication to chat for each tool being called
		for (const toolCall of toolCalls) {
			const toolDisplayName = toolCall.mcp_info?.server_name
				? `${toolCall.tool} (${toolCall.mcp_info.server_name})`
				: toolCall.tool;
			this.addMessage("system", `Calling tool: ${toolDisplayName}`);
		}

		// Separate tool calls that need review from those that can execute directly
		const editToolCalls = toolCalls.filter((call) =>
			(EDIT_TOOLS as readonly string[]).includes(call.tool),
		);
		const otherToolCalls = toolCalls.filter(
			(call) => !(EDIT_TOOLS as readonly string[]).includes(call.tool),
		);

		const results: ToolResult[] = [];

		// Process edit tools through review modal
		if (editToolCalls.length > 0) {
			try {
				const editResults = await this.reviewAndExecuteEdits(editToolCalls);
				results.push(...editResults);
			} catch (error) {
				devLog.error("Error processing edit tools:", error);
				for (const call of editToolCalls) {
					results.push({
						id: call.id,
						result: `Error: ${
							error instanceof Error ? error.message : String(error)
						}`,
					});
				}
			}
		}

		// Process other tools directly
		for (const toolCall of otherToolCalls) {
			try {
				const result = await this.executeSingleTool(toolCall);
				results.push({ id: toolCall.id, result });
			} catch (error) {
				devLog.error(`Error executing tool ${toolCall.tool}:`, error);
				results.push({
					id: toolCall.id,
					result: `Error: ${
						error instanceof Error ? error.message : String(error)
					}`,
				});
			}
		}

		// Send all results back to backend
		await this.sendResults(results);
	}

	/**
	 * Review and execute edit tool calls through the diff modal
	 */
	private async reviewAndExecuteEdits(
		pendingEdits: BackendToolCall[],
	): Promise<ToolResult[]> {
		const results: ToolResult[] = [];

		for (const toolCall of pendingEdits) {
			try {
				const reviewResult = await this.displayDiffModalForReview(toolCall);

				if (reviewResult.applied) {
					try {
						const file = this.app.vault.getAbstractFileByPath(
							toolCall.params.path as string,
						);
						if (file instanceof TFile) {
							await this.app.vault.modify(
								file,
								reviewResult.finalContent || "",
							);
						} else {
							await this.app.vault.create(
								toolCall.params.path as string,
								reviewResult.finalContent || "",
							);
						}

						results.push({
							id: toolCall.id,
							result: `Successfully applied changes to ${String(
								toolCall.params.path,
							)}. ${reviewResult.message || ""}`,
						});
					} catch (writeError) {
						devLog.error(
							`Failed to write changes to ${String(toolCall.params.path)}:`,
							writeError,
						);
						results.push({
							id: toolCall.id,
							result: `Error writing changes to ${String(
								toolCall.params.path,
							)}: ${
								writeError instanceof Error
									? writeError.message
									: String(writeError)
							}`,
						});
					}
				} else {
					results.push({
						id: toolCall.id,
						result: `Edit rejected: ${
							reviewResult.message || "User declined changes"
						}`,
					});
				}
			} catch (error) {
				devLog.error(`Error in review process for ${toolCall.tool}:`, error);
				results.push({
					id: toolCall.id,
					result: `Error during review: ${
						error instanceof Error ? error.message : String(error)
					}`,
				});
			}
		}

		return results;
	}

	/**
	 * Display the diff review modal for an edit tool call
	 */
	private displayDiffModalForReview(
		toolCall: BackendToolCall,
	): Promise<DiffReviewResult> {
		return new Promise((resolve) => {
			void (async () => {
				const targetPath: string =
					typeof toolCall.params.path === "string"
						? toolCall.params.path
						: "unknown";
				const toolName: string =
					typeof toolCall.tool === "string" ? toolCall.tool : "edit";
				const instructions =
					(toolCall.params.instructions as string) ||
					`Apply ${toolName} to ${targetPath}`;

				let originalContent = "";
				let proposedContent = "";
				const simulationErrors: string[] = [];

				try {
					const file = this.app.vault.getAbstractFileByPath(targetPath);
					if (file instanceof TFile) {
						originalContent = await this.app.vault.read(file);
					} else {
						originalContent = "";
					}

					// Determine proposed content based on the tool type
					if (toolCall.tool === TOOLS.EDIT_FILE) {
						proposedContent = (toolCall.params.code_edit as string) || "";
					} else if (toolCall.tool === TOOLS.REPLACE_SELECTION) {
						const original_selection = toolCall.params
							.original_selection as string;
						const new_content = toolCall.params.new_content as string;
						if (!originalContent.includes(original_selection)) {
							devLog.warn(
								`Original selection for replaceSelectionInFile not found in ${String(targetPath)}. Diff may be inaccurate.`,
							);
						}
						proposedContent = originalContent.replace(
							original_selection,
							new_content,
						);
					} else if (toolCall.tool === TOOLS.APPLY_PATCHES) {
						const patches = toolCall.params.patches as Patch[];
						if (!Array.isArray(patches)) {
							throw new Error("Invalid patches data for applyPatchesToFile.");
						}
						proposedContent = this.simulatePatches(
							originalContent,
							patches,
							simulationErrors,
						);
					} else {
						proposedContent = `Error: Unexpected tool type '${toolCall.tool}' for diff review.`;
					}

					if (simulationErrors.length > 0) {
						devLog.error(
							"Simulation failed, cannot show diff modal reliably.",
							simulationErrors,
						);
						resolve({
							applied: false,
							message: `Could not apply patches due to context errors: ${simulationErrors.join(", ")}`,
							finalContent: originalContent,
							toolCallId: toolCall.id,
						});
						return;
					}

					new DiffReviewModal(
						this.app,
						this.plugin,
						targetPath,
						originalContent,
						proposedContent,
						instructions,
						toolCall.id,
						(result: DiffReviewResult) => {
							resolve(result);
						},
					).open();
				} catch (error) {
					devLog.error(
						`Error preparing data for DiffReviewModal for ${String(targetPath)}:`,
						error,
					);
					resolve({
						applied: false,
						message: `Error preparing diff review: ${(error as Error).message}`,
						finalContent: originalContent,
						toolCallId: toolCall.id,
					});
				}
			})();
		});
	}

	/**
	 * Simulate applying patches to content for preview
	 */
	private simulatePatches(
		content: string,
		patches: Patch[],
		errors: string[],
	): string {
		let simulatedContent = content;

		for (const patch of patches) {
			const before = patch.before ?? "";
			const oldText = patch.old;
			const after = patch.after ?? "";
			const newText = patch.new;
			const contextString = before + oldText + after;
			const contextIndex = simulatedContent.indexOf(contextString);

			if (contextIndex === -1) {
				devLog.error(
					`Context not found during simulation. Searching for:\n${JSON.stringify(contextString)}`,
				);
				errors.push("Context not found for patch.");
				continue;
			}

			if (
				contextString &&
				simulatedContent.indexOf(contextString, contextIndex + 1) !== -1
			) {
				devLog.warn(
					`Ambiguous context for patch found during simulation: ${JSON.stringify(patch)}`,
				);
				errors.push("Ambiguous context for patch.");
				continue;
			}

			const startIndex = contextIndex + before.length;
			const endIndex = startIndex + oldText.length;
			simulatedContent =
				simulatedContent.substring(0, startIndex) +
				newText +
				simulatedContent.substring(endIndex);
		}

		return simulatedContent;
	}

	/**
	 * Execute a single tool call (non-edit tools)
	 */
	private async executeSingleTool(toolCall: BackendToolCall): Promise<unknown> {
		// Check if this is an MCP tool
		if (toolCall.mcp_info && toolCall.mcp_info.is_mcp_tool) {
			return await this.executeMCPTool(toolCall);
		}

		// Handle native tools
		switch (toolCall.tool) {
			case TOOLS.READ_FILE:
				return await toolReadFile(this.app, toolCall.params.path as string);

			case TOOLS.REPLACE_SELECTION:
				devLog.warn(
					"executeSingleTool called for replaceSelectionInFile - should go through review.",
				);
				return await toolReplaceSelectionInFile(
					this.app,
					toolCall.params.path as string,
					toolCall.params.original_selection as string,
					toolCall.params.new_content as string,
				);

			case TOOLS.SEARCH_PROJECT:
				return await handleSearchProject(
					toolCall,
					this.app,
					this.plugin.settings,
				);

			default:
				throw new Error(
					`Unknown or unsupported tool for direct execution: ${toolCall.tool}`,
				);
		}
	}

	/**
	 * Execute an MCP tool call
	 */
	private async executeMCPTool(toolCall: BackendToolCall): Promise<unknown> {
		if (!toolCall.mcp_info) {
			throw new Error("MCP tool call missing routing information");
		}

		if (!this.plugin.mcpManager) {
			throw new Error("MCP Server Manager not available");
		}

		try {
			if (!toolCall.params || typeof toolCall.params !== "object") {
				throw new Error("Invalid parameters for MCP tool call");
			}

			// Unwrap kwargs if present (LangChain wraps MCP tool parameters in kwargs)
			let actualParams: Record<string, unknown> = toolCall.params;
			if (
				toolCall.params.kwargs &&
				typeof toolCall.params.kwargs === "object"
			) {
				actualParams = toolCall.params.kwargs as Record<string, unknown>;
			}

			const result = await this.plugin.mcpManager.executeToolCall(
				toolCall.mcp_info.server_id,
				toolCall.tool,
				actualParams,
			);

			return result;
		} catch (error) {
			devLog.error(`MCP tool execution failed for ${toolCall.tool}:`, error);

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
}

/**
 * Creates a ToolExecutor instance
 */
export function createToolExecutor(
	app: App,
	plugin: HydratePlugin,
	addMessage: AddMessageCallback,
	sendResults: SendToolResultsCallback,
): ToolExecutor {
	return new ToolExecutor(app, plugin, addMessage, sendResults);
}
