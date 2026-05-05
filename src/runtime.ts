/**
 * Wires `<ui-file-manager>` inside the explorer light-DOM shell: viewer/workcenter IPC,
 * speed-dial pin, path persistence, shell messages. Behavior ported from `CWExplorer.ts` with
 * explicit imports and an inject/merge API.
 */

import type { ShellContext } from "shells/types";
import { observe } from "fest/object";
import { StorageKeys, getString, setString } from "core/storage";
import {
    addSpeedDialItem,
    createEmptySpeedDialItem,
    ensureSpeedDialMeta,
    persistSpeedDialItems,
    persistSpeedDialMeta
} from "core/store/StateStorage";
import type { ExplorerFileItem, ExplorerInjectApi } from "./inject";
import { getRegisteredExplorerInject, mergeExplorerInject } from "./inject";
import {
    buildExplorerProcessId,
    buildViewerProcessId,
    isTextLikeFile,
    openExplorerContextMenu,
    requestOpenView,
    guessNextShortcutCell
} from "./utils";
import { sendViewProtocolMessage } from "com/core/UniformViewTransport";

export type LocalFileManager = HTMLElement & {
    path: string;
    navigate: (path: string) => void | Promise<void>;
};

export type ExplorerWireOptions = {
    shellContext?: ShellContext;
    /** Route/query `params.path` or explicit override. */
    initialPath?: string | null;
    inject?: ExplorerInjectApi;
};

type WorkCenterAttachMode = "active" | "queued" | "headless";

function loadLastPath(explorer: LocalFileManager, initialPath: string | null | undefined): void {
    if (initialPath && initialPath.trim()) {
        explorer.path = initialPath.trim();
        return;
    }
    const persisted = String(getString(StorageKeys.EXPLORER_PATH, "/user/") || "").trim();
    const nextPath = !persisted || persisted === "/" ? "/user/" : persisted;
    explorer.path = nextPath;
}

