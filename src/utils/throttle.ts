/**
 * A callable throttled wrapper around `fn`. Exposes `cancel()` to drop any
 * pending trailing call without invoking it.
 */
export interface Throttled<Args extends unknown[]> {
	(...args: Args): void;
	cancel(): void;
}

/**
 * Trailing-edge throttle: calls to the returned function never invoke `fn`
 * immediately. Instead, the first call schedules `fn` to run after `ms`
 * milliseconds with whatever arguments were passed most recently at that
 * point. If further calls keep arriving, `fn` fires at most once every `ms`
 * milliseconds. `cancel()` drops a pending scheduled call, if any.
 */
/**
 * Trailing-edge debounce: `fn` runs once, `ms` milliseconds after the LAST
 * call in a burst, with that call's arguments. Unlike createThrottle, every
 * new call resets the timer — so a rapid burst produces exactly one
 * invocation reflecting the final state. `cancel()` drops a pending call.
 */
export function createDebounce<Args extends unknown[]>(
	fn: (...args: Args) => void,
	ms: number,
): Throttled<Args> {
	let timer: ReturnType<typeof setTimeout> | null = null;

	const debounced = ((...args: Args) => {
		if (timer !== null) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			timer = null;
			fn(...args);
		}, ms);
	}) as Throttled<Args>;

	debounced.cancel = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	return debounced;
}

export function createThrottle<Args extends unknown[]>(
	fn: (...args: Args) => void,
	ms: number,
): Throttled<Args> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pendingArgs: Args | null = null;

	const throttled = ((...args: Args) => {
		pendingArgs = args;
		if (timer === null) {
			timer = setTimeout(() => {
				timer = null;
				const args = pendingArgs;
				pendingArgs = null;
				if (args) {
					fn(...args);
				}
			}, ms);
		}
	}) as Throttled<Args>;

	throttled.cancel = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		pendingArgs = null;
	};

	return throttled;
}
