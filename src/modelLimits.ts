// Mirror of the per-model token-limit defaults in src/model_limits.py
// (backend `CONTEXT_WINDOWS` + the output-limit table) — keep in sync.
// Precedent: ALLOWED_MODELS in main.ts mirrors backend agent.py's model
// list the same way.

export type TokenLimits = {
	input: number;
	output: number;
};

export type TokenLimitOverrides = {
	input?: number;
	output?: number;
};

// output default / input default (context window), per model.
export const MODEL_TOKEN_LIMITS: Record<string, TokenLimits> = {
	"gpt-5.5": { output: 32_768, input: 400_000 },
	"gpt-5.4": { output: 32_768, input: 400_000 },
	"gpt-5.4-mini": { output: 32_768, input: 400_000 },
	"gpt-5.4-nano": { output: 32_768, input: 400_000 },
	"claude-opus-4-8": { output: 32_000, input: 200_000 },
	"claude-sonnet-4-6": { output: 64_000, input: 200_000 },
	"claude-haiku-4-5": { output: 64_000, input: 200_000 },
	"gemini-3.1-pro-preview": { output: 65_536, input: 1_000_000 },
	"gemini-3.5-flash": { output: 65_536, input: 1_000_000 },
	"gemini-3.1-flash-lite": { output: 65_536, input: 1_000_000 },
};

// Unknown model (not in the table above) ⇒ conservative fallback.
export const FALLBACK_TOKEN_LIMITS: TokenLimits = {
	output: 32_768,
	input: 200_000,
};

// Mirrors the backend clamp bounds (plan's Global Constraints: "Backend
// clamps overrides to sane bounds") — the settings UI rejects overrides
// outside these ranges before they're ever sent.
export const OUTPUT_LIMIT_RANGE = { min: 256, max: 131_072 };
export const INPUT_LIMIT_RANGE = { min: 8_192, max: 2_000_000 };

/** Per-model defaults, used for settings UI placeholders. */
export function getModelDefaults(model: string): TokenLimits {
	return MODEL_TOKEN_LIMITS[model] ?? FALLBACK_TOKEN_LIMITS;
}

/**
 * Resolves the effective token limits for a model: an explicit override
 * wins, otherwise the model's default (or the conservative fallback for
 * an unrecognized model).
 */
export function resolveLimits(
	model: string,
	overrides?: TokenLimitOverrides,
): TokenLimits {
	const defaults = getModelDefaults(model);
	return {
		input: overrides?.input ?? defaults.input,
		output: overrides?.output ?? defaults.output,
	};
}
