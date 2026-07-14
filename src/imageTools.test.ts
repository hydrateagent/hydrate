import { describe, expect, it } from "vitest";
import { isSupportedMime, mimeTypeForPath, validateImageUrl } from "./imageTools";

describe("mimeTypeForPath", () => {
	it("maps supported extensions case-insensitively", () => {
		expect(mimeTypeForPath("a/b/photo.PNG")).toBe("image/png");
		expect(mimeTypeForPath("x.jpeg")).toBe("image/jpeg");
		expect(mimeTypeForPath("x.jpg")).toBe("image/jpeg");
		expect(mimeTypeForPath("x.webp")).toBe("image/webp");
		expect(mimeTypeForPath("x.gif")).toBe("image/gif");
	});

	it("rejects unsupported types", () => {
		expect(mimeTypeForPath("x.svg")).toBeNull();
		expect(mimeTypeForPath("x.md")).toBeNull();
		expect(mimeTypeForPath("no-extension")).toBeNull();
	});
});

describe("validateImageUrl", () => {
	it("accepts http(s) URLs", () => {
		expect(validateImageUrl("https://example.com/a.png")).toBeNull();
		expect(validateImageUrl("http://example.com/a.png")).toBeNull();
	});

	it("rejects other schemes and garbage", () => {
		expect(validateImageUrl("file:///etc/passwd")).not.toBeNull();
		expect(validateImageUrl("app://obsidian.md/x.png")).not.toBeNull();
		expect(validateImageUrl("not a url")).not.toBeNull();
	});
});

describe("isSupportedMime", () => {
	it("matches the extension-map values exactly", () => {
		expect(isSupportedMime("image/png")).toBe(true);
		expect(isSupportedMime("image/webp")).toBe(true);
		expect(isSupportedMime("image/svg+xml")).toBe(false);
		expect(isSupportedMime("image/avif")).toBe(false);
	});
});
