import { speedDialItems } from "core/store/StateStorage";
import { openUnifiedContextMenu, type ContextMenuEntry } from "./ts/ContextMenu";

//
export type ContextMenuItem = {
    id: string;
    label: string;
    icon?: string;
    action: () => void;
};

/**
 * Empty-area / shell context menu for Explorer.
 * Delegates to unified menu (icons, vertical layout, overlay mount, no backdrop-filter mask bugs).
 */
export const openExplorerContextMenu = (
    x: number,
    y: number,
    items: ContextMenuItem[],
    options?: {
        anchor?: Element | null;
        resolveOverlayMountPoint?: (anchor?: Element | null) => HTMLElement;
    }
): void => {
    const entries: ContextMenuEntry[] = items.map((item) => ({
        id: item.id,
        label: item.label,
        ...(item.icon ? { icon: item.icon } : {}),
        action: () => item.action(),
    }));

    openUnifiedContextMenu({
        x,
        y,
        items: entries,
        compact: true,
        anchor: options?.anchor ?? null,
        resolveOverlayMountPoint: options?.resolveOverlayMountPoint,
    });
};

export const requestOpenView = (request: {
    viewId: string;
    target?: "window" | "frame" | "shell" | "base" | "immersive" | "headless";
    params?: Record<string, string>;
}): void => {
    const viewId = String(request?.viewId || "").trim().toLowerCase();
    if (!viewId) return;
    const raw = request?.target || "window";
    const target = raw === "base" ? "immersive" : raw;
    globalThis?.dispatchEvent?.(new CustomEvent("cw:view-open-request", {
        detail: {
            viewId,
            target,
            params: request?.params || {}
        }
    }));
};

export const TEXT_FILE_EXTENSIONS = new Set([
    "md", "markdown", "txt", "text", "json", "xml", "yml", "yaml",
    "html", "htm", "css", "js", "mjs", "cjs", "ts", "tsx", "jsx",
    "log", "ini", "conf", "cfg", "csv"
]);

export const buildExplorerProcessId = (path?: string): string => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const stamp = Date.now().toString(36);
    const key = String(path || "root").replace(/[^a-z0-9_-]/gi, "-").slice(0, 18) || "root";
    return `explorer-${key}-${stamp}-${suffix}`;
};

export const extOf = (filename = ""): string => {
    const next = String(filename).trim().toLowerCase();
    const idx = next.lastIndexOf(".");
    if (idx <= 0 || idx >= next.length - 1) return "";
    return next.slice(idx + 1);
};

export const isTextLikeFile = (file?: File | null): boolean => {
    if (!file) return false;
    const type = String(file.type || "").toLowerCase();
    if (!type || type.startsWith("text/")) return true;
    if (type.includes("markdown") || type.includes("json") || type.includes("xml")) return true;
    return TEXT_FILE_EXTENSIONS.has(extOf(file.name || ""));
};

export const buildViewerProcessId = (path?: string): string => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const stamp = Date.now().toString(36);
    const key = String(path || "viewer").replace(/[^a-z0-9_-]/gi, "-").slice(0, 18) || "viewer";
    return `viewer-${key}-${stamp}-${suffix}`;
};

export const guessNextShortcutCell = (): [number, number] => {
    const occupied = new Set(
        Array.from(speedDialItems ?? []).map(
            (item) => `${Math.round(item?.cell?.[0] || 0)}:${Math.round(item?.cell?.[1] || 0)}`
        )
    );
    const maxRows = 12;
    const maxCols = 8;
    for (let row = 0; row < maxRows; row += 1) {
        for (let col = 0; col < maxCols; col += 1) {
            const key = `${col}:${row}`;
            if (!occupied.has(key)) return [col, row];
        }
    }
    return [0, 0];
};
