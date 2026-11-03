// Pure logic: domain blocklist (extension/blocklist.js), key store and live settings (host/keystore.js, host/config.js).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { makeIdentity } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("domain blocklist (extension/blocklist.js)", () => {
  // blocklist.js is a classic script (not a module); evaluate it in a sandbox, as the extension would load it.
  const src = fs.readFileSync(path.join(here, "..", "..", "extension", "blocklist.js"), "utf8");
  const ctx = vm.createContext({ chrome: {}, URL, console });
  vm.runInContext(`${src}\nthis.matchBlocked = matchBlocked; this.normalizeDomain = normalizeDomain; this.CATS = BLOCKLIST_CATEGORIES;`, ctx);
  const { matchBlocked, normalizeDomain, CATS } = ctx;
  const on = (...cats) => ({ enabledCategories: cats, customDomains: [] });

  it("has the documented categories", () => {
    assert.deepEqual(Object.keys(CATS).sort(),
      ["adult", "banking", "bnpl", "crypto", "dating", "gambling", "investing", "neobanks", "news", "payments", "social"]);
  });

  it("blocks nothing by default", () => {
    assert.equal(matchBlocked("https://www.chase.com/x", { enabledCategories: [], customDomains: [] }), null);
  });

  it("matches a domain, its subdomains and URLs without a scheme", () => {
    assert.equal(matchBlocked("https://www.chase.com/login", on("banking")), "Banking");
    assert.equal(matchBlocked("secure.chase.com", on("banking")), "Banking");
    assert.equal(matchBlocked("https://chase.com", on("banking")), "Banking");
  });

  it("does not match lookalikes or other categories", () => {
    assert.equal(matchBlocked("https://notchase.com", on("banking")), null);
    assert.equal(matchBlocked("https://chase.com.evil.example", on("banking")), null);
    assert.equal(matchBlocked("https://reddit.com", on("banking")), null);
    assert.equal(matchBlocked("https://old.reddit.com", on("social")), "Social media");
  });

  it("supports custom domains with normalization", () => {
    const s = { enabledCategories: [], customDomains: ["https://Example.ORG/path", "*.intranet.local", "www.foo.com"] };
    assert.equal(matchBlocked("https://sub.example.org", s), "custom blocklist");
    assert.equal(matchBlocked("https://a.intranet.local", s), "custom blocklist");
    assert.equal(matchBlocked("https://foo.com", s), "custom blocklist");
    assert.equal(matchBlocked("https://example.com", s), null);
    assert.equal(normalizeDomain("  HTTPS://www.Example.org:8443/x?y#z "), "example.org");
  });

  it("returns null for unparsable input", () => {
    assert.equal(matchBlocked("http://", on("banking")), null);
  });
});

describe("key store and settings", () => {
  let dir, keystore, config;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ocf-logic-"));
    process.env.OCF_JWKS = path.join(dir, "jwks.json");
    process.env.OCF_CONFIG = path.join(dir, "config.json");
    keystore = await import("../keystore.js");
    config = await import("../config.js");
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("adds, renames and removes authorized keys; entries hold only public members", async () => {
    const id = await makeIdentity("x");
    const kid = await keystore.addKey({ ...id.pub, d: "SECRET-MUST-NOT-BE-STORED" }, "My Browser!");
    assert.equal(kid, id.kid);
    const [entry] = keystore.listKeys();
    assert.equal(entry.label, "My Browser"); // "!" is stripped
    assert.equal(entry.d, undefined);
    assert.equal(keystore.renameKey(kid, "renamed"), true);
    assert.equal(keystore.listKeys()[0].label, "renamed");
    assert.equal(keystore.removeKey(kid), true);
    assert.deepEqual(keystore.listKeys(), []);
  });

  it("rejects keys that are not EC P-256 public keys", async () => {
    await assert.rejects(keystore.addKey({ kty: "RSA", n: "x", e: "AQAB" }, "bad"), /valid EC P-256/);
    assert.equal(keystore.sanitizeJwk(null), null);
  });

  it("limits and expires pending keys, and counts repeat attempts", async () => {
    config.saveConfig({ maxPendingKeys: 2, pendingTtlHours: 1 });
    const [k1, k2, k3] = await Promise.all([makeIdentity("1"), makeIdentity("2"), makeIdentity("3")]);
    assert.equal(keystore.addPending({ kid: k1.kid, jwk: k1.pub, label: "one", origin: "moz-extension://1" }), true);
    assert.equal(keystore.addPending({ kid: k1.kid, jwk: k1.pub, label: "one", origin: "moz-extension://1" }), true);
    assert.equal(keystore.listPending()[0].count, 2);
    assert.equal(keystore.addPending({ kid: k2.kid, jwk: k2.pub, label: "two", origin: "" }), true);
    assert.equal(keystore.addPending({ kid: k3.kid, jwk: k3.pub, label: "three", origin: "" }), false); // cap reached

    // age one entry past the TTL
    const p = path.join(dir, "pending.json");
    const list = JSON.parse(fs.readFileSync(p, "utf8"));
    list[0].lastSeen = Date.now() - 2 * 3600 * 1000;
    fs.writeFileSync(p, JSON.stringify(list));
    assert.deepEqual(keystore.listPending().map((x) => x.kid), [k2.kid]);

    assert.equal(keystore.denyPending(k2.kid), true);
    assert.deepEqual(keystore.listPending(), []);
  });

  it("serves defaults, then live-reloads the settings file", async () => {
    assert.equal(config.getConfig().tokenMaxAgeSeconds, config.DEFAULTS.tokenMaxAgeSeconds);
    assert.equal(config.DEFAULTS.tokenMaxAgeSeconds, 120);
    config.saveConfig({ requestTimeoutSeconds: 7 });
    // make sure the mtime differs on coarse file systems
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(process.env.OCF_CONFIG, t, t);
    assert.equal(config.getConfig().requestTimeoutSeconds, 7);
    assert.equal(config.getConfig().tokenMaxAgeSeconds, 120); // untouched keys keep defaults
  });
});
