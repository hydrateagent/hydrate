export interface HistoryMessage {
	type: "human" | "ai" | "tool" | "system"; // Langchain types
	content: string;
	// Optional fields from Langchain messages
	tool_calls?: { id: string; name: string; args: Record<string, unknown> }[];
	tool_call_id?: string;
}

export interface MCPToolInfo {
	server_id: string;
	server_name: string;
	is_mcp_tool: boolean;
}

export interface BackendToolCall {
	action: "tool_call";
	tool: string;
	params: Record<string, unknown>;
	id: string; // Tool call ID from the agent
	mcp_info?: MCPToolInfo; // Optional MCP routing information
}

export interface ContextStatus {
	estimated_tokens: number;
	percent_left: number;
	above_warning: boolean;
	above_autocompact: boolean;
}

export interface BackendResponse {
	agent_message?: HistoryMessage; // Now receives the full agent message
	// Update field name to match backend
	tool_calls_prepared?: BackendToolCall[]; // <<< CHANGED from tool_calls
	conversation_id: string; // ID is always returned
	context_status?: ContextStatus;
	/** Set by the backend when the conversation had expired server-side and was silently recreated. */
	conversation_restarted?: boolean;
}

// Interface for storing tool results with their IDs
export interface ToolResult {
	id: string;
	result: unknown;
}
