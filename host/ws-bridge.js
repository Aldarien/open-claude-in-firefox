// WebSocket bridge: lets the browser extension connect to the hub over wss (TLS terminated by Traefik).
// The extension authenticates with an ES256 JWT sent in the Sec-WebSocket-Protocol header
// (subprotocols: "ocf.v1", "<jwt>"), verified against a local JWKS file before the upgrade completes.
// The Origin must also match the configured prefixes (moz-extension:// by default).
// Unknown keys that prove possession of their private key are queued for approval in the TUI.

import http from "node:http";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { WebSocketServer } from "ws";
import { calculateJwkThumbprint, createLocalJWKSet, decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { getConfig } from "./config.js";
import { addPending, sanitizeJwk } from "./keystore.js";

const PROTOCOL = "ocf.v1";
const seenJti = new Map(); // jti -> expiry ms

function rememberJti(jti, expMs) {
  const now = Date.now();
  for (const [k, v] of seenJti) if (v < now) seenJti.delete(k);
  if (seenJti.has(jti)) return false;
  seenJti.set(jti, expMs);
  return true;
}

async function verifyToken(token, { jwksPath, audience, issuer, origin }) {
  const jwks = JSON.parse(fs.readFileSync(jwksPath, "utf-8"));
  const header = decodeProtectedHeader(token);
  const { kid } = header;
  const verifyOpts = {
    algorithms: ["ES256"],
    audience,
    issuer,
    maxTokenAge: `${getConfig().tokenMaxAgeSeconds}s`,
    requiredClaims: ["exp", "iat", "jti"],
  };
  const entry = (jwks.keys || []).find((k) => k.kid === kid);
  if (!entry) {
    // Unknown key. If it carries its own public key (kid must be that key's thumbprint) and the token is
    // signed with it, remember it as pending so a human can approve it in the TUI. The connection is still refused.
    const pub = sanitizeJwk(header.jwk);
    if (pub && typeof kid === "string" && (await calculateJwkThumbprint(pub)) === kid) {
      await jwtVerify(token, await importJWK({ ...pub, alg: "ES256" }, "ES256"), verifyOpts);
      addPending({ kid, jwk: pub, label: header.label, origin });
      throw new Error("pending approval");
    }
    throw new Error("unknown key");
  }
  const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), verifyOpts);
  if (!rememberJti(payload.jti, payload.exp * 1000 + 60000)) throw new Error("token replayed");
  return { kid, label: entry.label || kid.slice(0, 8) };
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
    let info;
    let rawToken;
    const reject = (code, why, detail) => {
      log(`WS rejected: ${why}${detail ? ` (${detail})` : ""}`);
      socket.write(`HTTP/1.1 ${code} ${why}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    try {
      if (new URL(req.url, "http://x").pathname !== "/ws") return reject(404, "Not Found");
      const origin = String(req.headers.origin || "");
      if (!getConfig().allowedOriginPrefixes.some((p) => origin.startsWith(p))) return reject(403, "Bad Origin");
      const protocols = String(req.headers["sec-websocket-protocol"] || "").split(",").map((s) => s.trim());
      const token = (rawToken = protocols.find((p) => p && p !== PROTOCOL));
      if (!protocols.includes(PROTOCOL) || !token) return reject(401, "Missing token");
      info = await verifyToken(token, { jwksPath, audience, issuer, origin });
      info.origin = origin;
    } catch (e) {
      let detail = e.code || e.message;
      if (e.code === "ERR_JWT_EXPIRED" || e.code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
        try { const p = decodeJwt(rawToken); detail += ` iat=${p.iat} exp=${p.exp} now=${Math.floor(Date.now() / 1000)}`; } catch {}
      }
      detail += ` from=${req.headers["x-forwarded-for"] || req.socket.remoteAddress} origin=${req.headers.origin || "-"}`;
      return reject(401, e.message === "pending approval" ? "Pending approval" : "Unauthorized", detail);
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on("pong", () => (ws.isAlive = true));
      onBrowser(new WsSocketAdapter(ws), info);
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
