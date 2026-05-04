import { MOCElement } from "fest/dom";
import type { FileEntryItem } from "./Operative";
import { ctxMenuTrigger, H } from "fest/lure";


type ContextMenuEntry = {
    id: string;
    label: string;
    icon?: string;
    disabled?: boolean;
    danger?: boolean;
    children?: ContextMenuEntry[];
    action: () => void | Promise<void>;
};

type ContextMenuOpenRequest = {
    x: number;
    y: number;
    items: ContextMenuEntry[];
    compact?: boolean;
};

const SUBMENU_HOVER_OPEN_MS = 320;
const SUBMENU_HOVER_CLOSE_MS = 220;

let styleMounted = false;
let menuSession = 0;
let menuLayer: HTMLElement | null = null;
let rootMenu: HTMLElement | null = null;
let cleanupFns: Array<() => void> = [];
let menuSeed = 0;

const submenuByDepth = new Map<number, HTMLElement>();
const submenuAnchorByDepth = new Map<number, HTMLButtonElement>();
const submenuOpenTimers = new Map<number, ReturnType<typeof setTimeout>>();
const submenuCloseTimers = new Map<number, ReturnType<typeof setTimeout>>();

const supportsAnchorPositioning = typeof CSS !== "undefined"
    && (CSS.supports("position-anchor: --cw-anchor-test")
        || CSS.supports("anchor-name: --cw-anchor-test"));
const ENABLE_CSS_ANCHOR_POSITIONING = false;

const ensureStyle = (): void => {
    if (styleMounted) return;
    styleMounted = true;

    const style = document.createElement("style");
    style.id = "cw-unified-context-menu-style";
    style.textContent = `
        .cw-context-menu-layer {
            position: fixed;
            inset: 0;
            z-index: 2000;
            pointer-events: none;
        }

        .cw-context-menu {
            position: fixed;
            min-inline-size: 220px;
            max-inline-size: min(320px, calc(100vw - 24px));
            padding: 0.4rem;
            border-radius: 14px;
            border: none;
            background: color-mix(in oklab, #0c1018 88%, #1a2842 12%);
            box-shadow:
                0 14px 36px rgba(0, 0, 0, 0.45),
                0 0 0 1px rgba(255, 255, 255, 0.06);
            backdrop-filter: blur(14px);
            pointer-events: auto;
            user-select: none;
        }

        .cw-context-menu.cw-context-menu--compact {
            min-inline-size: 188px;
            padding: 0.3rem;
        }

        .cw-context-menu__list {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 0.2rem;
            justify-items: stretch;
            text-align: left;
        }

        .cw-context-menu__item {
            inline-size: 100%;
            display: grid;
            grid-template-columns: 1.375rem minmax(0, 1fr) auto;
            align-items: center;
            gap: 0.55rem;
            border: 0;
            border-radius: 10px;
            background: transparent;
            color: #eaf0ff;
            padding: 0.5rem 0.6rem;
            min-block-size: 2.35rem;
            font-size: 0.8125rem;
            line-height: 1.25;
            text-align: start !important;
            cursor: pointer;
            justify-items: start;
        }

        .cw-context-menu__item:hover,
        .cw-context-menu__item:focus-visible {
            outline: none;
            background: rgba(137, 176, 255, 0.14);
        }

        .cw-context-menu__item[disabled] {
            opacity: 0.45;
            cursor: default;
        }

        .cw-context-menu__item--danger {
            color: #ff9da1;
        }

        .cw-context-menu__icon {
            justify-self: center;
            inline-size: 1.375rem;
            block-size: 1.375rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }

        .cw-context-menu__icon ui-icon {
            --icon-size: 1.125rem;
            pointer-events: none;
        }

        .cw-context-menu__label {
            justify-self: stretch;
            text-align: start !important;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            min-inline-size: 0;
        }

        .cw-context-menu__chevron {
            justify-self: end;
            opacity: 0.72;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }

        .cw-context-menu__chevron ui-icon {
            --icon-size: 0.85rem;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
};

const getOverlayHost = (): HTMLElement => {
    const overlay = document.querySelector('[data-app-layer="overlay"]') as HTMLElement | null;
    return overlay || document.body;
};

const clearCleanup = (): void => {
    for (const fn of cleanupFns) {
        try {
            fn();
        } catch {
            // ignore
        }
    }
    cleanupFns = [];
};

const clearTimersFromDepth = (depth: number): void => {
    for (const [key, timer] of Array.from(submenuOpenTimers.entries())) {
        if (key >= depth) {
            clearTimeout(timer);
            submenuOpenTimers.delete(key);
        }
    }
    for (const [key, timer] of Array.from(submenuCloseTimers.entries())) {
        if (key >= depth) {
            clearTimeout(timer);
            submenuCloseTimers.delete(key);
        }
    }
};

const placeMenu = (menu: HTMLElement, x: number, y: number): void => {
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    const rect = menu.getBoundingClientRect();
    const maxX = Math.max(8, window.innerWidth - rect.width - 8);
    const maxY = Math.max(8, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.min(Math.max(8, x), maxX)}px`;
    menu.style.top = `${Math.min(Math.max(8, y), maxY)}px`;
};

