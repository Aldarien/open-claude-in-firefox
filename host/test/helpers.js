// Test helpers: start a real hub process on free ports, play the browser extension (sign JWTs the same way
// extension/auth.js does) and play an MCP client over the hub's internal TCP protocol.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

export const hostDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PROTOCOL = "ocf.v1";

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const b64url = (b) => Buffer.from(b).toString("base64url");
const json64 = (o) => b64url(JSON.stringify(o));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, { timeout = 5000, step = 50 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("waitFor timed out");
    await sleep(step);
  }
}

// An extension identity: ES256 key pair, its JWKS entry and a token factory (mirrors extension/auth.js).
export async function makeIdentity(label) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const j = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const pub = { kty: j.kty, crv: j.crv, x: j.x, y: j.y };
  const kid = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ crv: pub.crv, kty: pub.kty, x: pub.x, y: pub.y }))));

  async function token({ kid: kidOverride, header = {}, claims = {} } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const h = json64({ alg: "ES256", typ: "JWT", kid: kidOverride ?? kid, ...header });
    const b = json64({ iss: "ocf-extension", aud: "ocf-hub", iat: now, exp: now + 60, jti: crypto.randomUUID(), ...claims });
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(`${h}.${b}`));
    return `${h}.${b}.${b64url(sig)}`;
  }
  return { label, kid, pub, entry: { ...pub, kid, alg: "ES256", use: "sig", label }, token };
}

// Starts mcp-server.js as the primary hub with its own temp home, JWKS, config and ports.
export async function startHub(identities = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ocf-test-"));
  const tcpPort = await freePort();
  const wsPort = await freePort();
  fs.mkdirSync(path.join(dir, ".config", "open-claude-in-firefox"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".config", "open-claude-in-firefox", "config.json"), JSON.stringify({ port: tcpPort }));
  const jwksPath = path.join(dir, "jwks.json");
  const configPath = path.join(dir, "config.json");
  fs.writeFileSync(jwksPath, JSON.stringify({ keys: identities.map((i) => i.entry) }));

  const env = {
    ...process.env,
    HOME: dir,
    USERPROFILE: dir,
    OCF_WS_PORT: String(wsPort),
    OCF_JWKS: jwksPath,
    OCF_CONFIG: configPath,
    OCF_BIND_HOST: "127.0.0.1",
  };
  const child = spawn(process.execPath, [path.join(hostDir, "mcp-server.js")], { cwd: hostDir, env, stdio: ["pipe", "pipe", "pipe"] });
  let log = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("hub did not start:\n" + log)), 20000);
    child.stderr.on("data", (d) => {
      log += d;
      if (log.includes("WS bridge listening")) { clearTimeout(timer); resolve(); }
    });
    child.on("exit", (code) => reject(new Error(`hub exited (${code}):\n${log}`)));
  });

  return {
    dir, tcpPort, wsPort, jwksPath, configPath,
    pendingPath: path.join(dir, "pending.json"),
    logs: () => log,
    setJwks(ids) { fs.writeFileSync(jwksPath, JSON.stringify({ keys: ids.map((i) => i.entry) })); },
    async stop() {
      child.stdin.end();
      child.kill();
      await sleep(100);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Opens a WebSocket to the hub. Resolves { ok, ws } or { ok: false, status, message }.
export function connectWs(hub, protocols, origin = "moz-extension://test") {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${hub.wsPort}/ws`, protocols, { headers: origin ? { Origin: origin } : {} });
    // Capture messages from the very start: the hub can send one in the same packet as the handshake response.
    ws.queued = [];
    ws.waiting = [];
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      const w = ws.waiting.shift();
      if (w) w(m); else ws.queued.push(m);
    });
    ws.once("open", () => resolve({ ok: true, ws }));
    ws.once("unexpected-response", (_req, res) => { resolve({ ok: false, status: res.statusCode, message: res.statusMessage }); res.resume(); });
    ws.once("error", (e) => resolve({ ok: false, error: e.message }));
  });
}

// Next JSON message received on a socket from connectWs (queued ones first); rejects instead of hanging.
export function nextMessage(ws, timeout = 5000) {
  if (ws.queued.length) return Promise.resolve(ws.queued.shift());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no message received")), timeout);
    ws.waiting.push((m) => { clearTimeout(timer); resolve(m); });
  });
}

// A fake browser: connects with a valid token and answers every tool request with "reply from <label>".
export async function fakeBrowser(hub, identity, tokenOpts) {
  const r = await connectWs(hub, [PROTOCOL, await identity.token(tokenOpts)]);
  if (!r.ok) throw new Error(`fake browser ${identity.label} refused: ${JSON.stringify(r)}`);
  r.ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === "tool_request") {
      r.ws.send(JSON.stringify({ id: m.id, type: "tool_response", result: { content: [{ type: "text", text: `reply from ${identity.label}` }] } }));
    }
  });
  return r.ws;
}

// An MCP client talking the hub's internal protocol (what `docker exec ... mcp-server.js` clients use).
export function mcpClient(hub) {
  const socket = net.connect(hub.tcpPort, "127.0.0.1");
  socket.write(JSON.stringify({ type: "client_hello" }) + "\n");
  let buf = "";
  let n = 0;
  const waiters = new Map();
  socket.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const m = JSON.parse(line);
        if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
      } catch {}
    }
  });
  socket.on("error", () => {});
  return {
    // Resolves to the tool's text, or "ERROR: <message>".
    call(tool, args = {}) {
      return new Promise((resolve, reject) => {
        const id = String(++n);
        const timer = setTimeout(() => reject(new Error(`no reply to ${tool} within 10 s`)), 10000);
        waiters.set(id, (m) => { clearTimeout(timer); resolve(m.type === "tool_error" ? `ERROR: ${m.error}` : m.result.content[0].text); });
        socket.write(JSON.stringify({ id, type: "tool_request", tool, args }) + "\n");
      });
    },
    close() { socket.destroy(); },
  };
}
