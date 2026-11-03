// WebSocket authentication: JWT in the Sec-WebSocket-Protocol header, Origin check, replay protection and key enrollment.

import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { PROTOCOL, connectWs, makeIdentity, mcpClient, startHub, waitFor } from "./helpers.js";

describe("WebSocket authentication", () => {
  let hub, known, stranger;

  before(async () => {
    known = await makeIdentity("known-browser");
    stranger = await makeIdentity("stranger");
    hub = await startHub([known]);
    // keystore.js / config.js read these at call time
    process.env.OCF_JWKS = hub.jwksPath;
    process.env.OCF_CONFIG = hub.configPath;
  });
  after(async () => { await hub.stop(); });

  it("accepts a valid token for an authorized key and reports its label", async () => {
    const r = await connectWs(hub, [PROTOCOL, await known.token()]);
    assert.equal(r.ok, true);
    const c = mcpClient(hub);
    const list = JSON.parse(await c.call("list_connected_browsers"));
    assert.deepEqual(list.map((b) => b.label), ["known-browser"]);
    c.close();
    r.ws.close();
    await waitFor(async () => {
      const c2 = mcpClient(hub);
      const t = await c2.call("list_connected_browsers");
      c2.close();
      return t === "No browsers connected.";
    });
  });

  it("refuses a missing token", async () => {
    const r = await connectWs(hub, [PROTOCOL]);
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
  });

  it("refuses an Origin that is not an extension origin", async () => {
    const r = await connectWs(hub, [PROTOCOL, await known.token()], "https://evil.example");
    assert.equal(r.status, 403);
  });

  it("refuses a request with no Origin", async () => {
    const r = await connectWs(hub, [PROTOCOL, await known.token()], null);
    assert.equal(r.status, 403);
  });

  it("refuses an expired token", async () => {
    const r = await connectWs(hub, [PROTOCOL, await known.token({ claims: { iat: 1, exp: 2 } })]);
    assert.equal(r.status, 401);
    assert.match(hub.logs(), /ERR_JWT_EXPIRED/);
  });

  it("refuses the wrong audience", async () => {
    const r = await connectWs(hub, [PROTOCOL, await known.token({ claims: { aud: "someone-else" } })]);
    assert.equal(r.status, 401);
  });

  it("refuses a token signed by another key that claims a known kid", async () => {
    const r = await connectWs(hub, [PROTOCOL, await stranger.token({ kid: known.kid })]);
    assert.equal(r.status, 401);
  });

  it("refuses a replayed token", async () => {
    const t = await known.token();
    const first = await connectWs(hub, [PROTOCOL, t]);
    assert.equal(first.ok, true);
    first.ws.close();
    const second = await connectWs(hub, [PROTOCOL, t]);
    assert.equal(second.status, 401);
    assert.match(hub.logs(), /token replayed/);
  });

  it("refuses an unknown key that does not offer a public key, and records nothing", async () => {
    const r = await connectWs(hub, [PROTOCOL, await stranger.token()]);
    assert.equal(r.status, 401);
    assert.equal(fs.existsSync(hub.pendingPath), false);
  });

  it("queues an unknown key that proves possession of its private key, then accepts it once approved", async () => {
    const { listPending, approvePending } = await import("../keystore.js");
    const withJwk = { header: { jwk: stranger.pub, label: "my laptop" } };

    const refused = await connectWs(hub, [PROTOCOL, await stranger.token(withJwk)]);
    assert.equal(refused.status, 401);
    assert.equal(refused.message, "Pending approval");

    const pending = listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].kid, stranger.kid);
    assert.equal(pending[0].label, "my laptop");

    assert.equal(await approvePending(stranger.kid, "approved-laptop"), true);
    assert.equal(listPending().length, 0);

    const accepted = await connectWs(hub, [PROTOCOL, await stranger.token(withJwk)]);
    assert.equal(accepted.ok, true);
    accepted.ws.close();
  });

  it("does not queue a key whose kid is not the thumbprint of the key it offers", async () => {
    const other = await makeIdentity("other");
    const liar = { header: { jwk: other.pub } }; // signed with `stranger2`'s key below, kid says otherwise
    const stranger2 = await makeIdentity("stranger2");
    const { listPending } = await import("../keystore.js");
    const before = listPending().length;
    const r = await connectWs(hub, [PROTOCOL, await stranger2.token(liar)]);
    assert.equal(r.status, 401);
    assert.equal(listPending().length, before);
  });
});
