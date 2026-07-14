import type {
	BackendResponse,
	BackendToolCall,
	ContextStatus,
	HistoryMessage,
} from "./backendTypes";

/**
 * Formats a context-window status into the meter text + warning flag
 * displayed in the chat header. Mirrors the previous inline calculation
 * in `callBackend`.
 */
export function formatContextMeter(
	cs: ContextStatus,
): { text: string; warning: boolean } {
	return {
		text: `Context: ${Math.max(0, 100 - cs.percent_left).toFixed(0)}% used`,
		warning: cs.above_warning,
	};
}

/**
 * Reproduces the exact message the previous `callBackend` catch block
 * produced for a given thrown value:
 * - a real `Error` named "AbortError" -> cancellation message
 * - any other `Error` -> "Error: <message>"
 * - anything else (including non-Error objects that merely look like an
 *   AbortError) -> "Error: Unknown error", matching the original
 *   `error instanceof Error ? error.message : "Unknown error"` fallback.
 */
export function describeBackendError(error: unknown): string {
	if (error instanceof Error && error.name === "AbortError") {
		return "Request cancelled by user.";
	}
	const message = error instanceof Error ? error.message : "Unknown error";
	return `Error: ${message}`;
}

export interface BackendResponseHooks {
	setConversationId(id: string): void;
	onConversationRestarted(): void;
	updateContextMeter(state: { text: string; warning: boolean }): void;
	addAgentMessage(message: HistoryMessage): void | Promise<void>;
	processToolCalls(toolCalls: BackendToolCall[]): Promise<void>;
	setLoading(loading: boolean): void;
}

/**
 * Applies a parsed `BackendResponse` by invoking the supplied hooks in the
 * same order and under the same conditions as the original inline
 * `callBackend` handling:
 * 1. capture conversation_id
 * 2. surface a silent conversation restart (new)
 * 3. update the context meter, only if context_status is present
 * 4. EITHER process prepared tool calls (when non-empty) OR display the
 *    agent message (if any) and flip loading off -- these two are mutually
 *    exclusive, matching the original if/else.
 */
export async function applyBackendResponse(
	response: BackendResponse,
	hooks: BackendResponseHooks,
): Promise<void> {
	if (response.conversation_id) {
		hooks.setConversationId(response.conversation_id);
	}

	if (response.conversation_restarted) {
		hooks.onConversationRestarted();
	}

	if (response.context_status) {
		hooks.updateContextMeter(formatContextMeter(response.context_status));
	}

	if (
		response.tool_calls_prepared &&
		response.tool_calls_prepared.length > 0
	) {
		await hooks.processToolCalls(response.tool_calls_prepared);
	} else {
		if (response.agent_message) {
			await hooks.addAgentMessage(response.agent_message);
		}
		hooks.setLoading(false);
	}
}
