import { describe, expect, it } from "vitest";
import {
	MAX_TOOL_RESULT_CHARS,
	MAX_ATTACHED_FILE_CHARS,
	capToolResult,
	sliceFileContent,
	clampAttachedFile,
} from "./toolOutputLimits";
import type { ImageToolResult } from "./imageTools";

describe("capToolResult", () => {
	it("passes small strings and non-strings through", () => {
		expect(capToolResult("hello")).toBe("hello");
		const obj = { a: 1 };
		expect(capToolResult(obj)).toBe(obj);
	});

	it("truncates oversized strings with a notice", () => {
		const big = "x".repeat(MAX_TOOL_RESULT_CHARS + 5000);
		const out = capToolResult(big) as string;
		expect(out.length).toBeLessThan(big.length);
		expect(out).toContain("[Truncated by Hydrate");
		expect(out).toContain(String(big.length));
	});

	it("passes image results through by reference regardless of size", () => {
		const image: ImageToolResult = {
			type: "image",
			mime_type: "image/png",
			data: "x".repeat(100_000),
			source: "test.png",
		};
		expect(capToolResult(image)).toBe(image);
	});

	it("passes small structured objects through by reference", () => {
		const obj = { items: ["a", "b", "c"] };
		expect(capToolResult(obj)).toBe(obj);
	});

	it("returns large structured objects as a truncated string with notice", () => {
		const large = { items: Array.from({ length: 1000 }, () => "x".repeat(100)) };
		const out = capToolResult(large);
		expect(typeof out).toBe("string");
		expect(out).toContain("[Truncated by Hydrate");
		expect(out).toContain("structured");
	});

	it("falls back to String() for unstringifiable values", () => {
		const circular: any = { a: 1 };
		circular.self = circular;
		const out = capToolResult(circular) as string;
		expect(typeof out).toBe("string");
		expect(out.length).toBeGreaterThan(0);
	});

	it("includes original char count in truncation notice for structured results", () => {
		const large = { items: Array.from({ length: 2000 }, () => "x".repeat(50)) };
		const stringified = JSON.stringify(large);
		const out = capToolResult(large) as string;
		expect(out).toContain(String(stringified.length));
	});

	it("restores byte-identical string truncation: slices at maxChars with no headroom", () => {
		const input = "x".repeat(40_050);
		const out = capToolResult(input) as string;
		expect(out).toMatch(/^x{40000}\n\[Truncated by Hydrate/);
		expect(out).toContain("showing the first 40000.");
	});
});

describe("clampAttachedFile", () => {
	it("returns short content unchanged by reference", () => {
		const content = "hello world";
		expect(clampAttachedFile(content)).toBe(content);
	});

	it("returns truncated content as a string with notice", () => {
		const content = "x".repeat(MAX_ATTACHED_FILE_CHARS + 5000);
		const out = clampAttachedFile(content);
		expect(out.length).toBeLessThanOrEqual(MAX_ATTACHED_FILE_CHARS);
		expect(out).toContain("[Attached file");
		expect(out).toContain(String(content.length));
	});

	it("includes readFile and offset in the truncation notice", () => {
		const content = "x".repeat(MAX_ATTACHED_FILE_CHARS + 1000);
		const out = clampAttachedFile(content);
		expect(out).toContain("readFile");
		expect(out).toContain("offset");
	});
});

describe("sliceFileContent", () => {
	const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
	const content = lines.join("\n");

	it("returns whole small files untouched", () => {
		expect(sliceFileContent(content)).toBe(content);
	});

	it("slices by 1-based offset and limit with a notice", () => {
		const out = sliceFileContent(content, 10, 3);
		expect(out).toContain("line 10");
		expect(out).toContain("line 12");
		expect(out).not.toContain("line 13");
		expect(out).toContain("100 lines");
		expect(out).toContain("lines 10-12");
	});

	it("clamps offset beyond EOF to a notice instead of empty output", () => {
		const out = sliceFileContent(content, 500, 5);
		expect(out).toContain("100 lines");
		expect(out).toContain("offset 500 is past the end");
	});

	it("caps huge unpaged files at MAX_TOOL_RESULT_CHARS with a notice", () => {
		const huge = "y".repeat(MAX_TOOL_RESULT_CHARS * 2);
		const out = sliceFileContent(huge);
		expect(out.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS + 300);
		expect(out).toContain("offset/limit");
	});

	it("char-capped output survives capToolResult with its notice intact", () => {
		const huge = "y".repeat(MAX_TOOL_RESULT_CHARS * 2);
		const out = capToolResult(sliceFileContent(huge)) as string;
		expect(out).toContain("offset/limit");
		expect(out.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
	});
});
