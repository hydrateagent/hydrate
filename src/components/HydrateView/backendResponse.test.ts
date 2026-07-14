import { describe, expect, it, vi } from "vitest";
import type { BackendResponse, ContextStatus, HistoryMessage } from "./backendTypes";
import {
	applyBackendResponse,
	describeBackendError,
	formatContextMeter,
	type BackendResponseHooks,
} from "./backendResponse";

function makeContextStatus(overrides: Partial<ContextStatus> = {}): ContextStatus {
	return {
		estimated_tokens: 1000,
		percent_left: 50,
		above_warning: false,
		above_autocompact: false,
		...overrides,
	};
}

function makeHooks(): { hooks: BackendResponseHooks; order: string[] } {
	const order: string[] = [];
	const hooks: BackendResponseHooks = {
		setConversationId: vi.fn(() => {
			order.push("setConversationId");
		}),
		onConversationRestarted: vi.fn(() => {
			order.push("onConversationRestarted");
		}),
		updateContextMeter: vi.fn(() => {
			order.push("updateContextMeter");
		}),
		addAgentMessage: vi.fn(async () => {
			// Simulate the real hook's async markdown render so ordering
			// assertions catch a non-awaited implementation.
			await Promise.resolve();
			order.push("addAgentMessage");
		}),
		processToolCalls: vi.fn(async () => {
			await Promise.resolve();
			order.push("processToolCalls");
		}),
		setLoading: vi.fn(() => {
			order.push("setLoading");
		}),
	};
	return { hooks, order };
}

describe("formatContextMeter", () => {
	it("formats percent used and carries the warning flag through", () => {
		expect(
			formatContextMeter(makeContextStatus({ percent_left: 37.4, above_warning: true })),
		).toEqual({ text: "Context: 63% used", warning: true });

		expect(
			formatContextMeter(makeContextStatus({ percent_left: 37.4, above_warning: false })),
		).toEqual({ text: "Context: 63% used", warning: false });
	});

	it("clamps at 0% used when percent_left exceeds 100", () => {
		expect(formatContextMeter(makeContextStatus({ percent_left: 110 }))).toEqual({
			text: "Context: 0% used",
			warning: false,
		});
	});
});

describe("describeBackendError", () => {
	it("returns the cancellation message for a real AbortError", () => {
		const err = Object.assign(new Error("aborted"), { name: "AbortError" });
		expect(describeBackendError(err)).toBe("Request cancelled by user.");
	});

	it("returns Error: <message> for a normal Error", () => {
		expect(describeBackendError(new Error("boom"))).toBe("Error: boom");
	});

	// Real catch behavior: `error instanceof Error ? error.message : "Unknown error"`.
	// A plain object shaped like an AbortError does NOT match `instanceof Error`,
	// so it falls through to the generic "Unknown error" branch rather than the
	// cancellation message.
	it("does not treat a plain object with name AbortError as a real AbortError", () => {
		expect(describeBackendError({ name: "AbortError" })).toBe("Error: Unknown error");
	});

	// Real catch behavior does not stringify arbitrary thrown values -- it always
	// falls back to the literal string "Unknown error" for non-Error throws.
	it("falls back to Unknown error for non-Error thrown values", () => {
		expect(describeBackendError("oops")).toBe("Error: Unknown error");
		expect(describeBackendError(42)).toBe("Error: Unknown error");
		expect(describeBackendError(undefined)).toBe("Error: Unknown error");
	});
});

