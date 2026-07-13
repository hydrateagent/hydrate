import { describe, expect, it } from "vitest";
import {
	MAX_TOOL_RESULT_CHARS,
	capToolResult,
	sliceFileContent,
} from "./toolOutputLimits";

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
