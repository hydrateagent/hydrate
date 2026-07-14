import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { httpRequest } from "./httpClient";

describe("httpRequest", () => {
	const originalFetch = global.fetch;

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it("exposes body and contentType alongside the existing ok/status/json/text fields", async () => {
		const body = new ReadableStream<Uint8Array>();
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(body, {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			}),
		);
		global.fetch = fetchMock as unknown as typeof fetch;

		const response = await httpRequest("https://example.com/chat");

		expect(response.ok).toBe(true);
		expect(response.status).toBe(200);
		expect(response.contentType).toBe("text/event-stream");
		expect(response.body).not.toBeNull();
	});

	it("reports an empty contentType string when the response has no Content-Type header", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(null, { status: 204 }));
		global.fetch = fetchMock as unknown as typeof fetch;

		const response = await httpRequest("https://example.com/chat");

		expect(response.contentType).toBe("");
	});

	it("returns null body and empty contentType on network failure", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
		global.fetch = fetchMock as unknown as typeof fetch;

		const response = await httpRequest("https://example.com/chat");

		expect(response.ok).toBe(false);
		expect(response.status).toBe(0);
		expect(response.body).toBeNull();
		expect(response.contentType).toBe("");
	});

	it("still resolves json() and text() as before", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ hello: "world" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		global.fetch = fetchMock as unknown as typeof fetch;

		const response = await httpRequest("https://example.com/chat");

		await expect(response.json()).resolves.toEqual({ hello: "world" });
	});
});