const closeSubmenusFromDepth = (depth: number): void => {
    clearTimersFromDepth(depth);
    for (const [key, submenu] of Array.from(submenuByDepth.entries())) {
        if (key >= depth) {
            submenu.remove();
            submenuByDepth.delete(key);
            submenuAnchorByDepth.delete(key);
        }
    }
};

const placeSubmenuWithFallback = (submenu: HTMLElement, anchor: HTMLElement): void => {
    const rect = anchor.getBoundingClientRect();
    placeMenu(submenu, Math.round(rect.right + 4), Math.round(rect.top));
};

const cancelScheduledCloseFromDepth = (depth: number): void => {
    for (const [key, timer] of Array.from(submenuCloseTimers.entries())) {
        if (key >= depth) {
            clearTimeout(timer);
            submenuCloseTimers.delete(key);
        }
    }
};

const buildMenuElement = (
    entries: ContextMenuEntry[],
    compact: boolean,
    depth: number,
    session: number
): HTMLElement => {
    const menu = document.createElement("div");
    menu.className = `cw-context-menu${compact ? " cw-context-menu--compact" : ""}`;
    menu.setAttribute("role", "menu");
    menu.dataset.menuDepth = String(depth);

    const list = document.createElement("ul");
    list.className = "cw-context-menu__list";
    menu.appendChild(list);

    const openSubmenu = (item: ContextMenuEntry, anchorButton: HTMLButtonElement, nextDepth: number): void => {
        if (session !== menuSession || !rootMenu?.isConnected || !menuLayer?.isConnected) return;
        closeSubmenusFromDepth(nextDepth);
        if (!item.children?.length) return;

        const submenu = buildMenuElement(item.children, compact, nextDepth, session);
        submenu.classList.add("cw-context-menu--submenu");
        menuLayer.appendChild(submenu);
        submenuByDepth.set(nextDepth, submenu);
        submenuAnchorByDepth.set(nextDepth, anchorButton);

        if (ENABLE_CSS_ANCHOR_POSITIONING && supportsAnchorPositioning) {
            menuSeed += 1;
            const anchorName = `--cw-anchor-${menuSeed}`;
            anchorButton.style.setProperty("anchor-name", anchorName);
            submenu.style.setProperty("position-anchor", anchorName);
            submenu.style.setProperty("position-area", "right span-bottom");
            submenu.style.setProperty("position-try-fallbacks", "flip-inline, flip-block");
            queueMicrotask(() => placeSubmenuWithFallback(submenu, anchorButton));
        } else {
            placeSubmenuWithFallback(submenu, anchorButton);
        }
    };

    const scheduleOpenSubmenu = (item: ContextMenuEntry, anchorButton: HTMLButtonElement, nextDepth: number): void => {
        const existingOpen = submenuOpenTimers.get(nextDepth);
        if (existingOpen) clearTimeout(existingOpen);
        cancelScheduledCloseFromDepth(nextDepth);
        const timer = setTimeout(() => {
            submenuOpenTimers.delete(nextDepth);
            openSubmenu(item, anchorButton, nextDepth);
        }, SUBMENU_HOVER_OPEN_MS);
        submenuOpenTimers.set(nextDepth, timer);
    };

    const scheduleCloseSubmenuFromDepth = (nextDepth: number): void => {
        const existingClose = submenuCloseTimers.get(nextDepth);
        if (existingClose) clearTimeout(existingClose);
        const timer = setTimeout(() => {
            submenuCloseTimers.delete(nextDepth);
            closeSubmenusFromDepth(nextDepth);
        }, SUBMENU_HOVER_CLOSE_MS);
        submenuCloseTimers.set(nextDepth, timer);
    };

    for (const item of entries) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `cw-context-menu__item${item.danger ? " cw-context-menu__item--danger" : ""}`;
        button.setAttribute("role", "menuitem");
        button.disabled = Boolean(item.disabled);

        const hasChildren = Boolean(item.children?.length);
        button.innerHTML = `
            <span class="cw-context-menu__icon">${item.icon ? `<ui-icon icon="${item.icon}"></ui-icon>` : ""}</span>
            <span class="cw-context-menu__label">${item.label}</span>
            <span class="cw-context-menu__chevron">${hasChildren ? `<ui-icon icon="caret-right"></ui-icon>` : ""}</span>
        `;

        if (hasChildren) {
            const nextDepth = depth + 1;
            button.setAttribute("aria-haspopup", "menu");
            button.addEventListener("pointerenter", () => scheduleOpenSubmenu(item, button, nextDepth));
            button.addEventListener("pointerleave", () => scheduleCloseSubmenuFromDepth(nextDepth));
            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (session !== menuSession || !rootMenu?.isConnected) return;
                cancelScheduledCloseFromDepth(nextDepth);
                const existing = submenuByDepth.get(nextDepth);
                const activeAnchor = submenuAnchorByDepth.get(nextDepth);
                if (existing?.isConnected && activeAnchor === button) {
                    closeSubmenusFromDepth(nextDepth);
                    return;
                }
                openSubmenu(item, button, nextDepth);
            });
        } else {
            button.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (session !== menuSession || !rootMenu?.isConnected) return;
                closeUnifiedContextMenu();
                if (item.disabled) return;
                await item.action();
            });
        }

        const li = document.createElement("li");
        li.appendChild(button);
        list.appendChild(li);
    }

    menu.addEventListener("pointerenter", () => cancelScheduledCloseFromDepth(depth));
    menu.addEventListener("pointerleave", () => {
        if (depth > 0) {
            const existingClose = submenuCloseTimers.get(depth);
            if (existingClose) clearTimeout(existingClose);
            const timer = setTimeout(() => {
                submenuCloseTimers.delete(depth);
                closeSubmenusFromDepth(depth);
            }, SUBMENU_HOVER_CLOSE_MS);
            submenuCloseTimers.set(depth, timer);
        }
    });

    return menu;
};

