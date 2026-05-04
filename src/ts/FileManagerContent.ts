import { property, defineElement, H, bindWith, initGlobalClipboard } from "fest/lure";
import { addEvent, handleStyleChange, isInFocus, preloadStyle } from "fest/dom";
import { ref } from "fest/object";

//
import { UIElement } from "fl-ui/base/UIElement";

// @ts-ignore
import fmCss from "./FileManagerContent.scss?inline";
import { type FileEntryItem, FileOperative } from "./Operative";

//
import { createItemCtxMenu } from "./ContextMenu";

//
import { iconFor, formatDate } from "./utils";

//
initGlobalClipboard();

//
const styled = preloadStyle(fmCss);

// @ts-ignore
@defineElement("ui-file-manager-content")
export class FileManagerContent extends UIElement {
    @property({ source: "query-shadow", name: ".fm-grid-rows" }) gridRowsEl?: HTMLElement;
    @property({ source: "query-shadow", name: ".fm-grid" }) gridEl?: HTMLElement;

    //
    public operativeInstance: FileOperative | null = null;
    public operativeInstanceRef = ref<FileOperative | null>(null);
    #rowsContainer: HTMLElement | null = null;

    //
    get entries() { return this.operativeInstance?.entries ?? []; }
    get path() { return this.operativeInstance?.path || "/"; }
    set path(value: string) { if (this.operativeInstance) this.operativeInstance.path = value || "/"; }
    get pathRef() { return this.operativeInstance?.pathRef; }

    //
    refreshList() {
        if (this.gridRowsEl) this.gridRowsEl.innerHTML = ``;
        if (this.gridEl) this.gridEl.innerHTML = ``;
        if (this.operativeInstance) {
            void this.operativeInstance.refreshList(this.path || "/").then(() => this.syncRows()).catch(console.warn);
        }
    }

    //
    onInitialize(): this {
        const result = super.onInitialize();
        return (result ?? this) as this;
    }

    //
    protected bindDropHandlers() {
        const container = this;
        if (!container) return;
        addEvent(container, "dragover", (ev: DragEvent) => {
            if (isInFocus(ev?.target as HTMLElement, "ui-file-manager-content, ui-file-manager")) {
                ev?.preventDefault?.();
                if (ev.dataTransfer) {
                    ev.dataTransfer.dropEffect = "copy";
                }
            }
        });
        addEvent(container, "drop", (ev: DragEvent) => {
            if (isInFocus(ev?.target as HTMLElement, "ui-file-manager-content, ui-file-manager")) {
                ev?.preventDefault?.();
                ev?.stopPropagation?.();
                this.operativeInstance?.onDrop?.(ev)
            }
        });
    }

    //
    public onPaste(ev: ClipboardEvent) {
        if (isInFocus(ev?.target as HTMLElement, "ui-file-manager-content, ui-file-manager")) {
            if (this.operativeInstance) this.operativeInstance.onPaste(ev);
        }
    }

    //
    public onCopy(ev: ClipboardEvent) {
        if (isInFocus(ev?.target as HTMLElement, "ui-file-manager-content, ui-file-manager")) {
            if (this.operativeInstance) this.operativeInstance.onCopy(ev);
        }
    }

    //
    byFirstTwoLetterOrName(name: string): number {
        const firstTwoLetters = name?.substring?.(0, 2)?.toUpperCase?.();
        const index = (firstTwoLetters?.charCodeAt?.(0) || 65) - 65;
        return index;
    }

    //
    constructor() {
        super();
        this.operativeInstance ??= new FileOperative();
        this.operativeInstance.host = this as any;
        this.addEventListener("entries-updated", () => this.syncRows());
        this.refreshList();
    }

