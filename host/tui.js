#!/usr/bin/env node
// Terminal UI for the hub: status, authorized keys, pending key approvals, settings.
// Run:  docker exec -it ocf-hub node /app/tui.js
// Key enrollment is deliberately only possible here (a human at a terminal), never through MCP tools.

import net from "node:net";
import readline from "node:readline/promises";
import { DEFAULTS, SETTINGS_INFO, configPath, getConfig, saveConfig } from "./config.js";
import { addKey, approvePending, denyPending, jwksPath, listKeys, listPending, removeKey, renameKey } from "./keystore.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
// Line queue so piped (non-interactive) input is not lost between prompts.
const queued = [];
const waiting = [];
let inputClosed = false;
rl.on("line", (l) => (waiting.length ? waiting.shift()(l) : queued.push(l)));
rl.on("close", () => { inputClosed = true; waiting.splice(0).forEach((w) => w(null)); });
const B = (s) => `\x1b[1m${s}\x1b[0m`;
const D = (s) => `\x1b[2m${s}\x1b[0m`;
const G = (s) => `\x1b[32m${s}\x1b[0m`;
const Y = (s) => `\x1b[33m${s}\x1b[0m`;
const ask = async (q) => {
  process.stdout.write(q);
  const l = queued.length ? queued.shift() : inputClosed ? null : await new Promise((r) => waiting.push(r));
  if (l === null) { process.stdout.write("\n"); process.exit(0); }
  return l.trim();
};
const short = (kid) => kid.slice(0, 10) + "…";
const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 129600 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};

