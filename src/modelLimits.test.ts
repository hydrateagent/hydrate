import { describe, expect, it } from "vitest";
import {
	FALLBACK_TOKEN_LIMITS,
	MODEL_TOKEN_LIMITS,
	getModelDefaults,
	resolveLimits,
} from "./modelLimits";

describe("getModelDefaults", () => {
	it("returns the table entry for a known model", () => {
		expect(getModelDefaults("claude-sonnet-4-6")).toEqual({
			output: 64_000,
			input: 200_000,
		});
	});

	it("falls back to the conservative default for an unknown model", () => {
		expect(getModelDefaults("some-future-model")).toEqual(
			FALLBACK_TOKEN_LIMITS,
		);
	});
});

describe("resolveLimits", () => {
	it("uses the model default when no overrides are supplied", () => {
		expect(resolveLimits("gpt-5.4-mini")).toEqual({
			output: 32_768,
			input: 400_000,
		});
	});

	it("uses the model default when overrides is an empty object", () => {
		expect(resolveLimits("gpt-5.4-mini", {})).toEqual({
			output: 32_768,
			input: 400_000,
		});
	});

	it("prefers an output override over the default", () => {
		expect(resolveLimits("gpt-5.4-mini", { output: 5_000 })).toEqual({
			output: 5_000,
			input: 400_000,
		});
	});

	it("prefers an input override over the default", () => {
		expect(resolveLimits("gpt-5.4-mini", { input: 10_000 })).toEqual({
			output: 32_768,
			input: 10_000,
		});
	});

	it("prefers both overrides when both are supplied", () => {
		expect(
			resolveLimits("claude-opus-4-8", { input: 1_000, output: 2_000 }),
		).toEqual({ input: 1_000, output: 2_000 });
	});

	it("falls back to the conservative default for an unknown model with no overrides", () => {
		expect(resolveLimits("unknown-model")).toEqual(FALLBACK_TOKEN_LIMITS);
	});

	it("applies an override even for an unknown model", () => {
		expect(resolveLimits("unknown-model", { output: 1_234 })).toEqual({
			output: 1_234,
			input: 200_000,
		});
	});

	it("every model in the table has a positive input and output default", () => {
		Object.entries(MODEL_TOKEN_LIMITS).forEach(([model, limits]) => {
			expect(limits.output, model).toBeGreaterThan(0);
			expect(limits.input, model).toBeGreaterThan(0);
		});
	});
});
