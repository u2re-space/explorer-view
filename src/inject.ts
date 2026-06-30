/**
 * Explorer extension API — optional hooks merged by `runtime.ts` when wiring `<ui-file-manager>`.
 * Use `registerExplorerInject()` for app-wide additions; per-instance via `explorerInject` in view options.
 */

import type { ContextMenuItem } from "./utils";

/** Item shape mirrored from file-manager operative payloads. */
export type ExplorerFileItem = {
    name?: string;
    kind?: "file" | "directory";
    file?: File;
};

export type ExplorerInjectApi = {
    /** Extra empty-area context menu entries (appended after built-ins). */
    extraBackgroundMenuItems?: (ctx: { path: string }) => ContextMenuItem[];
    /** Row/context-action handlers; merged with built-ins (later layers override keys). */
    contextActionHandlers?: Record<string, (item?: ExplorerFileItem) => void | Promise<void>>;
    /** Invoked once after the subtree is resolved (file manager or fallback root). */
    onWire?: (fileManager: HTMLElement | null, shellRoot: HTMLElement) => void;
};

/** Merge inject layers: menu items concatenate; handlers shallow-merge last-wins; onWire chains in order. */
export function mergeExplorerInject(...layers: (ExplorerInjectApi | undefined)[]): ExplorerInjectApi | undefined {
    const defined = layers.filter(Boolean) as ExplorerInjectApi[];
    if (!defined.length) return undefined;
    return {
        extraBackgroundMenuItems: (ctx) => defined.flatMap((l) => l.extraBackgroundMenuItems?.(ctx) ?? []),
        contextActionHandlers: defined.reduce<Record<string, (item?: ExplorerFileItem) => void | Promise<void>>>(
            (acc, l) => ({ ...acc, ...(l.contextActionHandlers ?? {}) }),
            {}
        ),
        onWire: (fm, root) => {
            for (const l of defined) {
                l.onWire?.(fm, root);
            }
        }
    };
}

let registered: ExplorerInjectApi | undefined;

/** App-wide explorer hooks (boot/plugins). */
export function registerExplorerInject(api: ExplorerInjectApi | undefined): void {
    registered = api;
}

export function getRegisteredExplorerInject(): ExplorerInjectApi | undefined {
    return registered;
}
