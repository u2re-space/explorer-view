# File Explorer

CrossWord entry: `src/frontend/views/explorer` (also linked at `src/views/explorer`).

`ExplorerView` (`index.ts`), `cw-view-explorer`, and adopted styles (`scss/index.scss`) wrap the file manager. The implementation lives in **`fest/fl-ui`** (`shared/fest/fl-ui/services/file-manager` registers `ui-file-manager` and loads inline SCSS from `ui/items/explorer`).

Based on OPFS (`/user`) and site resources under `/assets`.
