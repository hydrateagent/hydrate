import { describe, expect, it } from "vitest";
import { extractSnippet } from "./searchSnippets";

describe("extractSnippet", () => {
	const doc = [
		"# Meeting notes",
		"attendees: jamie, alex",
		"",
		"We decided to adopt the quarterly roadmap format.",
		"Follow-up owned by alex.",
		"Unrelated trailing content.",
	].join("\n");

	it("returns lines around the first query-word match", () => {
		const out = extractSnippet(doc, "roadmap decision");
		expect(out).toContain("quarterly roadmap");
		expect(out).toContain("Follow-up"); // +context line
	});

	it("falls back to the head when nothing matches", () => {
		const out = extractSnippet(doc, "zzzz qqqq");
		expect(out).toContain("Meeting notes");
	});

	it("is single-line and capped", () => {
		const out = extractSnippet(doc, "roadmap", 2, 60);
		expect(out).not.toContain("\n");
		expect(out.length).toBeLessThanOrEqual(61);
	});

	it("ignores short stopword-ish query tokens", () => {
		const out = extractSnippet(doc, "of to el roadmap");
		expect(out).toContain("roadmap");
	});

	it("matches Cyrillic queries against Unicode content", () => {
		const cyrilDoc = [
			"Введение в систему",
			"",
			"",
			"контекстное окно находится здесь",
			"это нужно помнить",
		].join("\n");
		const out = extractSnippet(cyrilDoc, "контекстное окно");
		// Should match the Cyrillic phrase deep in the doc, not fall back to head
		expect(out).toContain("контекстное окно");
		expect(out).not.toContain("Введение");
	});

	it("matches accented Latin queries", () => {
		const accentDoc = [
			"Basic introduction",
			"",
			"",
			"The café serves excellent coffee today",
			"visit early for best selection",
		].join("\n");
		const out = extractSnippet(accentDoc, "café");
		expect(out).toContain("café");
		expect(out).not.toContain("Basic");
	});

	it("matches CJK queries", () => {
		const cjkDoc = [
			"文書の最初",
			"",
			"",
			"猫の名前は花子です",
			"これは重要です",
		].join("\n");
		const out = extractSnippet(cjkDoc, "猫の名前");
		expect(out).toContain("猫の名前");
		expect(out).not.toContain("文書");
	});
});
