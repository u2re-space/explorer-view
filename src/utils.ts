import { speedDialItems } from "core/store/StateStorage";

//
export type ContextMenuItem = {
    id: string;
    label: string;
    icon?: string;
    action: () => void;
};

export const openExplorerContextMenu = (x: number, y: number, items: ContextMenuItem[]): void => {
    const menu = document.createElement("div");
    menu.className = "rs-explorer-context-menu";
    menu.setAttribute("role", "menu");

    const closeMenu = () => {
        document.removeEventListener("click", onDocClick, true);
        document.removeEventListener("keydown", onKey, true);
        menu.remove();
    };

    const onDocClick = (ev: MouseEvent) => {
        if (!menu.contains(ev.target as Node)) closeMenu();
    };

    const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") {
            ev.preventDefault();
            closeMenu();
        }
    };

    for (const item of items) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "rs-explorer-context-menu__item";
        button.textContent = item.label;
        button.addEventListener("click", () => {
            item.action();
            closeMenu();
        });
        menu.append(button);
    }

    document.body.append(menu);

    // Inline fallback: adopted/global CSS may not apply here; `left`/`top` only work with fixed positioning.
    menu.style.setProperty("position", "fixed");
    menu.style.setProperty("margin", "0");
    menu.style.setProperty("box-sizing", "border-box");
    menu.style.setProperty("z-index", "10050");

    const pad = 8;
    const vw = globalThis.innerWidth;
    const vh = globalThis.innerHeight;
    let left = x;
    let top = y;
    const rect = menu.getBoundingClientRect();
    if (left + rect.width > vw - pad) left = Math.max(pad, vw - rect.width - pad);
    if (top + rect.height > vh - pad) top = Math.max(pad, vh - rect.height - pad);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    requestAnimationFrame(() => {
        const r2 = menu.getBoundingClientRect();
        let l2 = left;
        let t2 = top;
        if (l2 + r2.width > vw - pad) l2 = Math.max(pad, vw - r2.width - pad);
        if (t2 + r2.height > vh - pad) t2 = Math.max(pad, vh - r2.height - pad);
        menu.style.left = `${l2}px`;
        menu.style.top = `${t2}px`;
    });

    queueMicrotask(() => {
        document.addEventListener("click", onDocClick, true);
    });
    document.addEventListener("keydown", onKey, true);
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
