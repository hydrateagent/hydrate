/**
 * Pure fetch-reader SSE (Server-Sent Events) parser.
 *
 * Wire format: `data: <json>\n\n` per event, where json is one of
 * `{"type":"token","text":str}`, `{"type":"done","response":<...>}`,
 * or `{"type":"error","message":str}`. No `event:`/`id:` fields.
 * A stream ending without a `done` or `error` event is itself an error.
 */

export interface SseCallbacks {
	onToken(text: string): void;
	onDone(response: unknown): void;
	onError(message: string): void;
}

/**
 * Parses one buffered event block (the text between two `\n\n` delimiters,
 * with the delimiters themselves stripped) and dispatches the matching
 * callback. Returns true if the event was terminal (done or error).
 */
function dispatchEvent(raw: string, cb: SseCallbacks): boolean {
	const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
	if (dataLine === undefined) return false;

	let parsed: unknown;
	try {
		parsed = JSON.parse(dataLine.slice("data: ".length));
	} catch {
		return false;
	}
	if (typeof parsed !== "object" || parsed === null) return false;
	const event = parsed as Record<string, unknown>;

	if (event.type === "token") {
		if (typeof event.text === "string") {
			cb.onToken(event.text);
		}
		return false;
	}
	if (event.type === "done") {
		cb.onDone(event.response);
		return true;
	}
	if (event.type === "error") {
		cb.onError(typeof event.message === "string" ? event.message : "Unknown error");
		return true;
	}
	// Unknown event type: ignore for forward compatibility.
	return false;
}

export async function readSseStream(
	body: ReadableStream<Uint8Array>,
	cb: SseCallbacks
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder("utf-8");
	let buffer = "";
	let terminal = false;

	try {
		while (!terminal) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

			let boundary: number;
			while ((boundary = buffer.indexOf("\n\n")) !== -1) {
				const raw = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				if (dispatchEvent(raw, cb)) {
					terminal = true;
					break;
				}
			}
		}

		if (!terminal) {
			// Flush any bytes the decoder held back, and try the trailing
			// buffered event in case the stream closed without a final \n\n.
			buffer += decoder.decode();
			if (buffer.length > 0 && dispatchEvent(buffer, cb)) {
				terminal = true;
			}
		}
	} catch (error) {
		if (!terminal) {
			cb.onError(error instanceof Error ? error.message : String(error));
		}
		return;
	} finally {
		reader.releaseLock();
	}

	if (!terminal) {
		cb.onError("Stream ended unexpectedly");
	}
}
