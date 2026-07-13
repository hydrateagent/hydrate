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
});
