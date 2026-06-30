/**
 * Explorer appearance: resolves light / dark / system and applies stable data attributes +
 * `color-scheme` so UA form controls / scrollbars track the shell.
 *
 * NOTE: `system` follows CrossWord’s `document.documentElement[data-theme]` first (from Theme.syncBrowserChromeTheme),
 * then `(prefers-color-scheme)`, so explorer matches the app shell after async theme loads.
 */

export type ExplorerColorScheme = "light" | "dark" | "system";

/** Read app-level resolved theme when available (PWA / shell); else null. */
export function readAppDataTheme(): "light" | "dark" | null {
    if (typeof document === "undefined") return null;
    const raw = document.documentElement?.getAttribute("data-theme");
    if (raw === "light" || raw === "dark") return raw;
    return null;
}

/** Effective scheme after resolving `system` — prefers `html[data-theme]`, then prefers-color-scheme. */
export function resolveExplorerColorSchemePreference(mode: ExplorerColorScheme | undefined | null): "light" | "dark" {
    if (mode === "light" || mode === "dark") return mode;
    const fromDoc = readAppDataTheme();
    if (fromDoc) return fromDoc;
    if (typeof globalThis.matchMedia === "function" && globalThis.matchMedia("(prefers-color-scheme: light)").matches) {
        return "light";
    }
    return "dark";
}

/** Push resolved scheme onto the explorer shell for CSS tokens under `[data-explorer-color-scheme]`. */
export function applyExplorerColorScheme(shellRoot: HTMLElement | null | undefined, mode?: ExplorerColorScheme | null): void {
    if (!shellRoot) return;
    const resolved = resolveExplorerColorSchemePreference(mode ?? undefined);
    shellRoot.dataset.explorerColorScheme = resolved;
    shellRoot.style.setProperty("color-scheme", resolved);
}

export type ExplorerThemeSync = {
    disconnect: () => void;
};

/**
 * When `colorScheme === "system"`, re-apply explorer tokens whenever app `data-theme` or OS scheme changes.
 * Call `disconnect()` on unmount; no-op if `mode` is fixed `light` | `dark`.
 */
export function subscribeExplorerSystemTheme(
    shellRoot: HTMLElement | null | undefined,
    getMode: () => ExplorerColorScheme | undefined | null
): ExplorerThemeSync {
    const noop = (): ExplorerThemeSync => ({ disconnect: () => {} });
    if (!shellRoot || typeof document === "undefined") return noop();

    const apply = (): void => {
        if (!shellRoot.isConnected) return;
        const mode = getMode() ?? "system";
        if (mode !== "system") return;
        applyExplorerColorScheme(shellRoot, "system");
    };

    const mode = getMode() ?? "system";
    if (mode !== "system") return noop();

    const root = document.documentElement;
    const mq = typeof globalThis.matchMedia === "function" ? globalThis.matchMedia("(prefers-color-scheme: dark)") : null;

    const obs = new MutationObserver(apply);
    try {
        obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    } catch {
        obs.disconnect();
        return noop();
    }

    mq?.addEventListener("change", apply);

    apply();

    return {
        disconnect: () => {
            obs.disconnect();
            mq?.removeEventListener("change", apply);
        }
    };
}