export const closeUnifiedContextMenu = (): void => {
    clearCleanup();
    clearTimersFromDepth(0);
    closeSubmenusFromDepth(1);
    submenuByDepth.clear();
    submenuAnchorByDepth.clear();
    rootMenu?.remove();
    rootMenu = null;
    menuLayer?.remove();
    menuLayer = null;
    menuSession += 1;
};

export const openUnifiedContextMenu = (request: ContextMenuOpenRequest): void => {
    const entries = (request.items || []).filter((item) => item && item.id && item.label);
    if (!entries.length) {
        closeUnifiedContextMenu();
        return;
    }

    ensureStyle();
    closeUnifiedContextMenu();
    const session = menuSession;

    const overlayHost = getOverlayHost();
    overlayHost.style.pointerEvents = overlayHost.style.pointerEvents || "none";

    const layer = document.createElement("div");
    layer.className = "cw-context-menu-layer";
    menuLayer = layer;
    overlayHost.appendChild(layer);

    const menu = buildMenuElement(entries, Boolean(request.compact), 0, session);
    rootMenu = menu;
    layer.appendChild(menu);
    placeMenu(menu, request.x, request.y);

    const onPointerDown = (event: Event) => {
        if (session !== menuSession || !menuLayer?.isConnected) return;
        const target = event.target as Node | null;
        if (target && menuLayer.contains(target)) return;
        closeUnifiedContextMenu();
    };

    const onMenuInternalClick = (event: Event) => {
        if (session !== menuSession || !rootMenu?.isConnected) return;
        const target = event.target as HTMLElement | null;
        if (!target) return;
        const parentItem = target.closest?.(".cw-context-menu__item") as HTMLElement | null;
        if (!parentItem) {
            closeSubmenusFromDepth(1);
            return;
        }
        const hasChildren = parentItem.getAttribute("aria-haspopup") === "menu";
        if (!hasChildren) {
            closeSubmenusFromDepth(1);
        }
    };

    const onEscape = (event: KeyboardEvent) => {
        if (session !== menuSession) return;
        if (event.key === "Escape") closeUnifiedContextMenu();
    };

    const close = () => closeUnifiedContextMenu();

    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    document.addEventListener("contextmenu", onPointerDown, { capture: true });
    document.addEventListener("keydown", onEscape);
    menu.addEventListener("click", onMenuInternalClick, { capture: true });
    window.addEventListener("resize", close, { passive: true });
    window.addEventListener("blur", close, { passive: true });

    cleanupFns.push(() => document.removeEventListener("pointerdown", onPointerDown, { capture: true } as EventListenerOptions));
    cleanupFns.push(() => document.removeEventListener("contextmenu", onPointerDown, { capture: true } as EventListenerOptions));
    cleanupFns.push(() => document.removeEventListener("keydown", onEscape));
    cleanupFns.push(() => menu.removeEventListener("click", onMenuInternalClick, { capture: true } as EventListenerOptions));
    cleanupFns.push(() => window.removeEventListener("resize", close));
    cleanupFns.push(() => window.removeEventListener("blur", close));
};

