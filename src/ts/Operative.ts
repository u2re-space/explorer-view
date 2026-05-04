import { observe, iterated, ref, affected } from "fest/object";
import { isUserScopePath } from "fest/core";

// OPFS helpers
import {
    openDirectory,
    getMimeTypeByFilename,
    downloadFile,
    writeFile,
    remove,
    uploadFile,
    getFileHandle,
    getDirectoryHandle,
    copyFromOneHandlerToAnother,
    attachFile,
    provide,
    readFile,
    uploadDirectory,
    handleIncomingEntries
} from "fest/lure";

//
export type EntryKind = "file" | "directory";
export interface FileEntryItem {
    name: string;
    kind: EntryKind;
    type?: string;
    size?: number;
    lastModified?: number;
    handle?: any;
    file?: File;
}

//
const handleCache = new WeakMap<any, any>();
const waitForClipboardFrame = (): Promise<void> =>
    new Promise((resolve) => {
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => resolve());
            return;
        }
        if (typeof MessageChannel !== "undefined") {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => resolve();
            channel.port2.postMessage(undefined);
            return;
        }
        if (typeof setTimeout === "function") {
            setTimeout(() => resolve(), 16);
            return;
        }
        if (typeof queueMicrotask === "function") {
            queueMicrotask(() => resolve());
            return;
        }
        resolve();
    });

const ASSETS_ROOT = "/assets/";
const ASSET_SEED_PATHS = [
    "/assets/crossword.css",
    "/assets/icons/",
    "/assets/imgs/",
    "/assets/wallpapers/"
];
const ASSET_ICON_STYLES = ["thin", "light", "regular", "bold", "fill", "duotone"];
const ASSET_ICON_FALLBACK_NAMES = [
    "copy",
    "clipboard",
    "trash",
    "folder",
    "folder-open",
    "download",
    "upload",
    "arrow-up",
    "arrow-clockwise",
    "code",
    "eye",
    "gear",
    "printer",
    "file-doc",
    "file-text",
    "lightning",
    "pencil",
    "clock-counter-clockwise",
];

const normalizeDirectoryPath = (input?: string): string => {
    const value = (input || "/").trim() || "/";
    const withLeading = value.startsWith("/") ? value : `/${value}`;
    return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
};

const isAssetsPath = (path?: string): boolean => normalizeDirectoryPath(path).startsWith(ASSETS_ROOT);
const isVirtualRootPath = (path?: string): boolean => normalizeDirectoryPath(path) === "/";
const isReadonlyPath = (path?: string): boolean => isAssetsPath(path) || isVirtualRootPath(path);
const isIconsPath = (path?: string): boolean => normalizeDirectoryPath(path).startsWith("/assets/icons/");
const isUserPath = (path?: string): boolean => isUserScopePath(normalizeDirectoryPath(path));

const buildVirtualAssetPaths = (path: string): string[] => {
    const target = normalizeDirectoryPath(path);
    const paths = new Set<string>();
    if (!isIconsPath(target)) return [];

    // Always expose icon roots/styles even when nothing is cached yet.
    paths.add("/assets/icons/");
    paths.add("/assets/icons/phosphor/");
    paths.add("/assets/icons/duotone/");
    for (const style of ASSET_ICON_STYLES) {
        paths.add(`/assets/icons/phosphor/${style}/`);
        paths.add(`/assets/icons/${style}/`);
    }

    const addIconFiles = (base: string) => {
        for (const iconName of ASSET_ICON_FALLBACK_NAMES) {
            paths.add(`${base}${iconName}.svg`);
        }
    };

    if (target === "/assets/icons/" || target === "/assets/icons/duotone/") {
        addIconFiles("/assets/icons/duotone/");
    }

    if (target.startsWith("/assets/icons/phosphor/")) {
        const parts = target.split("/").filter(Boolean);
        if (parts.length >= 4) {
            const style = parts[3];
            if (ASSET_ICON_STYLES.includes(style)) {
                addIconFiles(`/assets/icons/phosphor/${style}/`);
            }
        }
    }

    if (target.startsWith("/assets/icons/")) {
        const parts = target.split("/").filter(Boolean);
        if (parts.length >= 3) {
            const style = parts[2];
            if (ASSET_ICON_STYLES.includes(style)) {
                addIconFiles(`/assets/icons/${style}/`);
            }
        }
    }

    return Array.from(paths);
};

