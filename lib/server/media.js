import http from "node:http";
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10 MB
/**
 * Download an image from a file URL and save it to DSH attachments.
 * Returns the raw Uint8Array.
 */
export async function downloadAndSaveImage(fileUrl, ctx, maxSize = DEFAULT_MAX_SIZE, httpGet) {
    const data = await downloadFile(fileUrl, ctx, maxSize, httpGet);
    // Validate it looks like an image (basic check)
    validateImageFormat(data);
    const refs = await ctx.attachments.saveImages([
        {
            data,
            mediaType: detectMediaType(data),
            name: "telegram_photo",
        },
    ]);
    if (refs.length === 0) {
        throw new Error("Failed to save image attachment");
    }
    return data;
}
/**
 * Download a file from a file URL and save it to DSH attachments.
 * Returns the raw Uint8Array.
 */
export async function downloadAndSaveFile(fileUrl, ctx, maxSize = DEFAULT_MAX_SIZE, httpGet) {
    const data = await downloadFile(fileUrl, ctx, maxSize, httpGet);
    await ctx.attachments.saveFile({
        data,
        name: "telegram_document",
    });
    return data;
}
/**
 * Download a file from a URL to a Uint8Array.
 */
async function downloadFile(fileUrl, ctx, maxSize, httpGet) {
    const chunks = [];
    let totalSize = 0;
    if (httpGet) {
        // Use injective HTTP for tests
        const response = await httpGet(fileUrl);
        if (response.statusCode !== 200) {
            ctx.logger.error(`Failed to download file: HTTP ${response.statusCode}`);
            throw new Error(`Failed to download file: HTTP ${response.statusCode}`);
        }
        const contentLength = response.headers["content-length"];
        if (contentLength) {
            const size = Array.isArray(contentLength)
                ? parseInt(contentLength[0], 10)
                : parseInt(contentLength, 10);
            if (size > maxSize) {
                ctx.logger.error(`File too large: ${size} > ${maxSize}`);
                throw new Error(`File too large: ${size} > ${maxSize}`);
            }
        }
        if (response.body.length > maxSize) {
            ctx.logger.error(`Download exceeded limit: ${response.body.length} > ${maxSize}`);
            throw new Error(`Download exceeded size limit: ${response.body.length} > ${maxSize}`);
        }
        chunks.push(response.body);
        return Buffer.concat(chunks);
    }
    // fileUrl can be absolute or relative to api.telegram.org
    let url;
    try {
        url = new URL(fileUrl);
    }
    catch {
        throw new Error(`Invalid file URL: ${fileUrl}`);
    }
    // If the URL doesn't have HTTPS, it's likely a file_path from Telegram
    if (url.protocol !== "https:") {
        throw new Error(`Invalid file URL: ${fileUrl}`);
    }
    return new Promise((resolve, reject) => {
        http.get(url.toString(), { headers: { "User-Agent": "DSH-Telegram-Bot/1.0" } }, (res) => {
            if (res.statusCode !== 200) {
                ctx.logger.error(`Failed to download file: HTTP ${res.statusCode}`);
                reject(new Error(`Failed to download file: HTTP ${res.statusCode}`));
                return;
            }
            const contentLength = res.headers["content-length"];
            if (contentLength) {
                const size = parseInt(contentLength, 10);
                if (size > maxSize) {
                    ctx.logger.error(`File too large: ${size} > ${maxSize}`);
                    res.resume(); // drain
                    reject(new Error(`File too large: ${size} > ${maxSize}`));
                    return;
                }
            }
            res.on("data", (chunk) => {
                totalSize += chunk.length;
                if (totalSize > maxSize) {
                    ctx.logger.error(`Download exceeded limit: ${totalSize} > ${maxSize}`);
                    res.destroy();
                    reject(new Error(`Download exceeded size limit: ${totalSize} > ${maxSize}`));
                    return;
                }
                chunks.push(chunk);
            });
            res.on("end", () => {
                resolve(Buffer.concat(chunks));
            });
            res.on("error", (err) => {
                ctx.logger.error(`Download error: ${err.message}`);
                reject(err);
            });
        }).on("error", (err) => {
            ctx.logger.error(`Download error: ${err.message}`);
            reject(err);
        });
    });
}
/**
 * Validate that the data looks like a valid image format.
 */
function validateImageFormat(data) {
    if (data.length < 4) {
        throw new Error("Data too small to be an image");
    }
    // Check PNG signature
    const pngSig = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
    // Check JPEG signature
    const jpegSig = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    // Check WebP signature
    const webpSig = data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
        data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50;
    // Check GIF signature
    const gifSig = data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38;
    if (!pngSig && !jpegSig && !webpSig && !gifSig) {
        throw new Error("Data does not appear to be a valid image format");
    }
}
/**
 * Detect the media type from image data.
 */
function detectMediaType(data) {
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
        return "image/png";
    }
    if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
        return "image/jpeg";
    }
    if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
        data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
        return "image/webp";
    }
    if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
        return "image/gif";
    }
    // Default to jpeg if we can't determine
    return "image/jpeg";
}
//# sourceMappingURL=media.js.map