function setupExplorerEvents(
    explorer: LocalFileManager,
    opts: ExplorerWireOptions,
    inject: ExplorerInjectApi | undefined,
    signal: AbortSignal
): void {
    const listenerOpts = { signal } as AddEventListenerOptions;
    const showMessage = (message: string) => opts.shellContext?.showMessage?.(message);

    const openFileInViewer = async (
        item: ExplorerFileItem | undefined,
        fullPath: string | undefined,
        target: "window" | "base" = "window"
    ): Promise<boolean> => {
        const file = item?.file as File | undefined;
        if (!file || !isTextLikeFile(file)) return false;
        const sourcePath = String(fullPath || "");
        if (target === "base") {
            requestOpenView({
                viewId: "viewer",
                target: "base",
                params: {
                    src: sourcePath,
                    filename: file.name || "",
                    processId: buildViewerProcessId(sourcePath)
                }
            });
            return true;
        }

        const processId = buildViewerProcessId(sourcePath);
        requestOpenView({
            viewId: "viewer",
            target: "window",
            params: {
                processId,
                src: sourcePath,
                filename: file.name || ""
            }
        });

        try {
            const sent = await sendViewProtocolMessage({
                type: "content-view",
                source: "explorer",
                destination: "viewer",
                contentType: file.type || "text/plain",
                attachments: [{ data: file, source: "explorer-viewer-open" }],
                data: {
                    filename: file.name,
                    path: sourcePath,
                    source: sourcePath
                },
                metadata: {
                    processId,
                    openTarget: "window"
                }
            });
            if (!sent) {
                showMessage("Viewer is not ready yet, retrying in background");
            }
        } catch (error) {
            console.warn("[Explorer] Failed to send viewer payload:", error);
        }
        return true;
    };

    const attachToWorkCenter = async (item: ExplorerFileItem | undefined, mode: WorkCenterAttachMode) => {
        const file = item?.file as File | undefined;
        if (!file) {
            showMessage("No file selected");
            return;
        }
        const sourcePath = `${explorer?.path || "/"}${item?.name || file.name}`;
        if (mode === "headless") {
            requestOpenView({
                viewId: "workcenter",
                target: "headless",
                params: {
                    queue: "1",
                    mode: "headless",
                    sourcePath
                }
            });
        } else if (mode === "active") {
            requestOpenView({ viewId: "workcenter", target: "window" });
        } else {
            requestOpenView({
                viewId: "workcenter",
                target: "window",
                params: { minimized: "1", queue: "1", sourcePath }
            });
        }

        const sent = await sendViewProtocolMessage({
            type: "content-share",
            source: "explorer",
            destination: "workcenter",
            contentType: file.type || "application/octet-stream",
            attachments: [{ data: file, source: "explorer-workcenter-attach" }],
            data: {
                filename: file.name,
                path: sourcePath,
                source: "explorer-attach",
                queued: mode !== "active"
            },
            metadata: {
                queueState: mode === "active" ? "awaiting" : mode === "queued" ? "pending" : "queued",
                mode,
                sourcePath
            }
        });
        if (sent) {
            showMessage(
                mode === "active"
                    ? `Attached ${file.name} to Work Center`
                    : `Queued ${file.name} for Work Center (${mode})`
            );
        } else {
            showMessage("Work Center queue is unavailable");
        }
    };

    const pinToHome = (item: ExplorerFileItem | undefined) => {
        const file = item?.file as File | undefined;
        const name = String(item?.name || file?.name || "").trim();
        if (!name) {
            showMessage("Nothing to pin");
            return;
        }
        const path = `${explorer?.path || "/"}${name}`;
        const cell = observe(guessNextShortcutCell());
        const shortcut = createEmptySpeedDialItem(cell);
        shortcut.label.value = name;
        shortcut.icon.value = item?.kind === "directory" ? "folder" : "file-text";
        shortcut.action = "open-link";
        addSpeedDialItem(shortcut);
        const meta = ensureSpeedDialMeta(shortcut.id, { action: "open-link" });
        meta.action = "open-link";
        meta.href = path;
        meta.description = `Pinned from Explorer: ${path}`;
        persistSpeedDialItems();
        persistSpeedDialMeta();
        showMessage(`Pinned ${name} to Home`);
    };

    const getItemPath = (item?: ExplorerFileItem): string => `${explorer?.path || "/"}${item?.name || ""}`;

    const builtInHandlers: Record<string, (item?: ExplorerFileItem) => Promise<void> | void> = {
        view: async (item) => {
            await openFileInViewer(item, getItemPath(item), "window");
        },
        "view-base": async (item) => {
            await openFileInViewer(item, getItemPath(item), "base");
        },
        "attach-workcenter": (item) => attachToWorkCenter(item, "active"),
        "attach-workcenter-queued": (item) => attachToWorkCenter(item, "queued"),
        "attach-workcenter-headless": (item) => attachToWorkCenter(item, "headless"),
        "pin-home": (item) => pinToHome(item)
    };

    const mergedHandlers = {
        ...builtInHandlers,
        ...(inject?.contextActionHandlers ?? {})
    };

    const onFileOpen = async (e: Event) => {
        const detail = (e as CustomEvent<{ item?: ExplorerFileItem; path?: string }>).detail || {};
        const { item, path } = detail;
        if (item?.kind !== "file" || !item?.file) return;
        const opened = await openFileInViewer(item, path, "window");
        if (!opened) {
            requestOpenView({ viewId: "workcenter", target: "window" });
        }
    };
    explorer.addEventListener("open-item", onFileOpen, listenerOpts);
    explorer.addEventListener("open", onFileOpen, listenerOpts);
    explorer.addEventListener("rs-open", onFileOpen, listenerOpts);

    const savePath = () => {
        setString(StorageKeys.EXPLORER_PATH, explorer.path || "/user/");
    };
    explorer.addEventListener("entries-updated", savePath, listenerOpts);
    explorer.addEventListener("rs-navigate", savePath, listenerOpts);

    explorer.addEventListener(
        "context-action",
        async (event: Event) => {
            const detail = (event as CustomEvent<{ action?: string; item?: ExplorerFileItem }>).detail || {};
            const action = String(detail.action || "");
            const item = detail.item;
            if (!action) return;
            const handler = mergedHandlers[action];
            if (!handler) return;
            await handler(item);
        },
        listenerOpts
    );

    explorer.addEventListener(
        "contextmenu",
        (event: MouseEvent) => {
            const pathItems = event.composedPath?.() || [];
            const inFileItem = pathItems.some((node) => {
                const el = node as HTMLElement | null;
                if (!el || typeof el.classList?.contains !== "function") return false;
                return (
                    el.classList.contains("row") ||
                    el.classList.contains("action-btn") ||
                    el.classList.contains("ctx-menu")
                );
            });
            if (inFileItem) {
                return;
            }
            event.preventDefault();
            const path = explorer?.path || "/";
            const extra = inject?.extraBackgroundMenuItems?.({ path }) ?? [];
            openExplorerContextMenu(event.clientX, event.clientY, [
                {
                    id: "refresh",
                    label: "Refresh",
                    icon: "arrows-clockwise",
                    action: () => {
                        void explorer.navigate(path);
                    }
                },
                {
                    id: "open-new-explorer",
                    label: "New Explorer window",
                    icon: "books",
                    action: () =>
                        requestOpenView({
                            viewId: "explorer",
                            target: "window",
                            params: {
                                path,
                                processId: buildExplorerProcessId(path)
                            }
                        })
                },
                {
                    id: "open-home",
                    label: "Go to Home",
                    icon: "house",
                    action: () => opts.shellContext?.navigate?.("home")
                },
                ...extra
            ]);
        },
        listenerOpts
    );
}

