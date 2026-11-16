/**
 * Server-side validation of knowledge-base uploads. The client-supplied MIME
 * type is never trusted: the type is derived from the (allow-listed) file
 * extension AND confirmed by the file's own bytes.
 */
import { INPUT } from "./limits";

export type UploadKind = "text" | "html" | "pdf" | "image";
export type UploadCheck =
  | { ok: true; filename: string; mimeType: string; kind: UploadKind }
  | { ok: false; reason: string };

const BY_EXTENSION: Record<string, { mimeType: string; kind: UploadKind }> = {
  txt: { mimeType: "text/plain", kind: "text" },
  md: { mimeType: "text/plain", kind: "text" },
  csv: { mimeType: "text/plain", kind: "text" },
  html: { mimeType: "text/html", kind: "html" },
  htm: { mimeType: "text/html", kind: "html" },
  pdf: { mimeType: "application/pdf", kind: "pdf" },
  png: { mimeType: "image/png", kind: "image" },
  jpg: { mimeType: "image/jpeg", kind: "image" },
  jpeg: { mimeType: "image/jpeg", kind: "image" },
  webp: { mimeType: "image/webp", kind: "image" },
  gif: { mimeType: "image/gif", kind: "image" },
};

export const ALLOWED_EXTENSIONS = Object.keys(BY_EXTENSION);

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((x, i) => b[offset + i] === x);
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));

function matchesSignature(ext: string, b: Uint8Array): boolean {
  switch (ext) {
    case "pdf":
      return startsWith(b, ascii("%PDF-"));
    case "png":
      return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg":
    case "jpeg":
      return startsWith(b, [0xff, 0xd8, 0xff]);
    case "gif":
      return startsWith(b, ascii("GIF87a")) || startsWith(b, ascii("GIF89a"));
    case "webp":
      return startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8);
    default:
      return true;
  }
}

function isUtf8Text(b: Uint8Array): boolean {
  if (b.includes(0)) return false; // NUL byte: binary
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

export function validateUpload(filename: string, bytes: ArrayBuffer): UploadCheck {
  const name = filename.trim();
  if (name.length === 0 || name.length > INPUT.FILENAME_MAX) return { ok: false, reason: "Invalid file name" };
  // eslint-disable-next-line no-control-regex
  if (/[\\/\u0000-\u001f]/.test(name)) return { ok: false, reason: "Invalid file name" };

  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const type = BY_EXTENSION[ext];
  if (!type) return { ok: false, reason: `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}` };

  if (bytes.byteLength === 0) return { ok: false, reason: "The file is empty" };
  if (bytes.byteLength > INPUT.FILE_MAX_BYTES) {
    return { ok: false, reason: `The file is larger than ${INPUT.FILE_MAX_BYTES / (1024 * 1024)} MB` };
  }

  const view = new Uint8Array(bytes);
  if (!matchesSignature(ext, view)) return { ok: false, reason: "The file content does not match its type" };
  if ((type.kind === "text" || type.kind === "html") && !isUtf8Text(view)) {
    return { ok: false, reason: "The file is not valid UTF-8 text" };
  }
  return { ok: true, filename: name, mimeType: type.mimeType, kind: type.kind };
}
