import { describe, expect, it, vi, beforeEach } from "vitest";
import type { App } from "obsidian";
import type { HydratePluginSettings } from "../../main";
import type { MCPServerManager } from "../../mcp/MCPServerManager";
import type { BackendToolCall } from "./backendTypes";

vi.mock("./toolImplementations", () => ({
	toolReadFile: vi.fn(async () => "read-file-content"),
	toolReadImage: vi.fn(async () => ({
		type: "image",
		mime_type: "image/png",
		data: "read-image-data",
		source: "img.png",
	})),
	toolFetchImage: vi.fn(async () => ({
		type: "image",
		mime_type: "image/png",
		data: "fetch-image-data",
		source: "http://example.test/x.png",
	})),
	toolReplaceSelectionInFile: vi.fn(async () => "replaced-ok"),
}));

vi.mock("../../toolHandlers", () => ({
	handleSearchProject: vi.fn(async () => ({
		id: "t1",
		result: "unwrapped-search-result",
	})),
}));

import {
	toolReadFile,
	toolReadImage,
	toolFetchImage,
	toolReplaceSelectionInFile,
} from "./toolImplementations";
import { handleSearchProject } from "../../toolHandlers";
import {
	executeSingleTool,
	executeMCPTool,
	ToolDispatchDeps,
} from "./toolDispatch";

const fakeApp = {} as unknown as App;
const fakeSettings = {} as unknown as HydratePluginSettings;

function makeToolCall(overrides: Partial<BackendToolCall>): BackendToolCall {
	return {
		action: "tool_call",
		id: "call-1",
		tool: "readFile",
		params: {},
		...overrides,
	};
}