function setupFallbackExplorerEvents(shellRoot: HTMLElement, opts: ExplorerWireOptions, signal: AbortSignal): void {
    const listenerOpts = { signal } as AddEventListenerOptions;
    const showMessage = (msg: string) => opts.shellContext?.showMessage?.(msg);
    const filesList = shellRoot.querySelector("[data-fallback-files]") as HTMLUListElement | null;
    const pickBtn = shellRoot.querySelector('[data-action="pick-files"]') as HTMLButtonElement | null;
    const workBtn = shellRoot.querySelector('[data-action="open-workcenter"]') as HTMLButtonElement | null;
    if (!pickBtn || !filesList) return;

    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".md,.markdown,.txt,.json,.xml,.yaml,.yml,.csv,.log,text/*";
    input.style.display = "none";
    shellRoot.append(input);

    pickBtn.addEventListener("click", () => input.click(), listenerOpts);
    workBtn?.addEventListener("click", () => requestOpenView({ viewId: "workcenter", target: "window" }), listenerOpts);

    input.addEventListener(
        "change",
        async () => {
            const files = Array.from(input.files || []);
            filesList.replaceChildren();
            if (files.length === 0) return;

            for (const file of files) {
                const li = document.createElement("li");
                li.textContent = file.name;
                filesList.append(li);
            }

            const firstTextLike = files.find((file) => isTextLikeFile(file));
            if (firstTextLike) {
                requestOpenView({ viewId: "viewer", target: "window" });
                const sent = await sendViewProtocolMessage({
                    type: "content-view",
                    source: "explorer-fallback",
                    destination: "viewer",
                    contentType: firstTextLike.type || "text/plain",
                    attachments: [{ data: firstTextLike, source: "explorer-fallback" }],
                    data: {
                        filename: firstTextLike.name,
                        source: "explorer-fallback"
                    }
                });
                if (!sent) {
                    showMessage("Viewer is not ready yet");
                }
            }
        },
        listenerOpts
    );
}

/**
 * Attach explorer behaviors to `shellRoot` (`.view-explorer`). Returns cleanup and the file manager host if present.
 */
export function wireExplorerSubtree(
    shellRoot: HTMLElement,
    wireOpts: ExplorerWireOptions
): { cleanup: () => void; fileManager: LocalFileManager | null } {
    const injectMerged = mergeExplorerInject(getRegisteredExplorerInject(), wireOpts.inject);
    const ac = new AbortController();
    const { signal } = ac;

    const fm = shellRoot.querySelector("ui-file-manager") as LocalFileManager | null;
    injectMerged?.onWire?.(fm, shellRoot);

    if (fm) {
        loadLastPath(fm, wireOpts.initialPath ?? null);
        setupExplorerEvents(fm, wireOpts, injectMerged, signal);
        return {
            cleanup: () => {
                setString(StorageKeys.EXPLORER_PATH, fm.path || "/user/");
                ac.abort();
            },
            fileManager: fm
        };
    }

    setupFallbackExplorerEvents(shellRoot, wireOpts, signal);
    return {
        cleanup: () => ac.abort(),
        fileManager: null
    };
}