//
export class FileOperative {
    // refs/state
    #entries = ref<FileEntryItem[]>([]);
    #loading = ref(false);
    #error = ref("");
    #fsRoot: any = null;
    #dirProxy: any = null;
    #loadLock = false;
    #clipboard: { items: string[]; cut?: boolean } | null = null;
    #subscribed: any = null;
    #loaderDebounceTimer: any = null;
    #readonly = ref(false);

    //
    public host: HTMLElement | null = null;
    public pathRef = ref("/");

    //
    get path() { return this.pathRef?.value || "/"; }
    set path(value: string) { if (this.pathRef) this.pathRef.value = value || "/"; }
    get entries() { return this.#entries; }
    get readonly() { return this.#readonly?.value === true; }

    //
    constructor() {
        this.#entries = ref<FileEntryItem[]>([]);
        this.pathRef ??= ref("/");

        //
        affected(this.pathRef, (path) => {
            this.#readonly.value = isReadonlyPath(path || "/");
            this.loadPath(path || "/");
        });
        navigator?.storage?.getDirectory?.()?.then?.((h) => {
            this.#fsRoot = h;
            void this.refreshList(this.path || "/");
        });
    }

    private async listAssetEntries(path: string): Promise<FileEntryItem[]> {
        const target = normalizeDirectoryPath(path);
        const knownPaths = new Set<string>(ASSET_SEED_PATHS);
        for (const virtualPath of buildVirtualAssetPaths(target)) {
            knownPaths.add(virtualPath);
        }

        try {
            const cacheNames = await caches.keys();
            for (const cacheName of cacheNames) {
                try {
                    const cache = await caches.open(cacheName);
                    const requests = await cache.keys();
                    for (const req of requests) {
                        const pathname = new URL(req.url).pathname;
                        if (pathname.startsWith(ASSETS_ROOT)) {
                            knownPaths.add(pathname);
                        }
                    }
                } catch {
                    // Ignore per-cache listing failures.
                }
            }
        } catch {
            // Cache API may be unavailable in some contexts.
        }

        const dirs = new Set<string>();
        const files: string[] = [];
        for (const full of knownPaths) {
            const normalized = full.startsWith("/") ? full : `/${full}`;
            if (!normalized.startsWith(target)) continue;
            const remainder = normalized.slice(target.length);
            if (!remainder) continue;
            const [firstSegment, ...rest] = remainder.split("/").filter(Boolean);
            if (!firstSegment) continue;
            if (rest.length > 0 || normalized.endsWith("/")) {
                dirs.add(firstSegment);
            } else {
                files.push(firstSegment);
            }
        }

        const directoryEntries = Array.from(dirs)
            .sort((a, b) => a.localeCompare(b))
            .map((name) => observe({ name, kind: "directory" as const }));

        const uniqueFiles = Array.from(new Set(files)).filter((name) => !dirs.has(name));
        const fileEntries = uniqueFiles
            .sort((a, b) => a.localeCompare(b))
            .map((name) => {
                const item: any = observe({ name, kind: "file" as const });
                item.type = getMimeTypeByFilename?.(name);
                return item;
            });

        return [...directoryEntries, ...fileEntries];
    }

    private listVirtualRootEntries(): FileEntryItem[] {
        return [
            observe({ name: "user", kind: "directory" as const }),
            observe({ name: "assets", kind: "directory" as const }),
        ];
    }

    private detachDirectoryObservers() {
        if (this.#loaderDebounceTimer) {
            clearTimeout(this.#loaderDebounceTimer);
            this.#loaderDebounceTimer = null;
        }
        if (typeof this.#subscribed === "function") {
            this.#subscribed();
            this.#subscribed = null;
        }
        if (this.#dirProxy?.dispose) {
            this.#dirProxy.dispose();
        }
        this.#dirProxy = null;
    }

    private async collectDirectoryEntries(): Promise<FileEntryItem[]> {
        const source = await this.#dirProxy?.entries?.();
        let pairs: any[] = [];
        if (Array.isArray(source)) {
            pairs = source;
        } else if (source && typeof (source as any)[Symbol.iterator] === "function") {
            pairs = Array.from(source as Iterable<any>);
        } else if (source && typeof (source as any)[Symbol.asyncIterator] === "function") {
            // Fallback for async iterators in non-proxy directory implementations.
            for await (const pair of source as AsyncIterable<any>) {
                pairs.push(pair);
            }
        }
        const entries = (await Promise.all(
            (pairs || []).map(async ($pair: any) => {
                return Promise.try(async () => {
                    const [name, handle] = $pair as any;
                    return handleCache?.getOrInsertComputed?.(handle, async () => {
                        const kind: EntryKind = handle?.kind || (name?.endsWith?.("/") ? "directory" : "file");
                        const item: any = observe({ name, kind, handle });
                        if (kind === "file") {
                            item.type = getMimeTypeByFilename?.(name);
                            try {
                                const f = await handle?.getFile?.();
                                item.file = f;
                                item.size = f?.size;
                                item.lastModified = f?.lastModified;
                                item.type = f?.type || item.type;
                            } catch {}
                        }
                        return item;
                    });
                })?.catch?.(console.warn.bind(console));
            })
        ))?.filter?.(($item: any) => $item != null);
        return entries || [];
    }

    private async getDirectoryHandleByPath(path: string, create = false): Promise<any> {
        const root = this.#fsRoot || await navigator?.storage?.getDirectory?.();
        if (!root) return null;
        const clean = normalizeDirectoryPath(path);
        const parts = clean.split("/").filter(Boolean);
        let current = root;
        for (const part of parts) {
            current = await current.getDirectoryHandle(part, { create });
        }
        return current;
    }

    private normalizeUserRelativePath(path: string): string {
        const normalized = normalizeDirectoryPath(path);
        if (normalized === "/user/") return "/";
        if (normalized.startsWith("/user/")) return normalized.slice("/user".length);
        return normalized;
    }

    private async getOpfsRootHandle(): Promise<any> {
        this.#fsRoot = this.#fsRoot || await navigator?.storage?.getDirectory?.();
        return this.#fsRoot;
    }

    private async getUserDirHandle(path: string, create = false): Promise<any> {
        const root = await this.getOpfsRootHandle();
        if (!root) return null;
        const rel = this.normalizeUserRelativePath(path);
        const parts = rel.split("/").filter(Boolean);
        let current = root;
        for (const part of parts) {
            current = await current.getDirectoryHandle(part, { create });
        }
        return current;
    }

    private async writeUserFile(file: File, destPath: string = this.path): Promise<void> {
        const dir = await this.getUserDirHandle(destPath, true);
        if (!dir) return;
        const safeName = (file?.name || `file-${Date.now()}`).trim().replace(/\s+/g, "-");
        const fileHandle = await dir.getFileHandle(safeName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(file);
        await writable.close();
    }

    /**
     * Imperative save API for shells/channels — writes into the OPFS-backed workspace folder.
     * Defaults to {@link FileOperative.path}; optional `destPath` overrides the parent directory.
     */
    async ingestFileIntoWorkspace(file: File, destPath?: string): Promise<void> {
        await this.writeUserFile(file, destPath ?? this.path);
    }

    private async removeUserEntry(absPath: string, recursive = true): Promise<boolean> {
        const root = await this.getOpfsRootHandle();
        if (!root) return false;
        const rel = this.normalizeUserRelativePath(absPath).replace(/\/+$/g, "");
        const parts = rel.split("/").filter(Boolean);
        if (!parts.length) return false;
        const name = parts.pop() as string;
        let dir = root;
        for (const part of parts) {
            dir = await dir.getDirectoryHandle(part, { create: false });
        }
        await dir.removeEntry(name, { recursive });
        return true;
    }

    private async renameUserFile(absPath: string, newName: string): Promise<void> {
        const root = await this.getOpfsRootHandle();
        if (!root) return;
        const rel = this.normalizeUserRelativePath(absPath).replace(/\/+$/g, "");
        const parts = rel.split("/").filter(Boolean);
        if (!parts.length) return;
        const oldName = parts.pop() as string;
        let dir = root;
        for (const part of parts) {
            dir = await dir.getDirectoryHandle(part, { create: false });
        }
        const oldHandle = await dir.getFileHandle(oldName, { create: false });
        const oldFile = await oldHandle.getFile();
        const safeName = (newName || "").trim().replace(/\s+/g, "-");
        if (!safeName || safeName === oldName) return;
        const newHandle = await dir.getFileHandle(safeName, { create: true });
        const writable = await newHandle.createWritable();
        await writable.write(oldFile);
        await writable.close();
        await dir.removeEntry(oldName);
    }

    private async extractFilesFromData(data: any): Promise<File[]> {
        const files: File[] = [];
        const now = Date.now();
        const extByMime = (mime: string) => {
            const m = (mime || "").toLowerCase();
            if (m.includes("css")) return "css";
            if (m.includes("json")) return "json";
            if (m.includes("markdown")) return "md";
            if (m.includes("svg")) return "svg";
            if (m.includes("png")) return "png";
            if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
            if (m.includes("gif")) return "gif";
            if (m.includes("webp")) return "webp";
            if (m.includes("plain")) return "txt";
            return "bin";
        };

        const nativeFiles = Array.from(data?.files ?? []).filter((f: any) => f instanceof File);
        files.push(...nativeFiles);

        const items = Array.from(data?.items ?? []);
        for (const item of items as any[]) {
            if (item?.kind === "file" && typeof item?.getAsFile === "function") {
                const f = item.getAsFile();
                if (f instanceof File) files.push(f);
                continue;
            }
            const types = Array.from(item?.types ?? []);
            if (typeof item?.getType === "function" && types.length > 0) {
                const type = String(types[0] || "");
                try {
                    const blob = await item.getType(type);
                    if (!blob) continue;
                    const ext = extByMime(blob.type || type);
                    files.push(new File([blob], `clipboard-${now}-${files.length}.${ext}`, {
                        type: blob.type || type,
                        lastModified: now
                    }));
                } catch {}
            }
        }
        return files;
    }

    private async readEntriesFromDirectory(dir: any): Promise<FileEntryItem[]> {
        if (!dir) return [];
        const entries: FileEntryItem[] = [];
        for await (const [name, handle] of dir.entries()) {
            const kind: EntryKind = handle?.kind || (name?.endsWith?.("/") ? "directory" : "file");
            const item: any = observe({ name, kind, handle });
            if (kind === "file") {
                item.type = getMimeTypeByFilename?.(name);
                try {
                    const f = await handle?.getFile?.();
                    item.file = f;
                    item.size = f?.size;
                    item.lastModified = f?.lastModified;
                    item.type = f?.type || item.type;
                } catch {}
            }
            entries.push(item);
        }
        return entries;
    }

    private async listUserEntriesDirect(path: string, createIfMissing = false): Promise<FileEntryItem[]> {
        const normalized = normalizeDirectoryPath(path);
        const strippedPath = normalized.replace(/^\/user\/?/, "/");
        const legacyPath = normalized; // Legacy layout may physically contain "/user/*" in OPFS.

        const dirs: any[] = [];
        const tryPush = (dir: any) => {
            if (!dir) return;
            if (!dirs.includes(dir)) dirs.push(dir);
        };

        tryPush(await this.getDirectoryHandleByPath(strippedPath, false).catch(() => null));
        if (legacyPath !== strippedPath) {
            tryPush(await this.getDirectoryHandleByPath(legacyPath, false).catch(() => null));
        }

        if (!dirs.length && createIfMissing) {
            tryPush(await this.getDirectoryHandleByPath(strippedPath, true).catch(() => null));
        }

        const merged = new Map<string, FileEntryItem>();
        for (const dir of dirs) {
            const chunk = await this.readEntriesFromDirectory(dir);
            for (const entry of chunk) {
                if (!entry?.name) continue;
                const key = `${entry.kind}:${entry.name}`;
                if (!merged.has(key)) merged.set(key, entry);
            }
        }
        return Array.from(merged.values());
    }

    private applyEntries(entries: FileEntryItem[]) {
        const unique = new Map<string, FileEntryItem>();
        for (const entry of entries || []) {
            if (!entry || !entry.name) continue;
            const key = `${entry.kind}:${entry.name}`;
            if (!unique.has(key)) unique.set(key, entry);
        }
        (this.#entries as any).value = Array.from(unique.values());
        this.dispatchEvent(new CustomEvent("entries-updated", {
            detail: { path: this.path, count: unique.size },
            bubbles: true,
            composed: true
        }));
    }

    //
    async itemAction(item: FileEntryItem) {
        const self: any = this;
        const detail = { path: (self.path || "/") + item?.name, item, originalEvent: null };
        const event = new CustomEvent("open-item", { detail, bubbles: true, composed: true, cancelable: true });
        this.host?.dispatchEvent(event);
        if (event.defaultPrevented) return;

        //
        if (item?.kind === "directory") {
            const next = (self.path?.endsWith?.("/") ? self.path : self.path + "/") + item?.name + "/";
            self.path = next;
        } else {
            const abs = (self.path || "/") + (item?.name || "");
            if (!item?.file && isAssetsPath(abs)) {
                item.file = await provide(abs).catch(() => null);
                if (item.file) {
                    item.size = item.file.size;
                    item.lastModified = item.file.lastModified;
                    item.type = item.file.type || item.type;
                }
            }
            const openEvent = new CustomEvent("open", { detail, bubbles: true, composed: true });
            this.host?.dispatchEvent(openEvent);
        }
    }

    //
    async requestUse() {
        // TODO: implement
    }

    //
    async refreshList(path: any|string = this.path) {
        await this.loadPath(path);
        return this;
    }

    //
    async loadPath(path: any|string = this.path) {
        const self: any = this;

        //
        if (this.#loadLock) {
            if (typeof globalThis.requestIdleCallback === "function") {
                return globalThis.requestIdleCallback(() => this.loadPath(path), { timeout: 1000 });
            }
            return globalThis.setTimeout(() => this.loadPath(path), 0);
        }
        this.#loadLock = true;

        //
        try {
            this.#loading.value = true;
            this.#error.value = "";
            const rel = normalizeDirectoryPath(path?.value || path || this.path || "/");
            this.detachDirectoryObservers();
            if (isVirtualRootPath(rel)) {
                this.applyEntries(this.listVirtualRootEntries());
                return this;
            }
            if (isAssetsPath(rel)) {
                this.applyEntries(await this.listAssetEntries(rel));
                return this;
            }

            if (isUserPath(rel)) {
                const entries = await this.listUserEntriesDirect(rel, true);
                this.applyEntries(entries);
                return this;
            }

            //
            try {
                this.#dirProxy = openDirectory(this.#fsRoot, rel, { create: false });
                await this.#dirProxy;
            } catch (openErr) {
                // In /user scope we tolerate missing folders and create them on navigation.
                if (!isUserPath(rel)) throw openErr;
                this.#dirProxy = openDirectory(this.#fsRoot, rel, { create: true });
                await this.#dirProxy;
            }

            console.log("rel", rel);
            
            //
            const loader = async () => {
                const entries = await this.collectDirectoryEntries();
                if (entries?.length != null && entries?.length >= 0 && typeof entries?.length == "number") {
                    this.applyEntries(entries);
                }
            };

            //
            const debouncedLoader = () => {
                if (this.#loaderDebounceTimer) { clearTimeout(this.#loaderDebounceTimer); }
                this.#loaderDebounceTimer = setTimeout(() => loader(), 50);
            };

            //
            await loader()?.catch?.(console.warn.bind(console));
            this.#subscribed = affected((await this.#dirProxy?.getMap?.() ?? []), debouncedLoader);
        } catch (e: any) {
            this.#error.value = e?.message || String(e || "");
            // Never show stale rows from previous path on load failure.
            this.applyEntries([]);
            console.warn(e);
        } finally {
            this.#loading.value = false;
            this.#loadLock = false;
        }
        return this;
    }

    //
    protected onRowClick = (item: FileEntryItem, ev: MouseEvent) => { ev.preventDefault(); void this.itemAction(item); };
    protected onRowDblClick = (item: FileEntryItem, ev: MouseEvent) => { ev.preventDefault(); void this.itemAction(item); };
    protected onRowDragStart = (item: FileEntryItem, ev: DragEvent) => {
        if (!ev.dataTransfer) return;
        ev.dataTransfer.effectAllowed = "copyMove";

        //
        const abs = (this.path || "/") + (item?.name || "");
        ev.dataTransfer.setData("text/plain", abs);
        ev.dataTransfer.setData("text/uri-list", abs);
        if (item?.file) {
            ev.dataTransfer.setData("DownloadURL", item?.file?.type + ":" + item?.file?.name + ":" + URL.createObjectURL(item?.file as any));
            ev.dataTransfer.items.add(item?.file as any);
        }
    };

    //
    protected async onMenuAction(item: FileEntryItem | null, actionId: string, ev: MouseEvent) {
        try {
            const itemName = item?.name;
            if (!actionId) return; const abs = (this.path || "/") + (itemName || ""); switch (actionId) {
                case "delete":
                case "rename":
                case "movePath":
                    if (this.readonly || isReadonlyPath(abs)) {
                        this.dispatchEvent(new CustomEvent("readonly-blocked", {
                            detail: { action: actionId, path: abs },
                            bubbles: true,
                            composed: true
                        }));
                        break;
                    }
                    if (actionId === "delete") {
                        if (isUserPath(abs)) {
                            await this.removeUserEntry(abs, true);
                        } else {
                            await remove(this.#fsRoot, abs);
                        }
                        await this.refreshList(this.path);
                        break;
                    }
                    if (actionId === "rename") {
                        if (item?.kind === "file") {
                            const next = prompt("Rename to:", itemName);
                            if (next && next !== itemName) {
                                if (isUserPath(abs)) {
                                    await this.renameUserFile(abs ?? "", next ?? "");
                                } else {
                                    await this.renameFile(abs ?? "", next ?? "");
                                }
                                await this.refreshList(this.path);
                            }
                        }
                        break;
                    }
                    break;
                case "open":
                    await this.itemAction(item as FileEntryItem);
                    break;
                case "view":
                    // Dispatch custom event for unified messaging
                    this.dispatchEvent(new CustomEvent('context-action', {
                        detail: { action: 'view', item }
                    }));
                    break;
                case "attach-workcenter":
                    // Dispatch custom event for unified messaging
                    this.dispatchEvent(new CustomEvent('context-action', {
                        detail: { action: 'attach-workcenter', item }
                    }));
                    break;
                case "download":
                    Promise.try(async () => {
                        if (isAssetsPath(abs)) {
                            const file = await provide(abs);
                            if (file) await downloadFile(file);
                            return;
                        }
                        if (item?.kind === "file") {
                            await downloadFile(await getFileHandle(this.#fsRoot, abs, { create: false }));
                        } else {
                            await downloadFile(await getDirectoryHandle(this.#fsRoot, abs, { create: false }));
                        }
                    }).catch(console.warn);
                     break;
                case "copyPath":
                    this.#clipboard = { items: [abs], cut: false };
                    try {
                        await waitForClipboardFrame();
                        await navigator.clipboard?.writeText?.(abs);
                    } catch { }
                    break;
                case "copy":
                    this.#clipboard = { items: [abs], cut: false };
                    try {
                        await waitForClipboardFrame();
                        await navigator.clipboard?.writeText?.(abs);
                    } catch { }
                    break;
            }
        } catch (e: any) {
            console.warn(e);
            this.#error.value = e?.message || String(e || "");
        }
    }

    //
    protected async renameFile(oldName: string, newName: string) {
        const fromHandle = await getFileHandle(this.#fsRoot, oldName, { create: false });
        const file = await fromHandle?.getFile?.();
        if (!file) return;
        const target = await getFileHandle(this.#fsRoot, newName, { create: true }).catch(() => null);
        if (!target) {
            await writeFile(this.#fsRoot, this.path + newName, file);
        } else {
            await writeFile(this.#fsRoot, this.path + newName, file);
        }
        await remove(this.#fsRoot, this.path + oldName);
    }

    //
    async requestUpload() {
        if (this.readonly || isReadonlyPath(this.path)) return;
        try {
            const picker = (window as any)?.showOpenFilePicker;
            if (picker && isUserPath(this.path)) {
                const handles = await picker({ multiple: true }).catch(() => []);
                for (const handle of handles || []) {
                    const file = await handle?.getFile?.();
                    if (file instanceof File) {
                        await this.writeUserFile(file, this.path);
                    }
                }
            } else {
                await uploadFile(this.path, null);
            }
            await this.refreshList(this.path);
        } catch (e) { console.warn(e); }
    }

    //
    async requestPaste() {
        if (this.readonly || isReadonlyPath(this.path)) return;
        try {
            // 1. Try modern Async Clipboard API first (images, files)
            try {
                // @ts-ignore
                await waitForClipboardFrame();
                const clipboardItems = await navigator.clipboard.read();
                if (clipboardItems && clipboardItems.length > 0) {
                    const files = await this.extractFilesFromData(clipboardItems);
                    if (files.length > 0 && isUserPath(this.path)) {
                        for (const file of files) {
                            await this.writeUserFile(file, this.path);
                        }
                        await this.refreshList(this.path);
                        return;
                    }
                }
            } catch (e) {
                // Fallback or permission denied
            }

            // 2. Try System Clipboard Text
            let systemText = "";
            try {
                await waitForClipboardFrame();
                systemText = await navigator.clipboard?.readText?.();
            } catch { }

            // 3. Check internal clipboard
            const internalItems = this.#clipboard?.items || [];

            // Determine sources: Prefer internal if valid and no system text override (simple heuristic)
            // Actually, unified handling:
            if (systemText) {
                // Preserve text paste behavior for non-file clipboard content.
                await handleIncomingEntries({
                    getData: (type: string) => type === "text/plain" ? systemText : ""
                }, this.path || "/");
                await this.refreshList(this.path);
                return;
            }

            if (internalItems.length > 0) {
                const txt = internalItems.join("\n");
                if (isUserPath(this.path) && internalItems.every((x) => String(x || "").startsWith("/user/"))) {
                    for (const src of internalItems) {
                        const file = await readFile(this.#fsRoot, src).catch(() => null);
                        if (file instanceof File) {
                            await this.writeUserFile(file, this.path);
                            if (this.#clipboard?.cut) await this.removeUserEntry(src, true).catch(() => null);
                        }
                    }
                    if (this.#clipboard?.cut) this.#clipboard = null;
                } else {
                    await handleIncomingEntries({
                        getData: (type: string) => type === "text/plain" ? txt : ""
                    }, this.path || "/");
                }
                await this.refreshList(this.path);
            }
        } catch (e) { console.warn(e); }
    }

    //
    public onPaste(ev: ClipboardEvent) {
        if (this.readonly || isReadonlyPath(this.path)) return;
        ev.preventDefault();

        // Try to read from event first
        if (ev.clipboardData || (ev as any).dataTransfer) {
            void Promise.try(async () => {
                const payload = ev.clipboardData || (ev as any).dataTransfer;
                const files = await this.extractFilesFromData(payload);
                if (files.length > 0 && isUserPath(this.path)) {
                    for (const file of files) {
                        await this.writeUserFile(file, this.path);
                    }
                } else {
                    await handleIncomingEntries(payload, this.path || "/");
                }
                await this.refreshList(this.path);
            }).catch(console.warn);
            return;
        }

        //
        this.requestPaste();
    }

    //
    public onCopy(ev: ClipboardEvent) {
        // Not implemented selection tracking yet
    }

    //
    public async onDrop(ev: DragEvent) {
        if (this.readonly || isReadonlyPath(this.path)) return;
        ev.preventDefault();

        //
        if ((ev as any).clipboardData || (ev as any).dataTransfer) {
            const payload = (ev as any).clipboardData || (ev as any).dataTransfer;
            const files = await this.extractFilesFromData(payload);
            if (files.length > 0 && isUserPath(this.path)) {
                for (const file of files) {
                    await this.writeUserFile(file, this.path);
                }
            } else {
                await handleIncomingEntries(payload, this.path || "/");
            }
            await this.refreshList(this.path);
            return;
        }
    }

    //
    protected dispatchEvent(event: Event) {
        this.host?.dispatchEvent(event);
    }
}

export default FileOperative;
