import { describe, expect, it } from "vitest";
import { readSseStream } from "./sseClient";
import type { SseCallbacks } from "./sseClient";

const encoder = new TextEncoder();

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
	let i = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (i < chunks.length) {
				controller.enqueue(chunks[i]);
				i++;
			} else {
				controller.close();
			}
		},
	});
}

function streamFromStrings(strings: string[]): ReadableStream<Uint8Array> {
	return streamFromChunks(strings.map((s) => encoder.encode(s)));
}

function streamFromChunksWithCancel(
	chunks: Uint8Array[],
	onCancel: () => void
): ReadableStream<Uint8Array> {
	let i = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (i < chunks.length) {
				controller.enqueue(chunks[i]);
				i++;
			} else {
				controller.close();
			}
		},
		cancel() {
			onCancel();
		},
	});
}

type LogEntry =
	| { type: "token"; text: string }
	| { type: "thinking"; text: string }
	| { type: "done"; response: unknown }
	| { type: "error"; message: string };

function makeCallbacks(withThinking = false): {
	cb: SseCallbacks;
	log: LogEntry[];
} {
	const log: LogEntry[] = [];
	const cb: SseCallbacks = {
		onToken: (text) => log.push({ type: "token", text }),
		onDone: (response) => log.push({ type: "done", response }),
		onError: (message) => log.push({ type: "error", message }),
	};
	if (withThinking) {
		cb.onThinking = (text) => log.push({ type: "thinking", text });
	}
	return { cb, log };
}

