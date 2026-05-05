import { defineViewProject } from "./vite.view.config.js";

/**
 * TLS: place `certs/cert.pem` + `certs/key.pem` (or set VITE_SSL_CERT / VITE_SSL_KEY).
 * If missing, dev falls back to @vitejs/plugin-basic-ssl. Port 443 may need CAP_NET_BIND_SERVICE or dev:8443.
 */
export default defineViewProject({
    name: "explorer-view",
    root: import.meta.dirname,
    defaultDevPort: 443,
    sslDir: "certs"
});
