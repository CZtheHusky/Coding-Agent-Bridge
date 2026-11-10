import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { ImageAttachment } from "../interfaces.js";
import { BridgeError } from "../runtime/errors.js";

export interface ResolvedImage {
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/** Read only the signature; the executor loads the image through its native attachment API. */
export async function resolveImageAttachments(attachments?: readonly ImageAttachment[]): Promise<ResolvedImage[]> {
  if (attachments === undefined) return [];
  if (!Array.isArray(attachments) || attachments.some(image => !image || typeof image.path !== "string" || !path.isAbsolute(image.path))) {
    throw new BridgeError("attachment_invalid", "attachments must be an array of {path: absolute image path} objects");
  }
  const images: ResolvedImage[] = [];
  for (const attachment of attachments) {
    try {
      const canonical = await realpath(attachment.path);
      if (!(await stat(canonical)).isFile()) throw new Error("not a regular file");
      // A replaced FIFO must not block validation indefinitely.
      const file = await open(canonical, constants.O_RDONLY | constants.O_NONBLOCK);
      try {
        const info = await file.stat();
        if (!info.isFile()) throw new Error("not a regular file");
        const header = Buffer.alloc(12);
        const { bytesRead } = await file.read(header, 0, header.length, 0);
        const signature = header.subarray(0, bytesRead);
        const mimeType = signature.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ? "image/png"
          : signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff ? "image/jpeg"
          : /^(GIF87a|GIF89a)$/.test(signature.subarray(0, 6).toString("ascii")) ? "image/gif"
          : signature.subarray(0, 4).toString("ascii") === "RIFF" && signature.subarray(8, 12).toString("ascii") === "WEBP" ? "image/webp" : null;
        if (!mimeType) throw new Error("unsupported image signature");
        images.push({ path: canonical, filename: path.basename(attachment.path), mimeType, sizeBytes: info.size });
      } finally { await file.close(); }
    } catch {
      throw new BridgeError("attachment_invalid", `Image attachment must be a readable PNG, JPEG, GIF or WebP regular file: ${attachment.path}`);
    }
  }
  return images;
}
