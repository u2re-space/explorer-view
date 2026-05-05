/**
 * Explorer View
 *
 * Shell-agnostic file explorer. Shell mounts `render()` output (light DOM); wires
 * `<ui-file-manager>` (lur.e + veela/icon) via `runtime.ts` on lifecycle mount.
 */

import type { ViewOptions, ViewLifecycle, BaseViewOptions } from "views/types";
import { createViewConstructor, ViewBase } from "views/registry";
import { loadAsAdopted, removeAdopted } from "fest/dom";
import type { FileManager } from "./ts/FileManager";
import type { ExplorerInjectApi } from "./inject";
import type { LocalFileManager } from "./runtime";
import { wireExplorerSubtree } from "./runtime";
import { ExplorerChannelAction } from "views/apis/channel-actions";
import { applyExplorerColorScheme, subscribeExplorerSystemTheme, type ExplorerColorScheme } from "./theme";

/** Re-export + ensure `ui-file-manager` is defined when this module loads. */
export { FileManager, FileManagerContent } from "./ts/FileManager";

export type { ExplorerInjectApi } from "./inject";
export { registerExplorerInject, mergeExplorerInject, getRegisteredExplorerInject } from "./inject";
export { wireExplorerSubtree } from "./runtime";
export type { ExplorerWireOptions, LocalFileManager } from "./runtime";
export type { ExplorerColorScheme } from "./theme";
export {
    applyExplorerColorScheme,
    resolveExplorerColorSchemePreference,
    readAppDataTheme,
    subscribeExplorerSystemTheme
} from "./theme";

// @ts-ignore — Vite inline SCSS
import style from "./index.scss?inline";

export type ExplorerOptions = BaseViewOptions & {
    explorerInject?: ExplorerInjectApi;
    /** Light / dark / system — mirrored from `params.colorScheme` when unset. */
    colorScheme?: ExplorerColorScheme;
};

function coerceColorScheme(
    raw: unknown
): ExplorerColorScheme | undefined {
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
    if (typeof raw === "string") {
        const t = raw.trim().toLowerCase();
        if (t === "light" || t === "dark" || t === "system") return t;
    }
    return undefined;
}

function resolveExplorerOptionsColorScheme(opts?: ExplorerOptions | ViewOptions | null): ExplorerColorScheme | undefined {
    if (!opts) return undefined;
    const ex = opts as ExplorerOptions;
    if (ex.colorScheme) return ex.colorScheme;
    const p = ex.params?.colorScheme ?? ex.params?.theme;
    return coerceColorScheme(p);
}

function normalizeSetColorSchemePayload(payload: unknown): ExplorerColorScheme | undefined {
    if (payload === undefined || payload === null) return undefined;
    if (typeof payload === "string") return coerceColorScheme(payload.trim());
    if (typeof payload === "object") {
        const o = payload as Record<string, unknown>;
        return coerceColorScheme(o.colorScheme ?? o.scheme ?? o.theme);
    }
    return undefined;
}

function buildExplorerShell(): HTMLElement {
    const shell = document.createElement("div");
    shell.className = "view-explorer";
    shell.setAttribute("aria-label", "File explorer");
    const content = document.createElement("div");
    content.className = "view-explorer__content";
    content.setAttribute("data-explorer-content", "");
    const fm = document.createElement("ui-file-manager");
    fm.setAttribute("view-mode", "list");
    content.append(fm);
    shell.append(content);
    return shell;
}

function buildFallbackShell(): HTMLElement {
    const shell = document.createElement("div");
    shell.className = "view-explorer";
    shell.setAttribute("aria-label", "File explorer (fallback)");
    const content = document.createElement("div");
    content.className = "view-explorer__content";
    content.setAttribute("data-explorer-content", "");
    content.innerHTML = `
        <div class="view-explorer__fallback">
            <h3>Explorer fallback mode</h3>
            <p>File manager component is unavailable; use local files below.</p>
            <div class="view-explorer__fallback-actions">
                <button type="button" data-action="pick-files">Open files</button>
                <button type="button" data-action="open-workcenter">Open Work Center</button>
            </div>
            <ul class="view-explorer__fallback-files" data-fallback-files></ul>
        </div>`;
    shell.append(content);
    return shell;
}

//
export const TAG = "cw-view-explorer";

