/**
 * MCP (Model Context Protocol) Integration
 *
 * This module provides comprehensive MCP client and server management
 * for the Hydrate Obsidian plugin.
 */

// MCP Transport Layer
export type { MCPTransport } from "./MCPTransport";
export { StdioTransport, WebSocketTransport } from "./MCPTransport";

// MCP Client
export { MCPClient } from "./MCPClient";
export type { MCPToolSchema } from "./MCPClient";

// MCP Server Configuration
export type { MCPServerConfig } from "./MCPServerConfig";
export {
	MCPServerStatus,
	MCPServerHealth,
	MCP_SERVER_TEMPLATES,
	DEFAULT_MCP_SERVER_CONFIG,
} from "./MCPServerConfig";

// MCP Server Management
export { MCPServer } from "./MCPServer";
export type { MCPServerEvents } from "./MCPServer";

// MCP Tool Discovery
export { MCPToolDiscovery, DEFAULT_DISCOVERY_CONFIG } from "./MCPToolDiscovery";
export type {
	MCPToolSchemaWithMetadata,
	MCPToolDiscoveryConfig,
	MCPToolDiscoveryEvents,
} from "./MCPToolDiscovery";

// Test utilities
export { testMCPClient } from "./test-mcp-client";
export { testMCPServer } from "./test-mcp-server";
export { testToolDiscovery } from "./test-tool-discovery";