    private syncRows() {
        let rows = this.#rowsContainer;
        if (!rows || !rows.isConnected) {
            rows = (this.shadowRoot?.querySelector?.(".fm-grid:last-of-type .fm-grid-rows") as HTMLElement | null) ?? null;
            this.#rowsContainer = rows;
        }
        const operative = this.operativeInstance;
        if (!rows || !operative) return;
        const rawEntries: any = operative.entries as any;
        const currentEntries =
            Array.isArray(rawEntries) ? rawEntries :
            (Array.isArray(rawEntries?.value) ? rawEntries.value : []);
        const safeEntries = Array.isArray(currentEntries) ? currentEntries : [];
        const seen = new Set<string>();
        rows.innerHTML = "";
        const fragment = document.createDocumentFragment();
        for (const item of safeEntries) {
            if (!item || typeof item !== "object" || item.name == null) continue;
            const dedupeKey = `${item.kind}:${item.name}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            fragment.append(this.makeListElement(item as FileEntryItem, operative));
        }
        rows.append(fragment);
    }

    private makeListElement(item: FileEntryItem, operative: FileOperative) {
        const op: any = operative as any;
        const isFile = item?.kind === "file" || item?.file;
        const itemEl = H`<div draggable="${isFile}" class="row c2-surface"
            on:click=${(ev: MouseEvent) => requestAnimationFrame(() => op.onRowClick?.(item, ev))}
            on:dblclick=${(ev: MouseEvent) => requestAnimationFrame(() => op.onRowDblClick?.(item, ev))}
            on:dragstart=${(ev: DragEvent) => op.onRowDragStart?.(item, ev)}
            data-id=${item?.name || ""}
        >
            <div style="pointer-events: none; background-color: transparent;" class="c icon"><ui-icon icon=${iconFor(item)} /></div>
            <div style="pointer-events: none; background-color: transparent;" class="c name" title=${item?.name || ""}>${item?.name || ""}</div>
            <div style="pointer-events: none; background-color: transparent;" class="c size">${isFile ? (item?.size ?? "") : ""}</div>
            <div style="pointer-events: none; background-color: transparent;" class="c date">${isFile ? formatDate(item?.lastModified ?? 0) : ""}</div>
            <div style="pointer-events: none; background-color: transparent;" class="c actions">
                <button class="action-btn" title="Copy Path" on:click=${(ev: MouseEvent) => { ev.stopPropagation(); requestAnimationFrame(() => op.onMenuAction?.(item, "copyPath", ev)); }}>
                    <ui-icon icon="copy" />
                </button>
                <button class="action-btn" title="Copy" on:click=${(ev: MouseEvent) => { ev.stopPropagation(); requestAnimationFrame(() => op.onMenuAction?.(item, "copy", ev)); }}>
                    <ui-icon icon="clipboard" />
                </button>
                <button class="action-btn" title="Delete" on:click=${(ev: MouseEvent) => { ev.stopPropagation(); requestAnimationFrame(() => op.onMenuAction?.(item, "delete", ev)); }}>
                    <ui-icon icon="trash" />
                </button>
            </div>
        </div>`;
        bindWith(itemEl, "--order", this.byFirstTwoLetterOrName(item?.name ?? ""), handleStyleChange);
        return itemEl;
    }

    //
    styles = () => styled;
    render = function () {
        const self: any = this;
        const fileHeader = H`<div class="fm-grid-header">
            <div class="c icon">@</div>
            <div class="c name">Name</div>
            <div class="c size">Size</div>
            <div class="c date">Modified</div>
            <div class="c actions">Actions</div>
        </div>`

        //
        const operative = self.operativeInstance;
        if (!operative) return "";

        //
        const fileRows = H`<div class="fm-grid-rows" style="will-change: contents;"></div>`;
        this.#rowsContainer = fileRows as HTMLElement;
        createItemCtxMenu?.(fileRows, operative.onMenuAction.bind(operative), self.entries);
        queueMicrotask(() => {
            self.bindDropHandlers();
            const root = self.shadowRoot;
            const grids = Array.from(root?.querySelectorAll?.(".fm-grid") || []) as HTMLElement[];
            if (grids.length > 1) {
                const latest = grids.at(-1) as HTMLElement;
                for (const extra of grids) {
                    if (extra !== latest) {
                        extra.remove();
                    }
                }
                self.#rowsContainer = latest.querySelector(".fm-grid-rows") as HTMLElement | null;
            }
            self.syncRows();
        });

        //
        const rendered = H`<div class="fm-grid" part="grid">
            ${fileHeader}
            ${fileRows}
        </div>`;

        //
        return rendered;
    }
}

//
export default FileManagerContent;
