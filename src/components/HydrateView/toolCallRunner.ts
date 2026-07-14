// Pure(ish) tool-call batching helpers extracted from processToolCalls.
// No Obsidian/view imports here — this stays unit-testable without a DOM.

import type { BackendToolCall, ToolResult } from "./backendTypes";
import { capToolResult } from "../../toolOutputLimits";
import { devLog } from "../../utils/logger";

export const EDIT_TOOLS: readonly string[] = [
	"editFile",
	"replaceSelectionInFile",
	"applyPatchesToFile",
];

export function partitionToolCalls(toolCalls: BackendToolCall[]): {
	editToolCalls: BackendToolCall[];
	otherToolCalls: BackendToolCall[];
} {
	const editToolCalls = toolCalls.filter((call) =>
		EDIT_TOOLS.includes(call.tool),
	);
	const otherToolCalls = toolCalls.filter(
		(call) => !EDIT_TOOLS.includes(call.tool),
	);
	return { editToolCalls, otherToolCalls };
}

export async function runNonEditToolCalls(
	toolCalls: BackendToolCall[],
	execute: (toolCall: BackendToolCall) => Promise<unknown>,
): Promise<ToolResult[]> {
	const results: ToolResult[] = [];
	for (const toolCall of toolCalls) {
		try {
			const result = await execute(toolCall);
			results.push({ id: toolCall.id, result: capToolResult(result) });
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
	return results;
}