export const CwViewExplorer = createViewConstructor(TAG, (Base: typeof ViewBase) => {
    return class ExplorerView extends Base {
        id = "explorer" as const;
        name = "Explorer";
        icon = "folder";

        private explorerRoot: HTMLElement | null = null;
        private explorerCleanup: (() => void) | null = null;
        private wiredFileManager: LocalFileManager | null = null;
        private initialPath: string | null = null;
        private explorerInject?: ExplorerInjectApi;

        private _sheet: CSSStyleSheet | null = null;
        private themeSync: ReturnType<typeof subscribeExplorerSystemTheme> | null = null;

        lifecycle: ViewLifecycle = {
            onMount: () => {
                this.attachExplorerWire();
            },
            onUnmount: () => {
                this.themeSync?.disconnect();
                this.themeSync = null;
                this.detachExplorerWire();
                removeAdopted(this._sheet);
                this._sheet = null;
            },
            onShow: () => {
                this._sheet ??= loadAsAdopted(style) as CSSStyleSheet;
                this.syncExplorerThemeSubscription();
                if (!this.explorerCleanup && this.explorerRoot) {
                    this.attachExplorerWire();
                }
            },
            onHide: () => {
                this.themeSync?.disconnect();
                this.themeSync = null;
                this.detachExplorerWire();
                try {
                    if (this._sheet) removeAdopted(this._sheet);
                } catch {
                    /* ignore */
                }
                this._sheet = null;
            }
        };

        constructor(options?: ExplorerOptions) {
            super();
            if (options) {
                this.options = options as unknown as ViewOptions;
                this.explorerInject = options.explorerInject;
                if (options.params?.path) {
                    this.initialPath = String(options.params.path);
                }
                const fromParams = coerceColorScheme(options.params?.colorScheme ?? options.params?.theme);
                if (!options.colorScheme && fromParams) {
                    (this.options as ExplorerOptions).colorScheme = fromParams;
                }
            }
        }

        /** Imperative theme — persists on view options for later re-renders. */
        setExplorerColorScheme(mode: ExplorerColorScheme): void {
            (this.options as ExplorerOptions).colorScheme = mode;
            applyExplorerColorScheme(this.explorerRoot, mode);
            this.syncExplorerThemeSubscription();
        }

        /** When using `system`, follow `html[data-theme]` + OS scheme; rebuild subscription on mode change. */
        private syncExplorerThemeSubscription(): void {
            this.themeSync?.disconnect();
            this.themeSync = null;
            if (!this.explorerRoot) return;
            this.themeSync = subscribeExplorerSystemTheme(this.explorerRoot, () => (this.options as ExplorerOptions).colorScheme ?? "system");
        }

        render = (options?: ViewOptions): HTMLElement => {
            if (options) {
                this.options = {
                    ...(this.options as object),
                    ...(options as object)
                } as ViewOptions;
                const p = (options as BaseViewOptions)?.params?.path;
                if (p) {
                    this.initialPath = String(p);
                }
                const inj = (options as ExplorerOptions)?.explorerInject;
                if (inj !== undefined) {
                    this.explorerInject = inj;
                }
            }

            if (this.explorerCleanup) {
                this.themeSync?.disconnect();
                this.themeSync = null;
                this.detachExplorerWire();
            }

            const hasFileManager = Boolean(customElements.get("ui-file-manager"));
            this.explorerRoot = hasFileManager ? buildExplorerShell() : buildFallbackShell();

            const scheme =
                resolveExplorerOptionsColorScheme(options as ExplorerOptions | null) ??
                resolveExplorerOptionsColorScheme(this.options as ExplorerOptions | null);
            applyExplorerColorScheme(this.explorerRoot, scheme ?? "system");
            this.syncExplorerThemeSubscription();

            return this.explorerRoot;
        };

        getToolbar(): HTMLElement | null {
            return null;
        }

        canHandleMessage(messageType: string): boolean {
            return [
                "file-save",
                "navigate-path",
                "content-explorer",
                ExplorerChannelAction.SetColorScheme
            ].includes(messageType);
        }

        async handleMessage(message: unknown): Promise<void> {
            const msg = message as {
                type?: string;
                data?: { path?: string; into?: string; file?: File; colorScheme?: unknown; scheme?: unknown; theme?: unknown };
            };
            if (msg.type === ExplorerChannelAction.SetColorScheme) {
                const next =
                    normalizeSetColorSchemePayload(msg.data?.colorScheme ?? msg.data?.scheme ?? msg.data?.theme) ??
                    "system";
                this.setExplorerColorScheme(next);
                return;
            }
            if (msg.data?.file instanceof File) {
                await this.saveIncomingFileToWorkspace(msg.data.file, msg.data.path || msg.data.into);
                return;
            }
            const targetPath = msg.data?.path || msg.data?.into;
            if (targetPath && this.wiredFileManager) {
                void this.wiredFileManager.navigate(targetPath);
            }
        }

        private async saveIncomingFileToWorkspace(file: File, destPath?: string): Promise<boolean> {
            const fm = this.wiredFileManager as unknown as FileManager | null;
            const op = fm?.operative as { ingestFileIntoWorkspace?: (f: File, p?: string) => Promise<void> } | undefined;
            if (!op?.ingestFileIntoWorkspace) return false;
            await op.ingestFileIntoWorkspace(file, destPath);
            return true;
        }

        /** Imperative API — channels / tooling (`ui-file-manager` when wired). */
        navigateExplorer(path: string): void | Promise<void> {
            const p = String(path || "").trim();
            if (!p || !this.wiredFileManager) return;
            return this.wiredFileManager.navigate(p);
        }

        getExplorerFileManager(): LocalFileManager | null {
            return this.wiredFileManager;
        }

        getExplorerShellRoot(): HTMLElement | null {
            return this.explorerRoot;
        }

        invokeChannelApi(action: string, payload?: unknown): unknown | Promise<unknown> {
            const pathFromPayload = (): string => {
                if (typeof payload === "string") return payload.trim();
                if (payload && typeof payload === "object") {
                    const o = payload as Record<string, unknown>;
                    const raw = o.path ?? o.into ?? o.target;
                    return typeof raw === "string" ? raw.trim() : "";
                }
                return "";
            };

            switch (action) {
                case ExplorerChannelAction.NavigatePath:
                case ExplorerChannelAction.ContentExplorer:
                case ExplorerChannelAction.Navigate: {
                    const path = pathFromPayload();
                    if (!path) return false;
                    void this.navigateExplorer(path);
                    return true;
                }
                case ExplorerChannelAction.GetPath:
                    return this.wiredFileManager?.path ?? null;
                case ExplorerChannelAction.FileSave:
                case "file-save": {
                    const o = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
                    const file = o.file instanceof File ? o.file : null;
                    const dest = typeof o.path === "string" ? o.path : typeof o.into === "string" ? o.into : undefined;
                    if (!file) return false;
                    return this.saveIncomingFileToWorkspace(file, dest);
                }
                case ExplorerChannelAction.RequestUse: {
                    const fm = this.wiredFileManager as unknown as FileManager | null;
                    fm?.requestUse?.();
                    return true;
                }
                case ExplorerChannelAction.RequestUpload: {
                    const fm = this.wiredFileManager as unknown as FileManager | null;
                    fm?.requestUpload?.();
                    return true;
                }
                case ExplorerChannelAction.RequestPaste: {
                    const fm = this.wiredFileManager as unknown as FileManager | null;
                    fm?.requestPaste?.();
                    return true;
                }
                case ExplorerChannelAction.SetColorScheme: {
                    const next = normalizeSetColorSchemePayload(payload) ?? "system";
                    this.setExplorerColorScheme(next);
                    return true;
                }
                case "get-color-scheme": {
                    const o = this.options as ExplorerOptions;
                    return o.colorScheme ?? resolveExplorerOptionsColorScheme(o) ?? "system";
                }
                default:
                    return this.handleMessage({
                        type: action,
                        data:
                            typeof payload === "object" && payload
                                ? (payload as Record<string, unknown>)
                                : { path: pathFromPayload() || undefined }
                    }).then(() => true);
            }
        }

        private attachExplorerWire(): void {
            if (!this.explorerRoot) return;
            const shellOpts = this.options as unknown as BaseViewOptions;
            const { cleanup, fileManager } = wireExplorerSubtree(this.explorerRoot, {
                shellContext: shellOpts?.shellContext,
                initialPath: this.initialPath,
                inject: this.explorerInject
            });
            this.explorerCleanup = cleanup;
            this.wiredFileManager = fileManager;
        }

        private detachExplorerWire(): void {
            this.explorerCleanup?.();
            this.explorerCleanup = null;
            this.wiredFileManager = null;
        }
    };
}) as CustomElementConstructor;

// Registry default factory (non-CE — avoids double-wrap when registry detects HTMLElement subclasses).
export function createExplorerView(options?: ExplorerOptions) {
    const Ctor = CwViewExplorer as unknown as {
        new (opts?: ExplorerOptions): HTMLElement;
    };
    return new Ctor(options);
}

export default createExplorerView;
