import { requestUrl, Notice } from "obsidian";
import type HydratePlugin from "../../main";
import { devLog } from "../../utils/logger";
import { MCPToolSchemaWithMetadata } from "../../mcp/MCPServerManager";
import { setLoadingState, addMessageToChat } from "./domUtils";

/**
 * Interface for history messages from the backend
 */
export interface HistoryMessage {
	type: "human" | "ai" | "tool" | "system";
	content: string;
	tool_calls?: { id: string; name: string; args: Record<string, unknown> }[];
	tool_call_id?: string;
}

/**
 * MCP tool routing information
 */
export interface MCPToolInfo {
	server_id: string;
	server_name: string;
	is_mcp_tool: boolean;
}

/**
 * Tool call from the backend
 */
export interface BackendToolCall {
	action: "tool_call";
	tool: string;
	params: Record<string, unknown>;
	id: string;
	mcp_info?: MCPToolInfo;
}

/**
 * Response from the backend
 */
export interface BackendResponse {
	agent_message?: HistoryMessage;
	tool_calls_prepared?: BackendToolCall[];
	conversation_id: string;
}

/**
 * Tool result to send back to backend
 */
export interface ToolResult {
	id: string;
	result: unknown;
}

/**
 * Type for backend request headers - uses index signature for compatibility with requestUrl
 */
type RequestHeaders = Record<string, string>;

/**
 * Handles all communication with the Hydrate backend.
 * Centralizes authentication headers, error handling, and request lifecycle.
 */
export class BackendClient {
	private plugin: HydratePlugin;
	private abortController: AbortController | null = null;

	constructor(plugin: HydratePlugin) {
		this.plugin = plugin;
	}

	/**
	 * Builds authentication headers for backend requests
	 */
	private buildHeaders(): RequestHeaders {
		const headers: RequestHeaders = {
			"Content-Type": "application/json",
		};

		// Legacy API key for backward compatibility
		if (this.plugin.settings.apiKey) {
			headers["X-API-Key"] = this.plugin.settings.apiKey;
		}

		// License key for paid tiers
		if (this.plugin.settings.licenseKey) {
			headers["X-License-Key"] = this.plugin.settings.licenseKey;
		}

		// User API keys for BYOK
		if (this.plugin.settings.openaiApiKey) {
			headers["X-OpenAI-Key"] = this.plugin.settings.openaiApiKey;
		}
		if (this.plugin.settings.anthropicApiKey) {
			headers["X-Anthropic-Key"] = this.plugin.settings.anthropicApiKey;
		}
		if (this.plugin.settings.googleApiKey) {
			headers["X-Google-Key"] = this.plugin.settings.googleApiKey;
		}

		return headers;
	}

	/**
	 * Gets the loading message for a given endpoint
	 */
	private getLoadingMessage(endpoint: string): string {
		switch (endpoint) {
			case "/chat":
				return "Agent is thinking";
			case "/tool_result":
				return "Processing tool results";
			default:
				return "Processing request";
		}
	}

	/**
	 * Cancels any in-flight request
	 */
	public cancelRequest(): void {
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
	}

	/**
	 * Makes a request to the backend
	 */
	public async request<T = BackendResponse>(
		endpoint: string,
		payload: Record<string, unknown>,
	): Promise<T> {
		// Cancel any existing request
		this.cancelRequest();

		// Create new abort controller
		this.abortController = new AbortController();

		const url = `${this.plugin.getBackendUrl()}${endpoint}`;
		const headers = this.buildHeaders();

		try {
			const response = await requestUrl({
				url,
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				throw: false,
			});

			// Reset abort controller after completion
			this.abortController = null;

			if (response.status >= 400) {
				throw new Error(
					`HTTP ${response.status}: ${response.text || "Unknown error"}`,
				);
			}

			return response.json as T;
		} catch (error) {
			// Reset abort controller on error
			this.abortController = null;

			if (error instanceof Error && error.name === "AbortError") {
				throw new Error("Request cancelled by user");
			}

			throw error;
		}
	}

	/**
	 * Sends a chat message to the backend
	 */
	public async sendChatMessage(
		message: string,
		conversationId: string | null,
		mcpTools: MCPToolSchemaWithMetadata[],
	): Promise<BackendResponse> {
		const payload: Record<string, unknown> = {
			message,
			conversation_id: conversationId,
			model: this.plugin.getSelectedModel(),
			mcp_tools: mcpTools,
		};

		return this.request<BackendResponse>("/chat", payload);
	}

	/**
	 * Sends tool results back to the backend
	 */
	public async sendToolResults(
		results: ToolResult[],
		conversationId: string | null,
		mcpTools: MCPToolSchemaWithMetadata[],
	): Promise<BackendResponse> {
		const payload: Record<string, unknown> = {
			tool_results: results,
			conversation_id: conversationId,
			mcp_tools: mcpTools,
		};

		return this.request<BackendResponse>("/tool_result", payload);
	}

	/**
	 * Collects MCP tools from running servers
	 */
	public collectMCPTools(): MCPToolSchemaWithMetadata[] {
		if (!this.plugin.mcpManager) {
			devLog.warn("[BackendClient] No MCP Manager found!");
			return [];
		}

		try {
			return this.plugin.mcpManager.getAllDiscoveredTools();
		} catch (error) {
			devLog.warn("Error collecting MCP tools:", error);
			return [];
		}
	}
}

/**
 * Creates a BackendClient instance bound to a plugin
 */
export function createBackendClient(plugin: HydratePlugin): BackendClient {
	return new BackendClient(plugin);
}
