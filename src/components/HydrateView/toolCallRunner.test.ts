import { describe, expect, it, vi } from "vitest";
import type { BackendToolCall } from "./backendTypes";
import { EDIT_TOOLS, partitionToolCalls, runNonEditToolCalls } from "./toolCallRunner";
import { MAX_TOOL_RESULT_CHARS } from "../../toolOutputLimits";
import type { ImageToolResult } from "../../imageTools";

function makeToolCall(overrides: Partial<BackendToolCall>): BackendToolCall {
	return {
		action: "tool_call",
		id: "call-1",
		tool: "readFile",
		params: {},
		...overrides,
	};
}

describe("EDIT_TOOLS", () => {
	it("lists the three tools that route through review", () => {
		expect(EDIT_TOOLS).toEqual([
			"editFile",
			"replaceSelectionInFile",
			"applyPatchesToFile",
		]);
	});
});

describe("partitionToolCalls", () => {
	it("splits a mixed list into edit and non-edit calls, preserving order within each group", () => {
		const toolCalls = [
			makeToolCall({ id: "1", tool: "readFile" }),
			makeToolCall({ id: "2", tool: "editFile" }),
			makeToolCall({ id: "3", tool: "search_project" }),
			makeToolCall({ id: "4", tool: "replaceSelectionInFile" }),
			makeToolCall({ id: "5", tool: "applyPatchesToFile" }),
			makeToolCall({ id: "6", tool: "fetchImage" }),
		];

		const { editToolCalls, otherToolCalls } = partitionToolCalls(toolCalls);

		expect(editToolCalls.map((c) => c.id)).toEqual(["2", "4", "5"]);
		expect(otherToolCalls.map((c) => c.id)).toEqual(["1", "3", "6"]);
	});

	it("routes a tool named editFile into editToolCalls even when it is an MCP tool (partition is by tool name today)", () => {
		const toolCalls = [
			makeToolCall({
				id: "mcp-1",
				tool: "editFile",
				mcp_info: {
					server_id: "srv-1",
					server_name: "Some Server",
					is_mcp_tool: true,
				},
			}),
		];

		const { editToolCalls, otherToolCalls } = partitionToolCalls(toolCalls);

		expect(editToolCalls.map((c) => c.id)).toEqual(["mcp-1"]);
		expect(otherToolCalls).toEqual([]);
	});

	it("returns empty arrays for an empty input", () => {
		expect(partitionToolCalls([])).toEqual({
			editToolCalls: [],
			otherToolCalls: [],
		});
	});
});

describe("runNonEditToolCalls", () => {
	it("awaits each executor sequentially, in input order, before starting the next", async () => {
		const order: string[] = [];
		let resolveFirst: () => void = () => {};
		const firstGate = new Promise<void>((resolve) => {
			resolveFirst = resolve;
		});

		const execute = vi.fn(async (toolCall: BackendToolCall) => {
			order.push(`start:${toolCall.id}`);
			if (toolCall.id === "1") {
				await firstGate;
			}
			order.push(`end:${toolCall.id}`);
			return `result-${toolCall.id}`;
		});

		const toolCalls = [
			makeToolCall({ id: "1" }),
			makeToolCall({ id: "2" }),
		];

		const resultPromise = runNonEditToolCalls(toolCalls, execute);

		// Let microtasks flush; if execution were concurrent, "start:2" would
		// already be present. Sequential (awaited) execution means call #2
		// cannot start until call #1's promise resolves.
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(order).toEqual(["start:1"]);

		resolveFirst();
		const results = await resultPromise;

		expect(order).toEqual(["start:1", "end:1", "start:2", "end:2"]);
		expect(results).toEqual([
			{ id: "1", result: "result-1" },
			{ id: "2", result: "result-2" },
		]);
	});

	it("keeps results in input order regardless of individual settle timing", async () => {
		const execute = vi.fn(async (toolCall: BackendToolCall) => {
			const delay = toolCall.id === "a" ? 10 : 0;
			await new Promise((resolve) => setTimeout(resolve, delay));
			return `r-${toolCall.id}`;
		});

		const toolCalls = [
			makeToolCall({ id: "a" }),
			makeToolCall({ id: "b" }),
			makeToolCall({ id: "c" }),
		];

		const results = await runNonEditToolCalls(toolCalls, execute);

		expect(results.map((r) => r.id)).toEqual(["a", "b", "c"]);
	});

	it("converts a thrown Error into an 'Error: <message>' string result", async () => {
		const execute = vi.fn(async () => {
			throw new Error("boom");
		});

		const results = await runNonEditToolCalls(
			[makeToolCall({ id: "1" })],
			execute,
		);

		expect(results).toEqual([{ id: "1", result: "Error: boom" }]);
	});

	it("converts a non-Error throw via String(thrown)", async () => {
		const execute = vi.fn(async () => {
			// eslint-disable-next-line @typescript-eslint/no-throw-literal
			throw "plain string failure";
		});

		const results = await runNonEditToolCalls(
			[makeToolCall({ id: "1" })],
			execute,
		);

		expect(results).toEqual([
			{ id: "1", result: "Error: plain string failure" },
		]);
	});

	it("passes successful results through capToolResult, truncating oversized strings", async () => {
		const big = "x".repeat(MAX_TOOL_RESULT_CHARS + 5000);
		const execute = vi.fn(async () => big);

		const results = await runNonEditToolCalls(
			[makeToolCall({ id: "1" })],
			execute,
		);

		expect(results).toHaveLength(1);
		const result = results[0].result as string;
		expect(result.length).toBeLessThan(big.length);
		expect(result).toContain("[Truncated by Hydrate");
	});

	it("passes image results through capToolResult with identity preserved", async () => {
		const image: ImageToolResult = {
			type: "image",
			mime_type: "image/png",
			data: "x".repeat(100_000),
			source: "test.png",
		};
		const execute = vi.fn(async () => image);

		const results = await runNonEditToolCalls(
			[makeToolCall({ id: "1" })],
			execute,
		);

		expect(results).toEqual([{ id: "1", result: image }]);
		expect(results[0].result).toBe(image);
	});

	it("returns an empty array for an empty input without calling the executor", async () => {
		const execute = vi.fn();

		const results = await runNonEditToolCalls([], execute);

		expect(results).toEqual([]);
		expect(execute).not.toHaveBeenCalled();
	});
});
