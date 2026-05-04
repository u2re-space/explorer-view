/**
 * Explorer View
 *
 * Shell-agnostic file explorer. Shell mounts `render()` output (light DOM); wires FL-UI
 * `<ui-file-manager>` via `runtime.ts` on lifecycle mount (matches AirPad/Simplified CE pattern).
 */

import type { ViewOptions as ShellViewOptions, ViewLifecycle } from "shells/types";
import type { BaseViewOptions } from "views/types";
import type { ViewOptions as RegistryViewOptions } from "views/types";
import { createViewConstructor, ViewBase } from "views/registry";
import { loadAsAdopted, removeAdopted } from "fest/dom";
import type { FileManager } from "./ts/FileManager";
import type { ExplorerInjectApi } from "./inject";
import type { LocalFileManager } from "./runtime";
import { wireExplorerSubtree } from "./runtime";
import { ExplorerChannelAction } from "views/apis/channel-actions";

/** Re-export + ensure `ui-file-manager` is defined when this module loads. */
export { FileManager, FileManagerContent } from "./ts/FileManager";

export type { ExplorerInjectApi } from "./inject";
export { registerExplorerInject, mergeExplorerInject } from "./inject";
export { wireExplorerSubtree } from "./runtime";

// @ts-ignore — Vite inline SCSS
import style from "./index.scss?inline";

export type ExplorerOptions = BaseViewOptions & { explorerInject?: ExplorerInjectApi };

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

        lifecycle: ViewLifecycle = {
            onMount: () => {
                this._sheet ??= loadAsAdopted(style) as CSSStyleSheet;
                this.attachExplorerWire();
            },
            onUnmount: () => {
                this.detachExplorerWire();
                removeAdopted(this._sheet);
                this._sheet = null;
            },
            onShow: () => {
                this._sheet ??= loadAsAdopted(style) as CSSStyleSheet;
                if (!this.explorerCleanup && this.explorerRoot) {
                    this.attachExplorerWire();
                }
            },
            onHide: () => {
                this.detachExplorerWire();
                removeAdopted(this._sheet);
                this._sheet = null;
            }
        };

        constructor(options?: ExplorerOptions) {
            super();
            if (options) {
                this.options = options as unknown as RegistryViewOptions;
                this.explorerInject = options.explorerInject;
                if (options.params?.path) {
                    this.initialPath = String(options.params.path);
                }
            }
        }

        render = (options?: ShellViewOptions): HTMLElement => {
            if (options) {
                this.options = {
                    ...(this.options as object),
                    ...(options as object)
                } as RegistryViewOptions;
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
                this.detachExplorerWire();
            }

            this._sheet = loadAsAdopted(style) as CSSStyleSheet;

            const hasFileManager = Boolean(customElements.get("ui-file-manager"));
            this.explorerRoot = hasFileManager ? buildExplorerShell() : buildFallbackShell();

            return this.explorerRoot;
        };

        getToolbar(): HTMLElement | null {
            return null;
        }

        canHandleMessage(messageType: string): boolean {
            return ["file-save", "navigate-path", "content-explorer"].includes(messageType);
        }

        async handleMessage(message: unknown): Promise<void> {
            const msg = message as { type?: string; data?: { path?: string; into?: string; file?: File } };
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

        /** Imperative API — channels / tooling (FL-UI `ui-file-manager` when wired). */
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
