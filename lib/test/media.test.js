import { mock } from "node:test";
import assert from "node:assert/strict";
import { downloadAndSaveImage, downloadAndSaveFile } from "../src/server/media.js";
import { createFakeContext } from "./helper.js";
describe("Media", () => {
    let ctx;
    beforeEach(() => {
        ctx = createFakeContext();
        ctx.logger = {
            error: (msg) => console.log("ERROR:", msg),
        };
    });
    function createMockResponse(data, statusCode = 200, contentLength) {
        return {
            statusCode,
            headers: contentLength !== undefined ? { "content-length": String(contentLength) } : {},
            on: (event, handler) => {
                if (event === "data") {
                    setTimeout(() => handler(data), 0);
                }
                if (event === "end") {
                    setTimeout(() => handler(), 0);
                }
                return {};
            },
            resume: () => { },
            destroy: () => { },
        };
    }
    it("downloadAndSaveImage saves image data", async () => {
        const pngData = createMinimalPng();
        const http = await import("node:http");
        mock.method(http, "get", (_url, _options, callback) => {
            callback(createMockResponse(Buffer.from(pngData), 200, pngData.length));
            return {
                on: () => { },
            };
        });
        const result = await downloadAndSaveImage("https://example.com/file.png", ctx);
        assert.ok(result instanceof Uint8Array);
        assert.equal(result.length, pngData.length);
        assert.equal(ctx.attachments.savedImages.length, 1);
        assert.equal(ctx.attachments.savedImages[0].mediaType, "image/png");
    });
    it("downloadAndSaveFile saves file data", async () => {
        const fileData = new TextEncoder().encode("Hello, this is a test file!");
        const http = await import("node:http");
        mock.method(http, "get", (_url, _options, callback) => {
            callback(createMockResponse(Buffer.from(fileData), 200, fileData.length));
            return {
                on: () => { },
            };
        });
        const result = await downloadAndSaveFile("https://example.com/file.txt", ctx);
        assert.ok(result instanceof Uint8Array);
        assert.equal(result.length, fileData.length);
        assert.equal(ctx.attachments.savedFiles.length, 1);
    });
    it("rejects files larger than maxSize", async () => {
        const largeData = new Uint8Array(20 * 1024 * 1024); // 20 MB
        const http = await import("node:http");
        mock.method(http, "get", (_url, _options, callback) => {
            callback(createMockResponse(Buffer.from(largeData), 200, largeData.length));
            return {
                on: () => { },
            };
        });
        await assert.rejects(() => downloadAndSaveFile("https://example.com/large.bin", ctx, 10 * 1024 * 1024), { message: /too large|exceeded/i });
    });
    it("logs download errors", async () => {
        const logs = [];
        ctx.logger = {
            error: (msg) => logs.push(msg),
        };
        const http = await import("node:http");
        mock.method(http, "get", (_url, _options, callback) => {
            callback(createMockResponse(Buffer.from(""), 404));
            return {
                on: () => { },
            };
        });
        await assert.rejects(() => downloadAndSaveFile("https://example.com/missing.jpg", ctx), { message: /HTTP 404/ });
        assert.ok(logs.some((l) => l.includes("Failed to download")), "Should log download failure");
    });
});
/**
 * Create a minimal valid PNG file (1x1 transparent pixel).
 */
function createMinimalPng() {
    const bytes = [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
        0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0xfe, 0x00, 0x1e, 0x1f, 0x06, 0xb0, 0x02,
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
        0xae, 0x42, 0x60, 0x82,
    ];
    return new Uint8Array(bytes);
}
//# sourceMappingURL=media.test.js.map