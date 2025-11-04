import { EventEmitter } from "events";
import { MCPTransport } from "./MCPTransport";

/**
 * MCP Protocol message types
 */
export interface MCPRequest {
	jsonrpc: "2.0";
	id: string | number;
	method: string;
	params?: Record<string, unknown>;
}

export interface MCPResponse {
	jsonrpc: "2.0";
	id: string | number;
	result?: unknown;
	error?: {
		code: number;
		message: string;
		data?: unknown;
	};
}

export interface MCPNotification {
	jsonrpc: "2.0";
	method: string;
	params?: Record<string, unknown>;
}

export type MCPMessage = MCPRequest | MCPResponse | MCPNotification;

/**
 * MCP Tool schema interface
 */
export interface MCPToolSchema {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
	};
}

/**
 * MCP Client implementation following the Model Context Protocol
 */
export class MCPClient extends EventEmitter {
	public transport: MCPTransport;
	private connected = false;
	private requestId = 0;
	private pendingRequests = new Map<
		string | number,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
			timeout: NodeJS.Timeout;
		}
	>();
	private requestTimeout = 30000; // 30 seconds

	constructor(transport: MCPTransport) {
		super();
		this.transport = transport;
		this.setupTransportHandlers();
	}

	private setupTransportHandlers(): void {
		this.transport.on("connect", () => {
			this.connected = true;
			this.emit("connect");
		});

		this.transport.on("disconnect", (info?: unknown) => {
			this.connected = false;
			this.cleanupPendingRequests();
			this.emit("disconnect", info);
		});

		this.transport.on("error", (error: Error) => {
			this.emit("error", error);
		});

		this.transport.on("message", (message: MCPMessage) => {
			this.handleMessage(message);
		});

		this.transport.on("stderr", (data: string) => {
			this.emit("stderr", data);
		});
	}

	async connect(): Promise<void> {
		if (this.connected) {
			return;
		}

		await this.transport.connect();

		// Initialize the MCP session
		try {
			const initResult = await this.request("initialize", {
				protocolVersion: "2024-11-05",
				capabilities: {
					tools: {},
				},
				clientInfo: {
					name: "hydrate-obsidian-plugin",
					version: "1.0.0",
				},
			});

			this.emit("initialized", initResult);

			// Send initialized notification
			await this.notify("initialized", {});
		} catch (error) {
			await this.disconnect();
			throw new Error(`MCP initialization failed: ${error.message}`);
		}
	}

	async disconnect(): Promise<void> {
		this.cleanupPendingRequests();
		await this.transport.disconnect();
	}

	async request(
		method: string,
		params?: Record<string, unknown>,
	): Promise<unknown> {
		if (!this.connected) {
			throw new Error("MCP client not connected");
		}

		const id = ++this.requestId;
		const message: MCPRequest = {
			jsonrpc: "2.0",
			id,
			method,
			params,
		};

		return new Promise((resolve, reject) => {
			// Set up timeout
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`Request timeout: ${method}`));
			}, this.requestTimeout);

			// Store pending request
			this.pendingRequests.set(id, { resolve, reject, timeout });

			// Send the request
			this.transport.send(message).catch((error) => {
				this.pendingRequests.delete(id);
				clearTimeout(timeout);
				reject(error);
			});
		});
	}

	async notify(
		method: string,
		params?: Record<string, unknown>,
	): Promise<void> {
		if (!this.connected) {
			throw new Error("MCP client not connected");
		}

		const message: MCPNotification = {
			jsonrpc: "2.0",
			method,
			params,
		};

		await this.transport.send(message);
	}

	async listTools(): Promise<MCPToolSchema[]> {
		const response = (await this.request("tools/list")) as {
			tools?: MCPToolSchema[];
		};
		return response.tools || [];
	}

	async callTool(
		name: string,
		parameters: Record<string, unknown>,
	): Promise<unknown> {
		const response = (await this.request("tools/call", {
			name,
			arguments: parameters,
		})) as { content?: unknown };
		return response.content;
	}

	isConnected(): boolean {
		return this.connected;
	}

	setRequestTimeout(timeout: number): void {
		this.requestTimeout = timeout;
	}

	private handleMessage(message: MCPMessage): void {
		if ("id" in message) {
			// This is a response to a request
			this.handleResponse(message as MCPResponse);
		} else {
			// This is a notification
			this.handleNotification(message as MCPNotification);
		}
	}

	private handleResponse(response: MCPResponse): void {
		const pending = this.pendingRequests.get(response.id);
		if (!pending) {
			this.emit(
				"error",
				new Error(
					`Received response for unknown request ID: ${response.id}`,
				),
			);
			return;
		}

		this.pendingRequests.delete(response.id);
		clearTimeout(pending.timeout);

		if (response.error) {
			const error = new Error(response.error.message) as Error & {
				code?: number;
				data?: unknown;
			};
			error.code = response.error.code;
			error.data = response.error.data;
			pending.reject(error);
		} else {
			pending.resolve(response.result);
		}
	}

	private handleNotification(notification: MCPNotification): void {
		this.emit("notification", notification.method, notification.params);

		// Handle specific notifications
		switch (notification.method) {
			case "notifications/tools/list_changed":
				this.emit("tools_changed");
				break;
			default:
				// Unknown notification - just emit as generic event
				this.emit(
					`notification:${notification.method}`,
					notification.params,
				);
		}
	}

	private cleanupPendingRequests(): void {
		for (const [id, pending] of this.pendingRequests) {
			clearTimeout(pending.timeout);
			pending.reject(new Error("Connection closed"));
		}
		this.pendingRequests.clear();
	}
}

/**
 * Utility function to create an MCP client with stdio transport
 */
export function createStdioMCPClient(
	command: string,
	args: string[] = [],
	env: Record<string, string> = {},
): MCPClient {
	const { StdioTransport } = require("./MCPTransport");
	const transport = new StdioTransport(command, args, env);
	return new MCPClient(transport);
}

/**
 * Utility function to create an MCP client with WebSocket transport
 */
export function createWebSocketMCPClient(url: string): MCPClient {
	const { WebSocketTransport } = require("./MCPTransport");
	const transport = new WebSocketTransport(url);
	return new MCPClient(transport);
}
