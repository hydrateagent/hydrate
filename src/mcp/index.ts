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

// Test utilities
export { testMCPClient } from "./test-mcp-client";
