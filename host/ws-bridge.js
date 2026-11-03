// WebSocket bridge: lets the browser extension connect to the hub over wss (TLS terminated by Traefik).
// The extension authenticates with an ES256 JWT sent in the Sec-WebSocket-Protocol header
// (subprotocols: "ocf.v1", "<jwt>"), verified against a local JWKS file before the upgrade completes.
// The Origin must also be a moz-extension:// origin.

import http from "node:http";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { WebSocketServer } from "ws";
import { createLocalJWKSet, jwtVerify } from "jose";

const PROTOCOL = "ocf.v1";
const seenJti = new Map(); // jti -> expiry ms

function rememberJti(jti, expMs) {
  const now = Date.now();
  for (const [k, v] of seenJti) if (v < now) seenJti.delete(k);
  if (seenJti.has(jti)) return false;
  seenJti.set(jti, expMs);
  return true;
}

async function verifyToken(token, { jwksPath, audience, issuer }) {
  const jwks = JSON.parse(fs.readFileSync(jwksPath, "utf-8"));
  const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
    algorithms: ["ES256"],
    audience,
    issuer,
    maxTokenAge: "60s",
    requiredClaims: ["exp", "iat", "jti"],
  });
  if (!rememberJti(payload.jti, payload.exp * 1000 + 60000)) throw new Error("token replayed");
  return payload;
}

// Makes a WebSocket look like the TCP socket the hub already uses for the browser connection
// (newline-delimited JSON in, newline-delimited JSON out).
class WsSocketAdapter extends EventEmitter {
  constructor(ws) {
    super();
    this.ws = ws;
    ws.on("message", (data) => this.emit("data", Buffer.from(data.toString("utf-8") + "\n")));
    ws.on("error", (e) => this.emit("error", e));
    ws.on("close", () => this.emit("close"));
  }
  get destroyed() { return this.ws.readyState !== 1; }
  write(s) { if (!this.destroyed) this.ws.send(String(s).trim()); }
  end(s) { if (s && !this.destroyed) this.ws.send(String(s).trim()); this.ws.close(); }
  destroy() { this.ws.terminate(); }
}

export function startWsBridge({ port, host, jwksPath, audience, issuer, onBrowser, log }) {
  const server = http.createServer((req, res) => {
    // Plain page: visiting https://ocf.localhost/ is how the browser is told to trust Traefik's certificate.
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("Open Claude in Firefox hub is running. You can close this tab.\n");
  });

  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has(PROTOCOL) ? PROTOCOL : false),
  });

  server.on("upgrade", async (req, socket, head) => {
    const reject = (code, why) => {
      log(`WS rejected: ${why}`);
      socket.write(`HTTP/1.1 ${code} ${why}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    try {
      if (new URL(req.url, "http://x").pathname !== "/ws") return reject(404, "Not Found");
      if (!String(req.headers.origin || "").startsWith("moz-extension://")) return reject(403, "Bad Origin");
      const protocols = String(req.headers["sec-websocket-protocol"] || "").split(",").map((s) => s.trim());
      const token = protocols.find((p) => p && p !== PROTOCOL);
      if (!protocols.includes(PROTOCOL) || !token) return reject(401, "Missing token");
      await verifyToken(token, { jwksPath, audience, issuer });
    } catch (e) {
      return reject(401, "Unauthorized");
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on("pong", () => (ws.isAlive = true));
      onBrowser(new WsSocketAdapter(ws));
    });
  });

  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 20000).unref();

  server.listen(port, host, () => log(`WS bridge listening on :${port}`));
  return server;
}
