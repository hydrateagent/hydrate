import type { MCPToolSchemaWithMetadata } from "../../mcp/MCPServerManager";
import { clampAttachedFile } from "../../toolOutputLimits";

export type ChatPayload = {
	message: string;
	conversation_id: string | null;
	model: string;
	mcp_tools: MCPToolSchemaWithMetadata[];
	// Resolved (default-or-override) limits — always sent, never omitted,
	// so backend and client agree on the active value for this request.
	max_input_tokens: number;
	max_output_tokens: number;
	images?: { data: string; mime_type: string }[];
	vault_instructions?: string;
	memory_index?: string;
};

/**
 * Wraps a single attached file's content for injection into the outgoing
 * message. Content is run through clampAttachedFile so oversized files are
 * head-clamped with a paging notice before hitting the wrapper.
 */
export function formatFileInjection(filePath: string, content: string): string {
	return `\n\n--- File Content: ${filePath} ---\n${clampAttachedFile(content)}\n--- End File Content ---`;
}

/**
 * Reproduces handleSend's exact concatenation/separator behavior: rules
 * context is prepended, file contents are appended with a blank-line
 * separator only when the combined message doesn't already end in one.
 */
export function combineMessageContent(
	originalMessage: string,
	rulesContext: string,
	fileContents: string,
): string {
	let combined = originalMessage;

	if (rulesContext) {
		combined = rulesContext + combined;
	}

	if (fileContents && fileContents.trim() !== "") {
		if (combined.length > 0 && !combined.endsWith("\n\n")) {
			combined += "\n\n";
		}
		combined += fileContents;
	}

	return combined;
}

export function buildChatPayload(opts: {
	message: string;
	conversationId: string | null;
	model: string;
	mcpTools: MCPToolSchemaWithMetadata[];
	maxInputTokens: number;
	maxOutputTokens: number;
	images?: { data: string; mime_type: string }[];
	vaultInstructions?: string;
	memoryIndex?: string;
}): ChatPayload {
	const payload: ChatPayload = {
		message: opts.message,
		conversation_id: opts.conversationId,
		model: opts.model,
		mcp_tools: opts.mcpTools,
		max_input_tokens: opts.maxInputTokens,
		max_output_tokens: opts.maxOutputTokens,
	};

	if (opts.images && opts.images.length > 0) {
		payload.images = opts.images;
	}

	if (opts.vaultInstructions) {
		payload.vault_instructions = opts.vaultInstructions;
	}

	if (opts.memoryIndex) {
		payload.memory_index = opts.memoryIndex;
	}

	return payload;
}
