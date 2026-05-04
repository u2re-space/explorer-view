/**
 * Unified Types for File Manager Components
 *
 * Consolidated types from RsExplorer, FileManagerContent, and Operative.
 * Supports both OPFS and File System Access API.
 */
import type { DataAsset } from "fest/lure";

// ============================================================================
// FILE ENTRY TYPES
// ============================================================================

export type EntryKind = "file" | "directory";

/**
 * Unified file entry item - works with both OPFS and File System Access API
 */
export interface FileEntry {
    /** File or directory name */
    name: string;
    /** Entry type */
    kind: EntryKind;
    /** MIME type (for files) */
    type?: string;
    /** File size in bytes */
    size?: number;
    /** Last modified timestamp */
    lastModified?: number;
    /** File System Handle (OPFS or File System Access API) */
    handle?: FileSystemHandle | FileSystemDirectoryHandle | FileSystemFileHandle;
    /** File object (if loaded) */
    file?: File;
    /** Full path (optional, computed) */
    path?: string;
    /**
     * Unified payload for file/blob/base64/url sources.
     * Keeps metadata compact (hash-name + mime + size).
     */
    dataAsset?: DataAsset;
}

/** @deprecated Use FileEntry instead */
export type FileItem = FileEntry;

/** @deprecated Use FileEntry instead */
export type FileEntryItem = FileEntry;

// ============================================================================
// EXPLORER STATE
// ============================================================================

/**
 * Explorer component state
 */
export interface ExplorerState {
    /** Current directory entries */
    items: FileEntry[];
    /** Selected item paths */
    selected: Set<string>;
    /** Loading state */
    loading: boolean;
    /** Error message */
    error: string | null;
}

/**
 * Clipboard state for file operations
 */
export interface ClipboardState {
    /** Paths of copied/cut items */
    items: string[];
    /** Whether items should be moved (cut) or copied */
    cut?: boolean;
}

// ============================================================================
// VIEW MODES
// ============================================================================

export type ViewMode = "list" | "grid" | "compact";

// ============================================================================
// EVENTS
// ============================================================================

/**
 * Standard explorer event detail
 */
export interface ExplorerEventDetail {
    /** File path */
    path: string;
    /** File entry item */
    item?: FileEntry;
    /** Original DOM event */
    originalEvent?: Event;
}

/**
 * Selection change event detail
 */
export interface SelectionEventDetail {
    /** Selected items */
    selected: FileEntry[];
    /** Paths of selected items */
    paths: string[];
}

/**
 * Context menu event detail
 */
export interface ContextMenuEventDetail {
    /** Mouse X position */
    x: number;
    /** Mouse Y position */
    y: number;
    /** Item at cursor (if any) */
    item?: FileEntry;
    /** Selected items */
    selected?: FileEntry[];
}

// ============================================================================
// EVENT TYPES (for type-safe dispatch/listen)
// ============================================================================

export type ExplorerEventType =
    | "navigate"        // Navigation to a directory
    | "open"            // File opened
    | "select"          // Selection changed
    | "context-menu"    // Right-click
    | "open-item"       // Item action (before open)
    | "context-action"; // Context menu action

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Explorer configuration options
 */
export interface ExplorerConfig {
    /** Initial path */
    path?: string;
    /** Show hidden files */
    showHidden?: boolean;
    /** View mode */
    viewMode?: ViewMode;
    /** Enable multi-select */
    multiSelect?: boolean;
    /** Enable keyboard navigation */
    keyboardNav?: boolean;
    /** Enable history navigation */
    historyNav?: boolean;
    /** Enable drag and drop */
    dragDrop?: boolean;
    /** Storage backend: 'opfs' | 'fsa' (File System Access) | 'auto' */
    backend?: "opfs" | "fsa" | "auto";
}

// ============================================================================
// MENU ACTIONS
// ============================================================================

export type MenuAction =
    | "open"
    | "view"
    | "download"
    | "delete"
    | "rename"
    | "copy"
    | "copyPath"
    | "movePath"
    | "cut"
    | "paste"
    | "attach-workcenter"
    | "new-folder"
    | "new-file";

// ============================================================================
// CONTEXT MENU CONFIGURATION
// ============================================================================

export interface MenuItemConfig {
    /** Unique action identifier */
    id: MenuAction | string;
    /** Display label */
    label: string;
    /** Icon name */
    icon: string;
    /** Is this action disabled? */
    disabled?: boolean;
    /** Custom handler (overrides default) */
    handler?: (item: FileEntry | null, ev: MouseEvent) => void | Promise<void>;
}

export interface ContextMenuConfig {
    /** File action operations (open, view, download, etc.) */
    fileActions?: MenuItemConfig[];
    /** File system operations (delete, rename, copy, etc.) */
    systemOps?: MenuItemConfig[];
    /** Custom action groups */
    customGroups?: MenuItemConfig[][];
}