function makeDeps(
	mcpManager: MCPServerManager | null = null,
): ToolDispatchDeps {
	return { app: fakeApp, settings: fakeSettings, mcpManager };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("executeSingleTool", () => {
	it("short-circuits to the MCP path when mcp_info.is_mcp_tool is true, even for a tool name that collides with a native tool", async () => {
		const executeToolCall = vi.fn(async () => "mcp-result");
		const mcpManager = { executeToolCall } as unknown as MCPServerManager;
		const toolCall = makeToolCall({
			tool: "readFile", // collides with the native readFile case
			params: { path: "a.md" },
			mcp_info: {
				server_id: "srv-1",
				server_name: "Server One",
				is_mcp_tool: true,
			},
		});

		const result = await executeSingleTool(toolCall, makeDeps(mcpManager));

		expect(result).toBe("mcp-result");
		expect(toolReadFile).not.toHaveBeenCalled();
		expect(executeToolCall).toHaveBeenCalledWith("srv-1", "readFile", {
			path: "a.md",
		});
	});

	it("delegates readFile to toolReadFile with (app, path, offset, limit)", async () => {
		const toolCall = makeToolCall({
			tool: "readFile",
			params: { path: "notes/a.md", offset: 5, limit: 10 },
		});

		const result = await executeSingleTool(toolCall, makeDeps());

		expect(toolReadFile).toHaveBeenCalledWith(
			fakeApp,
			"notes/a.md",
			5,
			10,
		);
		expect(result).toBe("read-file-content");
	});

	it("delegates readImage to toolReadImage with (app, path)", async () => {
		const toolCall = makeToolCall({
			tool: "readImage",
			params: { path: "img.png" },
		});

		const result = await executeSingleTool(toolCall, makeDeps());

		expect(toolReadImage).toHaveBeenCalledWith(fakeApp, "img.png");
		expect(result).toEqual({
			type: "image",
			mime_type: "image/png",
			data: "read-image-data",
			source: "img.png",
		});
	});

	it("delegates fetchImage to toolFetchImage with (url)", async () => {
		const toolCall = makeToolCall({
			tool: "fetchImage",
			params: { url: "http://example.test/x.png" },
		});

		const result = await executeSingleTool(toolCall, makeDeps());

		expect(toolFetchImage).toHaveBeenCalledWith(
			"http://example.test/x.png",
		);
		expect(result).toEqual({
			type: "image",
			mime_type: "image/png",
			data: "fetch-image-data",
			source: "http://example.test/x.png",
		});
	});

	it("falls back to direct execution for replaceSelectionInFile", async () => {
		const toolCall = makeToolCall({
			tool: "replaceSelectionInFile",
			params: {
				path: "notes/a.md",
				original_selection: "old",
				new_content: "new",
			},
		});

		const result = await executeSingleTool(toolCall, makeDeps());

		expect(toolReplaceSelectionInFile).toHaveBeenCalledWith(
			fakeApp,
			"notes/a.md",
			"old",
			"new",
		);
		expect(result).toBe("replaced-ok");
	});

	it("unwraps the {id, result} envelope from handleSearchProject for search_project", async () => {
		const toolCall = makeToolCall({
			tool: "search_project",
			params: { query: "roadmap" },
		});

		const result = await executeSingleTool(toolCall, makeDeps());

		expect(handleSearchProject).toHaveBeenCalledWith(
			toolCall,
			fakeApp,
			fakeSettings,
		);
		expect(result).toBe("unwrapped-search-result");
	});

	it("throws for an unknown tool", async () => {
		const toolCall = makeToolCall({ tool: "notARealTool" });

		await expect(
			executeSingleTool(toolCall, makeDeps()),
		).rejects.toThrow(
			"Unknown or unsupported tool for direct execution: notARealTool",
		);
	});
});

describe("executeMCPTool", () => {
	it("throws when mcp_info is missing", async () => {
		const toolCall = makeToolCall({ tool: "someMcpTool", mcp_info: undefined });

		await expect(
			executeMCPTool(toolCall, makeDeps()),
		).rejects.toThrow("MCP tool call missing routing information");
	});

	it("throws when mcpManager is missing", async () => {
		const toolCall = makeToolCall({
			tool: "someMcpTool",
			mcp_info: {
				server_id: "srv-1",
				server_name: "Server One",
				is_mcp_tool: true,
			},
		});

		await expect(
			executeMCPTool(toolCall, makeDeps(null)),
		).rejects.toThrow("MCP Server Manager not available");
	});

	it("unwraps params.kwargs before calling executeToolCall(server_id, tool, actualParams)", async () => {
		const executeToolCall = vi.fn(async () => "kwargs-result");
		const mcpManager = { executeToolCall } as unknown as MCPServerManager;
		const toolCall = makeToolCall({
			tool: "someMcpTool",
			params: { kwargs: { foo: "bar" } },
			mcp_info: {
				server_id: "srv-1",
				server_name: "Server One",
				is_mcp_tool: true,
			},
		});

		const result = await executeMCPTool(toolCall, makeDeps(mcpManager));

		expect(executeToolCall).toHaveBeenCalledWith("srv-1", "someMcpTool", {
			foo: "bar",
		});
		expect(result).toBe("kwargs-result");
	});

	it("throws the generic 'Invalid parameters' message (wrapped by the fallback) when params is not an object", async () => {
		const mcpManager = {
			executeToolCall: vi.fn(),
		} as unknown as MCPServerManager;
		const toolCall = makeToolCall({
			tool: "someMcpTool",
			params: null as unknown as Record<string, unknown>,
			mcp_info: {
				server_id: "srv-1",
				server_name: "Server One",
				is_mcp_tool: true,
			},
		});

		await expect(
			executeMCPTool(toolCall, makeDeps(mcpManager)),
		).rejects.toThrow(
			"MCP tool execution failed: Invalid parameters for MCP tool call",
		);
	});

	it("maps 'Server not found' errors to a friendly server-unavailable message", async () => {
		const executeToolCall = vi.fn(async () => {
			throw new Error("Server not found: srv-1");
		});
		const mcpManager = { executeToolCall } as unknown as MCPServerManager;
		const toolCall = makeToolCall({
			tool: "someMcpTool",
			params: {},
			mcp_info: {
				server_id: "srv-1",
				server_name: "My Server",
				is_mcp_tool: true,
			},
		});

		await expect(
			executeMCPTool(toolCall, makeDeps(mcpManager)),
		).rejects.toThrow(
			"MCP server 'My Server' (srv-1) is not available. Please check server configuration.",
		);
	});

	it("maps 'Tool not found' errors to a friendly tool-unavailable message", async () => {
		const executeToolCall = vi.fn(async () => {
			throw new Error("Tool not found on server");
		});
		const mcpManager = { executeToolCall } as unknown as MCPServerManager;
		const toolCall = makeToolCall({
			tool: "myTool",
			params: {},
			mcp_info: {
				server_id: "srv-1",
				server_name: "My Server",
				is_mcp_tool: true,
			},
		});

		await expect(
			executeMCPTool(toolCall, makeDeps(mcpManager)),
		).rejects.toThrow(
			"Tool 'myTool' not found on MCP server 'My Server'. The tool may have been removed or the server may need to be restarted.",
		);
	});

	it("maps timeout errors to a friendly timed-out message", async () => {
		const executeToolCall = vi.fn(async () => {
			throw new Error("Request timeout exceeded");
		});
		const mcpManager = { executeToolCall } as unknown as MCPServerManager;
		const toolCall = makeToolCall({
			tool: "myTool",
			params: {},
			mcp_info: {
				server_id: "srv-1",
				server_name: "My Server",
				is_mcp_tool: true,
			},
		});

		await expect(
			executeMCPTool(toolCall, makeDeps(mcpManager)),
		).rejects.toThrow(
			"MCP tool 'myTool' timed out. The operation may be taking longer than expected.",
		);
	});

	it("falls back to the generic 'MCP tool execution failed' message for unmatched errors", async () => {
		const executeToolCall = vi.fn(async () => {
			throw new Error("boom");
		});
		const mcpManager = { executeToolCall } as unknown as MCPServerManager;
		const toolCall = makeToolCall({
			tool: "myTool",
			params: {},
			mcp_info: {
				server_id: "srv-1",
				server_name: "My Server",
				is_mcp_tool: true,
			},
		});

		await expect(
			executeMCPTool(toolCall, makeDeps(mcpManager)),
		).rejects.toThrow("MCP tool execution failed: boom");
	});
});
