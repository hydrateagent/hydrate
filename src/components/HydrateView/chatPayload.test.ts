import { describe, expect, it } from "vitest";
import { MAX_ATTACHED_FILE_CHARS } from "../../toolOutputLimits";
import {
	buildChatPayload,
	combineMessageContent,
	formatFileInjection,
} from "./chatPayload";
import type { MCPToolSchemaWithMetadata } from "../../mcp/MCPServerManager";

describe("formatFileInjection", () => {
	it("wraps small content unchanged, matching handleSend's current template literal", () => {
		const out = formatFileInjection("a/b.md", "hello world");
		expect(out).toBe(
			"\n\n--- File Content: a/b.md ---\nhello world\n--- End File Content ---",
		);
	});

	it("clamps oversized content and keeps the paging notice inside the wrapper", () => {
		const big = "x".repeat(MAX_ATTACHED_FILE_CHARS + 5000);
		const out = formatFileInjection("notes/huge.md", big);

		expect(out.startsWith("\n\n--- File Content: notes/huge.md ---\n")).toBe(true);
		expect(out.endsWith("\n--- End File Content ---")).toBe(true);
		expect(out).toContain("[Attached file truncated");
		// The notice must land before the closing marker, not after.
		const noticeIndex = out.indexOf("[Attached file truncated");
		const closingIndex = out.indexOf("--- End File Content ---");
		expect(noticeIndex).toBeLessThan(closingIndex);
		// Wrapper overhead means the wrapped output is still bounded, not unbounded.
		expect(out.length).toBeLessThan(big.length);
	});
});

describe("combineMessageContent", () => {
	it("returns the original message unchanged when neither rules nor files are present", () => {
		expect(combineMessageContent("hi there", "", "")).toBe("hi there");
	});

	it("prepends rules context with no separator adjustment (pinned current behavior)", () => {
		const rules = "\n\n--- Begin Applied Rule: r1 ---\nDo the thing\n--- End Applied Rule: r1 ---\n";
		expect(combineMessageContent("hi there", rules, "")).toBe(rules + "hi there");
	});

	it("appends file contents with a blank-line separator when message doesn't already end in one", () => {
		const files = "\n\n--- File Content: a.md ---\nfoo\n--- End File Content ---";
		expect(combineMessageContent("hi there", "", files)).toBe(
			"hi there\n\n" + files,
		);
	});

	it("does not add an extra separator when the combined message already ends in a blank line", () => {
		const files = "\n\n--- File Content: a.md ---\nfoo\n--- End File Content ---";
		// Message already ends with "\n\n" so no extra separator is inserted.
		expect(combineMessageContent("hi there\n\n", "", files)).toBe(
			"hi there\n\n" + files,
		);
	});

	it("combines rules and file contents together, rules first then message then files", () => {
		const rules = "\n\n--- Begin Applied Rule: r1 ---\nDo the thing\n--- End Applied Rule: r1 ---\n";
		const files = "\n\n--- File Content: a.md ---\nfoo\n--- End File Content ---";
		expect(combineMessageContent("hi there", rules, files)).toBe(
			rules + "hi there" + "\n\n" + files,
		);
	});

	it("does not append anything when fileContents is present but blank/whitespace-only", () => {
		expect(combineMessageContent("hi there", "", "   \n  ")).toBe("hi there");
	});

	it("prepends rules even when the original message is empty", () => {
		const rules = "\n\n--- Begin Applied Rule: r1 ---\nDo the thing\n--- End Applied Rule: r1 ---\n";
		expect(combineMessageContent("", rules, "")).toBe(rules);
	});
});

describe("buildChatPayload", () => {
	const baseOpts = {
		message: "hello",
		conversationId: "convo-1",
		model: "claude-fake",
		mcpTools: [] as MCPToolSchemaWithMetadata[],
		maxInputTokens: 200_000,
		maxOutputTokens: 32_768,
	};

	it("maps the core fields straight through", () => {
		const payload = buildChatPayload(baseOpts);
		expect(payload).toEqual({
			message: "hello",
			conversation_id: "convo-1",
			model: "claude-fake",
			mcp_tools: [],
			max_input_tokens: 200_000,
			max_output_tokens: 32_768,
		});
	});

	it("always includes max_input_tokens and max_output_tokens (resolved, not conditional)", () => {
		const payload = buildChatPayload(baseOpts);
		expect(payload.max_input_tokens).toBe(200_000);
		expect(payload.max_output_tokens).toBe(32_768);
	});

	it("passes through overridden token limits unchanged", () => {
		const payload = buildChatPayload({
			...baseOpts,
			maxInputTokens: 10_000,
			maxOutputTokens: 500,
		});
		expect(payload.max_input_tokens).toBe(10_000);
		expect(payload.max_output_tokens).toBe(500);
	});

	it("passes conversation_id through as null unchanged", () => {
		const payload = buildChatPayload({ ...baseOpts, conversationId: null });
		expect(payload.conversation_id).toBeNull();
	});

	it("omits images when undefined", () => {
		const payload = buildChatPayload(baseOpts);
		expect(payload).not.toHaveProperty("images");
	});

	it("omits images when an empty array (pinned: matches current attachedImages.length > 0 gate)", () => {
		const payload = buildChatPayload({ ...baseOpts, images: [] });
		expect(payload).not.toHaveProperty("images");
	});

	it("includes images when non-empty", () => {
		const images = [{ data: "abc123", mime_type: "image/png" }];
		const payload = buildChatPayload({ ...baseOpts, images });
		expect(payload.images).toEqual(images);
	});

	it("omits vault_instructions when undefined", () => {
		const payload = buildChatPayload(baseOpts);
		expect(payload).not.toHaveProperty("vault_instructions");
	});

	it("omits vault_instructions when an empty string", () => {
		const payload = buildChatPayload({ ...baseOpts, vaultInstructions: "" });
		expect(payload).not.toHaveProperty("vault_instructions");
	});

	it("includes vault_instructions when non-empty", () => {
		const payload = buildChatPayload({
			...baseOpts,
			vaultInstructions: "Be nice to the vault.",
		});
		expect(payload.vault_instructions).toBe("Be nice to the vault.");
	});

	it("omits memory_index when undefined", () => {
		const payload = buildChatPayload(baseOpts);
		expect(payload).not.toHaveProperty("memory_index");
	});

	it("omits memory_index when an empty string", () => {
		const payload = buildChatPayload({ ...baseOpts, memoryIndex: "" });
		expect(payload).not.toHaveProperty("memory_index");
	});

	it("includes memory_index when non-empty", () => {
		const payload = buildChatPayload({
			...baseOpts,
			memoryIndex: "- hydrate-chats/memories/a.md — desc (user)",
		});
		expect(payload.memory_index).toBe(
			"- hydrate-chats/memories/a.md — desc (user)",
		);
	});
});
