import { H, defineElement, property, getDir, valueLink } from "fest/lure";
import { addEvent, preloadStyle } from "fest/dom";
import { affected, propRef } from "fest/object";

//
import { UIElement } from "../base/UIElement";

//
import FileManagerContent from "./FileManagerContent";

// @ts-ignore
import fmCss from "./FileManager.scss?inline";

//
const styled = preloadStyle(fmCss);

export type ContextMenuItem = {
    id: string;
    label: string;
    icon?: string;
    action: () => void;
};

// @ts-ignore
@defineElement("ui-file-manager")
export class FileManager extends UIElement {
    @property({ source: "query-shadow", name: ".fm-grid-rows" }) gridRowsEl?: HTMLElement;
    @property({ source: "query-shadow", name: ".fm-grid" }) gridEl?: HTMLElement;

    // explicit sidebar control; if not provided, auto by container size
    @property({ source: "attr", name: "sidebar" }) sidebar?: any = "auto";

    // container inline size for CQ-based decisions
    @property({ source: "inline-size" }) inlineSize?: number;

    // refs/state
    styles = () => styled;
    #pathWatcherDisposer: (() => void) | null = null;
    constructor() { super(); }

    //
    get content() { return (this as any)?.querySelector?.("ui-file-manager-content") as any; }
    get operative() { return this.content?.operativeInstance; }
    get pathRef() { return this.operative?.pathRef; }
    get path() { return this.content?.path || this.operative?.path || "/"; }
    set path(value: string) {
        if (this.content) this.content.path = value || "/";
        if (this.operative) this.operative.path = value || "/";
    }

    //
    get input() { return this?.shadowRoot?.querySelector?.("input[name=\"address\"]") as HTMLInputElement | null; }
    get inputValue() { return this.input?.value || "/"; }
    set inputValue(value: string) {
        if (this.input) this.input.value = value || "/";
    }

    //
    onInitialize(): this {
        const result = super.onInitialize();
        const self: any = result ?? this;

        //
        const existingContents = Array.from(self.querySelectorAll("ui-file-manager-content"));
        const primaryContent = existingContents[0] ?? document.createElement("ui-file-manager-content");
        if (!existingContents.length) {
            self.append(primaryContent);
        }
        if (existingContents.length > 1) {
            for (const extra of existingContents.slice(1)) {
                (extra as HTMLElement)?.remove?.();
            }
        }

        //
        queueMicrotask(() => {
            this.#pathWatcherDisposer?.();
            this.#pathWatcherDisposer = null;
            if (!this.pathRef) return;
            this.#pathWatcherDisposer = affected(this.pathRef, (path) => {
                const input = this?.shadowRoot?.querySelector?.("input[name=\"address\"]");
                if (input && input instanceof HTMLInputElement && input.value != path) {
                    input.value = path || "/";
                }
            });
        });

        //
        return self as this;
    }

    //
    onRender(): this|void|undefined {
        super.onRender();

        // handle address field submit
        const weak: any = new WeakRef(this);
        const onEnter = (ev: KeyboardEvent) => {
            if (ev.key === "Enter") {
                const self = weak.deref() as any;
                const input = self?.querySelector?.("input[name=\"address\"]");
                const val = (input as HTMLInputElement)?.value?.trim?.() || "";
                if (val) self?.navigate(val);
            }
        };
        addEvent(this, "keydown", onEnter);
    }

    //
    get showSidebar(): boolean {
        const force = String(this.sidebar ?? "auto").toLowerCase();
        if (force === "true" || force === "1") return true;
        if (force === "false" || force === "0") return false;
        const width = propRef(this as any, "inlineSize")?.value ?? this.inlineSize ?? 0;
        return width >= 720; // container-query based threshold
    }

    //
    async navigate(toPath: string) {
        const clean = getDir(toPath);
        this.path = clean || this.path || "/";
        const input = this?.shadowRoot?.querySelector?.("input[name=\"address\"]");
        if (input && input instanceof HTMLInputElement && input.value != this.path) { input.value = this.path || "/"; };
    }

    //
    async goUp() {
        const currentPath = this.path || this.content?.path || "/";
        const parts = currentPath
            .replace(/\/+$/g, "")
            .split("/")
            .filter(Boolean);
        if (parts.length <= 1) {
            this.navigate(this.path = "/");
            return;
        }
        const up = "/" + parts.slice(0, -1).join("/") + "/";
        const clean = getDir(up);
        this.navigate(this.path = clean || "/");
    }

    //
    requestUpload() { this.operative?.requestUpload?.(); }
    requestPaste() { this.operative?.requestPaste?.(); }
    requestUse() { this.operative?.requestUse?.(); }

    //
    render = function() {
        const self: any = this;
        const sidebarVisible = self.showSidebar;

        //
        const content = H`<div part="content" class="fm-content"><slot></slot></div>`
        const toolbar = H`<div part="toolbar" class="fm-toolbar">
            <div class="fm-toolbar-left">
                <button class="btn" title="Up" on:click=${() => requestAnimationFrame(() => self.goUp())}><ui-icon icon="arrow-up"/></button>
                <button class="btn" title="Refresh" on:click=${() => requestAnimationFrame(() => self.navigate(self.inputValue || self.path || "/"))}><ui-icon icon="arrow-clockwise"/></button>
            </div>
            <div class="fm-toolbar-center"><form style="display: contents;" onsubmit="return false;">
                <input class="address c2-surface" autocomplete="off" type="text" name="address" value=${self.path || "/"} />
            </form></div>
            <div class="fm-toolbar-right">
                <button class="btn" title="Add" on:click=${() => requestAnimationFrame(() => self.requestUpload?.())}><ui-icon icon="upload"/></button>
                <button class="btn" title="Paste" on:click=${() => requestAnimationFrame(() => self.requestPaste?.())}><ui-icon icon="clipboard"/></button>
                <button class="btn" title="Use" on:click=${() => requestAnimationFrame(() => self.requestUse?.())}><ui-icon icon="hand-withdraw"/></button>
            </div>
        </div>`

        //
        return H`<div part="root" class="fm-root" data-with-sidebar=${sidebarVisible}>${toolbar}${content}</div>`;
    }
}

//
export default FileManager;
export { FileManagerContent };
