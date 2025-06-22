/**
 * MCP (Model Context Protocol) Integration
 *
 * This module provides client-side MCP protocol implementation for the Hydrate plugin.
 * It enables communication with MCP servers running as local processes or WebSocket servers.
 */

// Transport layer
export type { MCPTransport } from "./MCPTransport";
export { StdioTransport, WebSocketTransport } from "./MCPTransport";

// Client layer
export type {
	MCPRequest,
	MCPResponse,
	MCPNotification,
	MCPMessage,
	MCPToolSchema,
} from "./MCPClient";
export {
	MCPClient,
	createStdioMCPClient,
	createWebSocketMCPClient,
} from "./MCPClient";

// Server management
export type { MCPServerConfig, MCPServerStats } from "./MCPServerConfig";
export {
	MCPServerStatus,
	MCPServerHealth,
	MCPServerConfigValidator,
	DEFAULT_MCP_SERVER_CONFIG,
	MCP_SERVER_TEMPLATES,
} from "./MCPServerConfig";
export { MCPServer } from "./MCPServer";
export type { MCPServerEvents } from "./MCPServer";

// Test utilities
export { testMCPClient } from "./test-mcp-client";
export { testMCPServer, testServerCrashRecovery } from "./test-mcp-server";
