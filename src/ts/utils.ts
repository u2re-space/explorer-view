/**
 * Shared utilities for file manager components
 *
 * Extracted common functionality from RsExplorer, FileManagerContent, and Operative.
 */

import type { FileEntry } from "./types";

// ============================================================================
// ICON MAPPING
// ============================================================================

/**
 * Get icon name by MIME type
 */
export const iconByMime = (mime: string | undefined, def = "file"): string => {
    if (!mime) return def;
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "music";
    if (mime.startsWith("video/")) return "video";
    if (mime === "application/pdf") return "file-text";
    if (mime.includes("zip") || mime.includes("7z") || mime.includes("rar")) return "file-archive";
    if (mime.includes("json")) return "brackets-curly";
    if (mime.includes("csv")) return "file-spreadsheet";
    if (mime.includes("xml")) return "code";
    if (mime.startsWith("text/")) return "file-text";
    return def;
};

/**
 * Extension to icon mapping
 */
const EXTENSION_ICON_MAP: Record<string, string> = {
    // Documents
    md: "file-text",
    txt: "file-text",
    pdf: "file-pdf",
    doc: "file-doc",
    docx: "file-doc",

    // Images
    png: "file-image",
    jpg: "file-image",
    jpeg: "file-image",
    gif: "file-image",
    svg: "file-image",
    webp: "file-image",

    // Code
    js: "file-js",
    ts: "file-ts",
    jsx: "file-jsx",
    tsx: "file-tsx",
    html: "file-html",
    css: "file-css",
    scss: "file-css",
    json: "file-json",

    // Archives
    zip: "file-zip",
    tar: "file-zip",
    gz: "file-zip",
    rar: "file-zip",

    // Media
    mp3: "file-audio",
    wav: "file-audio",
    mp4: "file-video",
    mov: "file-video",
    webm: "file-video"
};

/**
 * Get icon name by file extension
 */
export const getFileIcon = (filename: string): string => {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    return EXTENSION_ICON_MAP[ext] || "file";
};

/**
 * Get icon for file entry item (unified function)
 * Handles FileEntry objects and string types.
 */
export const iconFor = (item: FileEntry | string, type?: string): string => {
    // Handle string type (legacy support)
    if (typeof item === "string") {
        return item === "directory" ? "folder" : iconByMime(type || item || "");
    }

    // Handle FileEntry object
    if (item?.kind === "directory") return "folder";

    // Try MIME type first, then extension fallback
    return iconByMime(item?.type) || getFileIcon(item?.name || "");
};

// ============================================================================
// SIZE FORMATTING
// ============================================================================

const sizeCache = new Map<number, string>();

/**
 * Format file size with caching
 * Uses cached values for performance in lists.
 */
export const formatSize = (bytes?: number): string => {
    if (bytes === undefined || bytes === null) return "";

    if (sizeCache.has(bytes)) {
        return sizeCache.get(bytes)!;
    }

    let formatted: string;
    if (bytes < 1024) {
        formatted = bytes + " B";
    } else if (bytes < 1024 * 1024) {
        formatted = (bytes / 1024).toFixed(2) + " kB";
    } else if (bytes < 1024 * 1024 * 1024) {
        formatted = (bytes / 1024 / 1024).toFixed(2) + " MB";
    } else {
        formatted = (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
    }

    sizeCache.set(bytes, formatted);
    return formatted;
};

/** @deprecated Use formatSize instead */
export const getSize = formatSize;

// ============================================================================
// DATE FORMATTING
// ============================================================================

const dateCache = new Map<number, string>();

/**
 * Format date with caching
 */
export const formatDate = (timestamp: number | Date | undefined): string => {
    if (timestamp === undefined || timestamp === null) return "";

    const ts = timestamp instanceof Date ? timestamp.getTime() : timestamp;

    if (dateCache.has(ts)) {
        return dateCache.get(ts)!;
    }

    const formatted = new Date(ts).toLocaleString("en-US", {
        dateStyle: "short",
        timeStyle: "short"
    });
    dateCache.set(ts, formatted);
    return formatted;
};

/** @deprecated Use formatDate instead */
export const getFormattedDate = formatDate;

// ============================================================================
// PATH UTILITIES
// ============================================================================

/**
 * Get parent directory path
 */
export const getParentPath = (path: string): string => {
    const parts = path.replace(/\/+$/g, "").split("/").filter(Boolean);
    if (parts.length <= 1) return "/";
    return "/" + parts.slice(0, -1).join("/") + "/";
};

/**
 * Normalize path (ensure trailing slash for directories)
 */
export const normalizePath = (path: string, isDirectory: boolean = false): string => {
    if (isDirectory && !path.endsWith("/")) {
        return path + "/";
    }
    return path;
};

/**
 * Join path segments
 */
export const joinPath = (...segments: string[]): string => {
    return "/" + segments
        .map(s => s.replace(/^\/+|\/+$/g, ""))
        .filter(Boolean)
        .join("/");
};

/**
 * Get file extension
 */
export const getExtension = (filename: string): string => {
    const idx = filename.lastIndexOf(".");
    return idx > 0 ? filename.slice(idx + 1).toLowerCase() : "";
};

// ============================================================================
// SORTING UTILITIES
// ============================================================================

/**
 * Get sort order index by first letter (for alphabetical ordering)
 */
export const getAlphaOrder = (name: string): number => {
    const firstChar = name?.charAt?.(0)?.toUpperCase?.() || "A";
    return firstChar.charCodeAt(0) - 65; // A=0, B=1, etc.
};

/**
 * Get sort order index by first two letters (finer granularity)
 */
export const getAlphaOrderFine = (name: string): number => {
    const first = (name?.charCodeAt?.(0) || 65) - 65;
    const second = (name?.charCodeAt?.(1) || 65) - 65;
    return first * 26 + second;
};