export type { ContextMenuEntry, ContextMenuOpenRequest };

//
const disconnectRegistry = new FinalizationRegistry((ctxMenu: HTMLElement) => {
    // utilize redundant ctx menu from DOM
    //ctxMenu?.remove?.();
});

//
const makeFileActionOps = () => {
    return [
        { id: "open", label: "Open", icon: "function" },
        { id: "view", label: "View", icon: "eye" },
        { id: "view-base", label: "View (Base tab)", icon: "arrow-square-out" },
        { id: "attach-workcenter", label: "Attach to Work Center", icon: "lightning" },
        { id: "attach-workcenter-queued", label: "Queue attach (pending)", icon: "clock-counter-clockwise" },
        { id: "attach-workcenter-headless", label: "Queue attach (headless)", icon: "wave-sine" },
        { id: "pin-home", label: "Pin to Home Screen", icon: "push-pin-simple" },
        { id: "download", label: "Download", icon: "download" }
    ];
};

//
const makeFileSystemOps = () => {
    return [
        { id: "delete", label: "Delete", icon: "trash" },
        { id: "rename", label: "Rename", icon: "pencil" },
        { id: "copyPath", label: "Copy Path", icon: "copy" },
        { id: "movePath", label: "Move Path", icon: "hand-withdraw" }
    ];
};

//
const makeContextMenu = () => {
    const ctxMenu = H`<ul class="round-decor ctx-menu ux-anchor" style="position: fixed; z-index: 99999;" data-hidden></ul>`;
    const overlay = document.querySelector('[data-app-layer="overlay"]') as HTMLElement | null;
    const basicApp = document.querySelector(".basic-app") as HTMLElement | null;
    (overlay || basicApp || document.body).append(ctxMenu);
    return ctxMenu;
};

//
export const createItemCtxMenu = async (fileManager: any, onMenuAction: (item: FileEntryItem | null | undefined, actionId: string, ev: MouseEvent) => Promise<void>, entries: {value: FileEntryItem[]}) => {
    const ctxMenuDesc = {
        openedWith: null,
        items: [
            makeFileActionOps(),
            makeFileSystemOps(),
        ],
        defaultAction: (initiator: HTMLElement, menuItem: any, ev: MouseEvent) => {
            const rowFromCompose = Array.from(ev?.composedPath?.() || []).find((element: any) => element?.classList?.contains?.("row")) || MOCElement(initiator, ".row");
            onMenuAction?.(((entries?.value ?? entries) as FileEntryItem[])?.find?.(item => (item?.name === (rowFromCompose as any)?.getAttribute?.("data-id"))), menuItem?.id, ev);
        }
    };

    //
    const initiatorElement = fileManager;

    //
    const ctxMenu = makeContextMenu();
    ctxMenuTrigger(initiatorElement as any, ctxMenuDesc, ctxMenu);
    disconnectRegistry.register(initiatorElement, ctxMenu);
    return ctxMenu;
}
