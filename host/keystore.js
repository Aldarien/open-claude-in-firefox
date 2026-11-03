// Authorized extension keys (jwks.json) and keys waiting for approval (pending.json).
// Enrollment is a human action (the TUI); nothing reachable through MCP can add or approve keys.

import fs from "node:fs";
import path from "node:path";
import { calculateJwkThumbprint } from "jose";
import { getConfig } from "./config.js";

export const jwksPath = () => process.env.OCF_JWKS || "/data/jwks.json";
const pendingPath = () => path.join(path.dirname(jwksPath()), "pending.json");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fallback; }
}

function writeJson(p, value) {
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, p);
}

// Only the public EC P-256 members are ever stored.
export function sanitizeJwk(jwk) {
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string") return null;
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

export function cleanLabel(label, fallback) {
  const s = String(label ?? "").replace(/[^\w .\-()]/g, "").trim().slice(0, 40);
  return s || fallback;
}

export function listKeys() {
  return readJson(jwksPath(), { keys: [] }).keys || [];
}

export async function addKey(jwk, label) {
  const pub = sanitizeJwk(jwk);
  if (!pub) throw new Error("Not a valid EC P-256 public JWK");
  const kid = await calculateJwkThumbprint(pub);
  const doc = readJson(jwksPath(), { keys: [] });
  doc.keys = (doc.keys || []).filter((k) => k.kid !== kid);
  doc.keys.push({ ...pub, kid, alg: "ES256", use: "sig", label: cleanLabel(label, kid.slice(0, 8)) });
  writeJson(jwksPath(), doc);
  return kid;
}

export function removeKey(kid) {
  const doc = readJson(jwksPath(), { keys: [] });
  const before = (doc.keys || []).length;
  doc.keys = (doc.keys || []).filter((k) => k.kid !== kid);
  writeJson(jwksPath(), doc);
  return doc.keys.length !== before;
}

export function renameKey(kid, label) {
  const doc = readJson(jwksPath(), { keys: [] });
  const k = (doc.keys || []).find((x) => x.kid === kid);
  if (!k) return false;
  k.label = cleanLabel(label, kid.slice(0, 8));
  writeJson(jwksPath(), doc);
  return true;
}

// --- Pending (unknown keys that proved possession of their private key and wait for a human) ---

export function listPending() {
  const ttl = getConfig().pendingTtlHours * 3600 * 1000;
  const now = Date.now();
  const all = readJson(pendingPath(), []);
  const fresh = all.filter((p) => now - p.lastSeen < ttl);
  if (fresh.length !== all.length) writeJson(pendingPath(), fresh);
  return fresh;
}

export function addPending({ kid, jwk, label, origin }) {
  const list = listPending();
  const now = Date.now();
  const existing = list.find((p) => p.kid === kid);
  if (existing) {
    existing.lastSeen = now;
    existing.count = (existing.count || 1) + 1;
  } else {
    if (list.length >= getConfig().maxPendingKeys) return false;
    list.push({ kid, jwk, label: cleanLabel(label, ""), origin: String(origin || "").slice(0, 120), firstSeen: now, lastSeen: now, count: 1 });
  }
  writeJson(pendingPath(), list);
  return true;
}

export function denyPending(kid) {
  const list = listPending();
  const next = list.filter((p) => p.kid !== kid);
  writeJson(pendingPath(), next);
  return next.length !== list.length;
}

export async function approvePending(kid, label) {
  const p = listPending().find((x) => x.kid === kid);
  if (!p) return false;
  await addKey(p.jwk, label || p.label);
  denyPending(kid);
  return true;
}
