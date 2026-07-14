import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThrottle } from "./throttle";

describe("createThrottle", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("does not call fn synchronously", () => {
		const fn = vi.fn();
		const throttled = createThrottle(fn, 100);

		throttled("a");

		expect(fn).not.toHaveBeenCalled();
	});

	it("calls fn once after the delay with the call's arguments", () => {
		const fn = vi.fn();
		const throttled = createThrottle(fn, 100);

		throttled("a");
		vi.advanceTimersByTime(100);

		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith("a");
	});

	it("coalesces bursts within the window into a single trailing call with the latest args", () => {
		const fn = vi.fn();
		const throttled = createThrottle(fn, 100);

		throttled("a");
		vi.advanceTimersByTime(30);
		throttled("b");
		vi.advanceTimersByTime(30);
		throttled("c");
		vi.advanceTimersByTime(100);

		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith("c");
	});

	it("fires again for a call that arrives after the window elapsed", () => {
		const fn = vi.fn();
		const throttled = createThrottle(fn, 100);

		throttled("a");
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(1);

		throttled("b");
		vi.advanceTimersByTime(100);

		expect(fn).toHaveBeenCalledTimes(2);
		expect(fn).toHaveBeenLastCalledWith("b");
	});

	it("never fires more than once per window under continuous calls (throttle, not debounce)", () => {
		const fn = vi.fn();
		const throttled = createThrottle(fn, 100);

		// A call every 10ms for 350ms should yield firings at ~100, ~200, ~300 -
		// i.e. bounded by floor(350/100) + epsilon, never one per call (35 calls).
		for (let elapsed = 0; elapsed <= 350; elapsed += 10) {
			throttled(elapsed);
			vi.advanceTimersByTime(10);
		}

		expect(fn.mock.calls.length).toBeGreaterThan(0);
		expect(fn.mock.calls.length).toBeLessThanOrEqual(4);
	});

	it("cancel() prevents a pending scheduled call from firing", () => {
		const fn = vi.fn();
		const throttled = createThrottle(fn, 100);

		throttled("a");
		throttled.cancel();
		vi.advanceTimersByTime(1000);

		expect(fn).not.toHaveBeenCalled();
	});

	it("cancel() is a safe no-op when nothing is pending", () => {
		const fn = vi.fn();
		const throttled = createThrottle(fn, 100);

		expect(() => throttled.cancel()).not.toThrow();
		vi.advanceTimersByTime(1000);
		expect(fn).not.toHaveBeenCalled();
	});

	it("a call after cancel() schedules a fresh window", () => {
		const fn = vi.fn();
		const throttled = createThrottle(fn, 100);

		throttled("a");
		throttled.cancel();
		throttled("b");
		vi.advanceTimersByTime(100);

		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith("b");
	});

	it("calling cancel() twice in a row is idempotent and does not throw", () => {
		const fn = vi.fn();
		const throttled = createThrottle(fn, 100);

		throttled("a");
		expect(() => {
			throttled.cancel();
			throttled.cancel();
		}).not.toThrow();
		vi.advanceTimersByTime(1000);

		expect(fn).not.toHaveBeenCalled();
	});
});
