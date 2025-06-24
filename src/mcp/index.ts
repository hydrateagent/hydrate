/**
 * MCP (Model Context Protocol) Integration
 *
 * This module provides client-side MCP protocol implementation for the Hydrate plugin.
 * It enables communication with MCP servers running as local processes or WebSocket servers.
 */

// Transport layer
export {
	MCPTransport,
	StdioTransport,
	WebSocketTransport,
} from "./MCPTransport";

// Client layer
export {
	MCPClient,
	MCPRequest,
	MCPResponse,
	MCPNotification,
	MCPMessage,
	MCPToolSchema,
	createStdioMCPClient,
	createWebSocketMCPClient,
} from "./MCPClient";

// Test utilities
export { testMCPClient } from "./test-mcp-client";