describe("readSseStream", () => {
	it("dispatches token events then done in order with exact payloads", async () => {
		const { cb, log } = makeCallbacks();
		const stream = streamFromStrings([
			'data: {"type":"token","text":"Hel"}\n\n',
			'data: {"type":"token","text":"lo"}\n\n',
			'data: {"type":"done","response":{"id":"abc"}}\n\n',
		]);

		await readSseStream(stream, cb);

		expect(log).toEqual([
			{ type: "token", text: "Hel" },
			{ type: "token", text: "lo" },
			{ type: "done", response: { id: "abc" } },
		]);
	});

	it("dispatches thinking events to onThinking when provided, interleaved with tokens", async () => {
		const { cb, log } = makeCallbacks(true);
		const stream = streamFromStrings([
			'data: {"type":"thinking","text":"pondering"}\n\n',
			'data: {"type":"token","text":"Answer"}\n\n',
			'data: {"type":"done","response":{}}\n\n',
		]);

		await readSseStream(stream, cb);

		expect(log).toEqual([
			{ type: "thinking", text: "pondering" },
			{ type: "token", text: "Answer" },
			{ type: "done", response: {} },
		]);
	});

	it("silently drops thinking events when onThinking is not provided", async () => {
		const { cb, log } = makeCallbacks();
		const stream = streamFromStrings([
			'data: {"type":"thinking","text":"pondering"}\n\n',
			'data: {"type":"token","text":"Answer"}\n\n',
			'data: {"type":"done","response":{}}\n\n',
		]);

		await readSseStream(stream, cb);

		expect(log).toEqual([
			{ type: "token", text: "Answer" },
			{ type: "done", response: {} },
		]);
	});

	it("reassembles an event split mid data-prefix and mid-JSON across chunk boundaries", async () => {
		const { cb, log } = makeCallbacks();
		const eventOne = 'data: {"type":"token","text":"hello"}\n\n';
		const eventTwo = 'data: {"type":"done","response":null}\n\n';
		const full = eventOne + eventTwo;

		// Split inside the "data: " prefix (index 3 is between 't' and 'a').
		const prefixSplit = 3;
		// Split inside the first event's JSON payload.
		const jsonSplit = eventOne.indexOf('"text"') + 2;

		const stream = streamFromStrings([
			full.slice(0, prefixSplit),
			full.slice(prefixSplit, jsonSplit),
			full.slice(jsonSplit),
		]);

		await readSseStream(stream, cb);

		expect(log).toEqual([
			{ type: "token", text: "hello" },
			{ type: "done", response: null },
		]);
	});

	it("decodes a multi-byte UTF-8 character split across chunk boundaries", async () => {
		const { cb, log } = makeCallbacks();
		const payload = JSON.stringify({ type: "token", text: "café 猫" });
		const line = `data: ${payload}\n\n`;
		const doneLine = 'data: {"type":"done","response":null}\n\n';
		const bytes = encoder.encode(line + doneLine);

		// Find the lead byte of a multi-byte UTF-8 sequence and split right after it,
		// mid-character.
		let splitIndex = -1;
		for (let i = 0; i < bytes.length; i++) {
			if (bytes[i] >= 0xc0) {
				splitIndex = i + 1;
				break;
			}
		}
		expect(splitIndex).toBeGreaterThan(0);

		const stream = streamFromChunks([bytes.slice(0, splitIndex), bytes.slice(splitIndex)]);

		await readSseStream(stream, cb);

		expect(log).toEqual([
			{ type: "token", text: "café 猫" },
			{ type: "done", response: null },
		]);
	});

	it("ignores interleaved garbage lines and unknown event types", async () => {
		const { cb, log } = makeCallbacks();
		const stream = streamFromStrings([
			"random garbage line\n",
			'data: {"type":"token","text":"hi"}\nfoo: bar\n\n',
			"data: {not valid json\n\n",
			'data: {"type":"future_event","foo":"bar"}\n\n',
			'data: {"type":"done","response":{"ok":true}}\n\n',
		]);

		await readSseStream(stream, cb);

		expect(log).toEqual([
			{ type: "token", text: "hi" },
			{ type: "done", response: { ok: true } },
		]);
	});

	it("calls onError with a fixed message when the stream ends without a done event", async () => {
		const { cb, log } = makeCallbacks();
		const stream = streamFromStrings(['data: {"type":"token","text":"hi"}\n\n']);

		await readSseStream(stream, cb);

		expect(log).toEqual([
			{ type: "token", text: "hi" },
			{ type: "error", message: "Stream ended unexpectedly" },
		]);
	});

	it("dispatches onError for an error event and suppresses a subsequent bogus done", async () => {
		const { cb, log } = makeCallbacks();
		const stream = streamFromStrings([
			'data: {"type":"error","message":"boom"}\n\n',
			'data: {"type":"done","response":{}}\n\n',
		]);

		await readSseStream(stream, cb);

		expect(log).toEqual([{ type: "error", message: "boom" }]);
	});

	it("routes a reader error to onError without throwing", async () => {
		const { cb, log } = makeCallbacks();
		let calls = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				calls++;
				if (calls === 1) {
					controller.enqueue(encoder.encode('data: {"type":"token","text":"hi"}\n\n'));
					return;
				}
				controller.error(new Error("connection reset"));
			},
		});

		await expect(readSseStream(stream, cb)).resolves.toBeUndefined();

		expect(log).toEqual([
			{ type: "token", text: "hi" },
			{ type: "error", message: "connection reset" },
		]);
	});

	it("cancels the reader when a terminal event arrives while the stream is still open", async () => {
		const { cb, log } = makeCallbacks();
		let cancelled = false;
		const stream = streamFromChunksWithCancel(
			[encoder.encode('data: {"type":"done","response":{"ok":true}}\n\n')],
			() => {
				cancelled = true;
			}
		);

		await readSseStream(stream, cb);

		expect(log).toEqual([{ type: "done", response: { ok: true } }]);
		expect(cancelled).toBe(true);
	});

	it("does not cancel the reader when the terminal event is only found via the end-of-stream flush", async () => {
		const { cb, log } = makeCallbacks();
		let cancelled = false;
		const stream = streamFromChunksWithCancel(
			// No trailing "\n\n": the reader must observe done: true (natural
			// end) before the flush path dispatches this as the last event.
			[encoder.encode('data: {"type":"done","response":{"ok":true}}')],
			() => {
				cancelled = true;
			}
		);

		await readSseStream(stream, cb);

		expect(log).toEqual([{ type: "done", response: { ok: true } }]);
		expect(cancelled).toBe(false);
	});

	it("parses CRLF-framed events the same as LF-framed events", async () => {
		const { cb, log } = makeCallbacks();
		const stream = streamFromStrings([
			'data: {"type":"token","text":"hi"}\r\n\r\n',
			'data: {"type":"done","response":{"ok":true}}\r\n\r\n',
		]);

		await readSseStream(stream, cb);

		expect(log).toEqual([
			{ type: "token", text: "hi" },
			{ type: "done", response: { ok: true } },
		]);
	});

	it("dispatches the final event via flush when the stream closes without a trailing blank line", async () => {
		const { cb, log } = makeCallbacks();
		const stream = streamFromStrings([
			'data: {"type":"token","text":"hi"}\n\n',
			'data: {"type":"done","response":{"ok":true}}', // no trailing \n\n
		]);

		await readSseStream(stream, cb);

		expect(log).toEqual([
			{ type: "token", text: "hi" },
			{ type: "done", response: { ok: true } },
		]);
	});

	it("ignores a trailing event bundled in the same chunk after a terminal event", async () => {
		const { cb, log } = makeCallbacks();
		const stream = streamFromStrings([
			'data: {"type":"done","response":{"ok":true}}\n\n' +
				'data: {"type":"token","text":"should not appear"}\n\n',
		]);

		await readSseStream(stream, cb);

		expect(log).toEqual([{ type: "done", response: { ok: true } }]);
	});
});