describe("applyBackendResponse", () => {
	function makeAgentMessage(overrides: Partial<HistoryMessage> = {}): HistoryMessage {
		return { type: "ai", content: "hello", ...overrides };
	}

	it("runs the pinned order for a response with an agent message and no tool calls: setConversationId, updateContextMeter, addAgentMessage, setLoading(false)", async () => {
		const { hooks, order } = makeHooks();
		const response: BackendResponse = {
			conversation_id: "conv-1",
			context_status: makeContextStatus({ percent_left: 80, above_warning: false }),
			agent_message: makeAgentMessage(),
		};

		await applyBackendResponse(response, hooks);

		expect(hooks.setConversationId).toHaveBeenCalledWith("conv-1");
		expect(hooks.updateContextMeter).toHaveBeenCalledWith({
			text: "Context: 20% used",
			warning: false,
		});
		expect(hooks.addAgentMessage).toHaveBeenCalledWith(response.agent_message);
		expect(hooks.setLoading).toHaveBeenCalledWith(false);
		expect(hooks.processToolCalls).not.toHaveBeenCalled();

		expect(order).toEqual([
			"setConversationId",
			"updateContextMeter",
			"addAgentMessage",
			"setLoading",
		]);
	});

	it("awaits addAgentMessage before calling setLoading(false)", async () => {
		const { hooks, order } = makeHooks();
		await applyBackendResponse(
			{ conversation_id: "conv-1", agent_message: makeAgentMessage() },
			hooks,
		);
		expect(order.indexOf("addAgentMessage")).toBeLessThan(order.indexOf("setLoading"));
	});

	it("does not call updateContextMeter when context_status is absent", async () => {
		const { hooks } = makeHooks();
		await applyBackendResponse({ conversation_id: "conv-1" }, hooks);
		expect(hooks.updateContextMeter).not.toHaveBeenCalled();
	});

	it("takes the tool-calls branch exclusively: processToolCalls runs, addAgentMessage and setLoading do not, even when agent_message is also present", async () => {
		const { hooks, order } = makeHooks();
		const toolCalls: BackendResponse["tool_calls_prepared"] = [
			{ action: "tool_call", tool: "readFile", params: {}, id: "call-1" },
		];
		const response: BackendResponse = {
			conversation_id: "conv-1",
			context_status: makeContextStatus(),
			agent_message: makeAgentMessage(),
			tool_calls_prepared: toolCalls,
		};

		await applyBackendResponse(response, hooks);

		expect(hooks.processToolCalls).toHaveBeenCalledWith(toolCalls);
		expect(hooks.addAgentMessage).not.toHaveBeenCalled();
		expect(hooks.setLoading).not.toHaveBeenCalled();
		expect(order).toEqual(["setConversationId", "updateContextMeter", "processToolCalls"]);
	});

	it("treats an empty tool_calls_prepared array as the no-tool-calls branch", async () => {
		const { hooks } = makeHooks();
		await applyBackendResponse(
			{ conversation_id: "conv-1", tool_calls_prepared: [], agent_message: makeAgentMessage() },
			hooks,
		);
		expect(hooks.processToolCalls).not.toHaveBeenCalled();
		expect(hooks.addAgentMessage).toHaveBeenCalled();
		expect(hooks.setLoading).toHaveBeenCalledWith(false);
	});

	it("calls processToolCalls not at all, and setLoading(false), when there is no agent_message and no tool calls", async () => {
		const { hooks } = makeHooks();
		await applyBackendResponse({ conversation_id: "conv-1" }, hooks);
		expect(hooks.addAgentMessage).not.toHaveBeenCalled();
		expect(hooks.processToolCalls).not.toHaveBeenCalled();
		expect(hooks.setLoading).toHaveBeenCalledWith(false);
	});

	it("calls onConversationRestarted exactly once, before addAgentMessage, when conversation_restarted is true", async () => {
		const { hooks, order } = makeHooks();
		await applyBackendResponse(
			{
				conversation_id: "conv-1",
				conversation_restarted: true,
				agent_message: makeAgentMessage(),
			},
			hooks,
		);
		expect(hooks.onConversationRestarted).toHaveBeenCalledTimes(1);
		expect(order.indexOf("onConversationRestarted")).toBeLessThan(
			order.indexOf("addAgentMessage"),
		);
	});

	it("never calls onConversationRestarted when conversation_restarted is false or absent", async () => {
		const { hooks: hooksAbsent } = makeHooks();
		await applyBackendResponse({ conversation_id: "conv-1" }, hooksAbsent);
		expect(hooksAbsent.onConversationRestarted).not.toHaveBeenCalled();

		const { hooks: hooksFalse } = makeHooks();
		await applyBackendResponse(
			{ conversation_id: "conv-1", conversation_restarted: false },
			hooksFalse,
		);
		expect(hooksFalse.onConversationRestarted).not.toHaveBeenCalled();
	});
});