// Copies text to the terminal's clipboard via OSC 52 (works in Windows Terminal and most modern terminals).
function copyToClipboard(text) {
  if (process.stdout.isTTY) process.stdout.write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`);
}

// Asks the running hub which browsers are connected (same protocol the MCP clients use).
function connectedBrowsers() {
  return new Promise((resolve) => {
    const s = net.connect(Number(process.env.OCF_PORT || 18765), "127.0.0.1");
    let buf = "";
    const done = (v) => { try { s.destroy(); } catch {} resolve(v); };
    const timer = setTimeout(() => done(null), 3000);
    s.on("error", () => { clearTimeout(timer); done(null); });
    s.write(JSON.stringify({ type: "client_hello" }) + "\n");
    s.write(JSON.stringify({ id: "1", type: "tool_request", tool: "list_connected_browsers", args: {} }) + "\n");
    s.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          const m = JSON.parse(line);
          if (m.id === "1") {
            clearTimeout(timer);
            const t = m.result?.content?.[0]?.text || "";
            try { return done(JSON.parse(t)); } catch { return done([]); }
          }
        } catch {}
      }
    });
  });
}

async function status() {
  const live = await connectedBrowsers();
  console.log(`\n${B("Hub status")}`);
  if (live === null) console.log(`  Hub: ${Y("not reachable on 127.0.0.1:" + (process.env.OCF_PORT || 18765))}`);
  else {
    console.log(`  Hub: ${G("running")}`);
    console.log(`  Browsers connected: ${live.length}`);
    for (const b of live) console.log(`    - ${b.label}  ${D(short(b.id))}`);
  }
  console.log(`  Authorized keys: ${listKeys().length}   Pending approval: ${listPending().length}`);
  console.log(D(`  JWKS: ${jwksPath()}   Config: ${configPath()}`));
  console.log(D(`  WS bridge: :${process.env.OCF_WS_PORT || 18766}   Bind: ${process.env.OCF_BIND_HOST || "127.0.0.1"} (set via environment; restart to change)`));
}

async function keys() {
  for (;;) {
    const live = (await connectedBrowsers()) || [];
    const liveIds = new Set(live.map((b) => b.id));
    const list = listKeys();
    console.log(`\n${B("Authorized keys")}`);
    if (!list.length) console.log("  (none)");
    list.forEach((k, i) => console.log(`  ${i + 1}) ${k.label || "(no label)"}  ${D(short(k.kid))}  ${liveIds.has(k.kid) ? G("connected") : D("offline")}`));
    const a = await ask(`\n[c N] copy public key  [r N] rename  [d N] remove  [a] add by pasting a JWK  [b] back > `);
    const [cmd, n] = a.split(/\s+/);
    const k = list[Number(n) - 1];
    try {
      if (cmd === "b" || cmd === "") return;
      else if (cmd === "a") {
        const raw = await ask("Paste the public JWK (one line JSON): ");
        const label = await ask("Label: ");
        const kid = await addKey(JSON.parse(raw), label);
        console.log(G(`Added ${short(kid)}`));
      } else if (!k) console.log(Y("Pick a key number, e.g. 'c 1'."));
      else if (cmd === "c") {
        const { label, kid, ...pub } = k;
        const text = JSON.stringify({ ...pub, kid, label });
        console.log(text);
        copyToClipboard(text);
        console.log(D("(also sent to your terminal's clipboard if it supports OSC 52)"));
      } else if (cmd === "r") {
        const label = await ask(`New label for ${k.label}: `);
        renameKey(k.kid, label);
        console.log(G("Renamed"));
      } else if (cmd === "d") {
        if ((await ask(`Remove "${k.label}"? That browser will no longer be able to connect. Type yes: `)).toLowerCase() === "yes") {
          removeKey(k.kid);
          console.log(G("Removed (an already-open connection stays until it drops)"));
        }
      }
    } catch (e) {
      console.log(Y("Error: " + e.message));
    }
  }
}

async function pending() {
  for (;;) {
    const list = listPending();
    console.log(`\n${B("Pending keys")} ${D("(unknown browsers that tried to connect; compare the fingerprint with the extension options page)")}`);
    if (!list.length) {
      console.log("  (none)");
      return;
    }
    list.forEach((p, i) => console.log(`  ${i + 1}) ${p.label || "(no label)"}  fingerprint ${B(p.kid)}\n     origin ${p.origin}  seen ${p.count}x, last ${ago(p.lastSeen)}`));
    const a = await ask(`\n[a N] approve  [d N] deny  [b] back > `);
    const [cmd, n] = a.split(/\s+/);
    const p = list[Number(n) - 1];
    try {
      if (cmd === "b" || cmd === "") return;
      if (!p) { console.log(Y("Pick a number, e.g. 'a 1'.")); continue; }
      if (cmd === "a") {
        const label = await ask(`Label [${p.label || p.kid.slice(0, 8)}]: `);
        await approvePending(p.kid, label || p.label);
        console.log(G("Approved. The extension will connect on its next retry."));
      } else if (cmd === "d") {
        denyPending(p.kid);
        console.log(G("Denied (it will reappear if that browser tries again)"));
      }
    } catch (e) {
      console.log(Y("Error: " + e.message));
    }
  }
}

async function settings() {
  for (;;) {
    const cfg = getConfig();
    console.log(`\n${B("Settings")} ${D("(" + configPath() + ")")}`);
    const names = Object.keys(SETTINGS_INFO);
    names.forEach((n, i) => {
      const v = Array.isArray(cfg[n]) ? cfg[n].join(", ") : cfg[n];
      const def = Array.isArray(DEFAULTS[n]) ? DEFAULTS[n].join(", ") : DEFAULTS[n];
      console.log(`  ${i + 1}) ${n} = ${B(v)} ${D("(default " + def + ")")}\n     ${D(SETTINGS_INFO[n].help)}`);
    });
    const a = await ask(`\n[e N] edit  [reset N] reset to default  [b] back > `);
    const [cmd, n] = a.split(/\s+/);
    const name = names[Number(n) - 1];
    try {
      if (cmd === "b" || cmd === "") return;
      if (!name) { console.log(Y("Pick a number, e.g. 'e 1'.")); continue; }
      const info = SETTINGS_INFO[name];
      if (cmd === "reset") {
        saveConfig({ [name]: DEFAULTS[name] });
        console.log(G("Reset"));
      } else if (cmd === "e") {
        const raw = await ask(`${name}${info.type === "list" ? " (comma separated)" : ""}: `);
        let val;
        if (info.type === "number") {
          val = Number(raw);
          if (!Number.isFinite(val) || val < 0) throw new Error("Enter a non-negative number");
        } else val = raw.split(",").map((x) => x.trim()).filter(Boolean);
        saveConfig({ [name]: val });
        console.log(G("Saved" + (info.live ? " (applies immediately)" : " (restart the hub to apply)")));
      }
    } catch (e) {
      console.log(Y("Error: " + e.message));
    }
  }
}

console.log(B("Open Claude in Firefox: hub"));
for (;;) {
  const pend = listPending().length;
  const a = await ask(`\n  1) Status   2) Keys   3) Pending approvals${pend ? Y(` (${pend})`) : ""}   4) Settings   q) Quit > `);
  if (a === "q" || a === "quit" || a === "exit") break;
  if (a === "1") await status();
  else if (a === "2") await keys();
  else if (a === "3") await pending();
  else if (a === "4") await settings();
}
rl.close();
