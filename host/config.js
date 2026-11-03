// Hub settings. Read from a JSON file (default /data/config.json) and re-read when it changes,
// so most settings apply without restarting the hub. Missing keys fall back to DEFAULTS.

import fs from "node:fs";

export const DEFAULTS = {
  tokenMaxAgeSeconds: 120,
  requestTimeoutSeconds: 60,
  reconnectGraceSeconds: 5,
  allowedOriginPrefixes: ["moz-extension://"],
  maxPendingKeys: 20,
  pendingTtlHours: 168,
};

// Describes each setting for the TUI. `live: false` means a hub restart is needed.
export const SETTINGS_INFO = {
  tokenMaxAgeSeconds: { type: "number", live: true, help: "Maximum age of the extension's JWT when it connects." },
  requestTimeoutSeconds: { type: "number", live: true, help: "How long a tool call waits for the browser before failing." },
  reconnectGraceSeconds: { type: "number", live: true, help: "How long in-flight calls wait for a browser to reconnect after a drop." },
  allowedOriginPrefixes: { type: "list", live: true, help: "WebSocket Origin must start with one of these (comma separated)." },
  maxPendingKeys: { type: "number", live: true, help: "Maximum unknown keys held for approval." },
  pendingTtlHours: { type: "number", live: true, help: "Pending keys older than this are dropped." },
};

export const configPath = () => process.env.OCF_CONFIG || "/data/config.json";

let cache = { mtime: 0, value: { ...DEFAULTS } };

export function getConfig() {
  try {
    const st = fs.statSync(configPath());
    if (st.mtimeMs !== cache.mtime) {
      const raw = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
      cache = { mtime: st.mtimeMs, value: { ...DEFAULTS, ...raw } };
    }
  } catch {
    // no file or unreadable: keep defaults
    if (cache.mtime !== 0) cache = { mtime: 0, value: { ...DEFAULTS } };
  }
  return cache.value;
}

export function saveConfig(patch) {
  let current = {};
  try { current = JSON.parse(fs.readFileSync(configPath(), "utf-8")); } catch {}
  const next = { ...current, ...patch };
  const tmp = configPath() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, configPath());
}
