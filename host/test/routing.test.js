// Several browsers connected to one hub: automatic choice, explicit selection per MCP client, disconnects.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PROTOCOL, connectWs, fakeBrowser, makeIdentity, mcpClient, nextMessage, startHub, waitFor } from "./helpers.js";

describe("browser routing", () => {
  let hub, a, b;

  before(async () => {
    a = await makeIdentity("librewolf-main");
    b = await makeIdentity("firefox-dev");
    hub = await startHub([a, b]);
  });
  after(async () => { await hub.stop(); });

  it("reports an error when no browser is connected", async () => {
    const c = mcpClient(hub);
    assert.match(await c.call("tabs_context_mcp"), /^ERROR: Browser extension is not connected/);
    assert.equal(await c.call("list_connected_browsers"), "No browsers connected.");
    c.close();
  });

  it("routes to the only connected browser without a selection", async () => {
    const wa = await fakeBrowser(hub, a);
    const c = mcpClient(hub);
    assert.equal(await c.call("tabs_context_mcp"), "reply from librewolf-main");
    c.close();
    wa.close();
    await waitFor(async () => {
      const c2 = mcpClient(hub);
      const t = await c2.call("list_connected_browsers");
      c2.close();
      return t === "No browsers connected.";
    });
  });

  it("requires a selection when several are connected, and keeps selections per client", async () => {
    const wa = await fakeBrowser(hub, a);
    const wb = await fakeBrowser(hub, b);
    const c1 = mcpClient(hub);
    const c2 = mcpClient(hub);

    assert.match(await c1.call("tabs_context_mcp"), /Multiple browsers are connected/);

    const list = JSON.parse(await c1.call("list_connected_browsers"));
    assert.deepEqual(list.map((x) => x.label).sort(), ["firefox-dev", "librewolf-main"]);

    assert.match(await c1.call("select_browser", { browser: "nope" }), /No connected browser matches/);
    assert.match(await c1.call("select_browser", { browser: "FIREFOX-DEV" }), /Selected browser "firefox-dev"/);
    assert.equal(await c1.call("tabs_context_mcp"), "reply from firefox-dev");

    // the second client has its own (empty) selection, and can pick by key id
    assert.match(await c2.call("tabs_context_mcp"), /Multiple browsers are connected/);
    assert.match(await c2.call("select_browser", { browser: a.kid }), /Selected browser "librewolf-main"/);
    assert.equal(await c2.call("tabs_context_mcp"), "reply from librewolf-main");
    assert.equal(await c1.call("tabs_context_mcp"), "reply from firefox-dev");

    // when the selected browser disconnects, the remaining one is used
    wb.close();
    await waitFor(async () => (await c1.call("list_connected_browsers")).includes("librewolf-main") && !(await c1.call("list_connected_browsers")).includes("firefox-dev"));
    assert.equal(await c1.call("tabs_context_mcp"), "reply from librewolf-main");

    c1.close();
    c2.close();
    wa.close();
  });

  it("rejects a second connection with the same key and keeps the first", async () => {
    const wa = await fakeBrowser(hub, a);
    const second = await connectWs(hub, [PROTOCOL, await a.token()]);
    assert.equal(second.ok, true); // the hub accepts the socket, tells it why, and closes it
    const msg = await nextMessage(second.ws);
    assert.equal(msg.type, "error");
    assert.match(msg.error, /already connected/);
    // the first connection must still be the live one
    const c = mcpClient(hub);
    assert.equal(await c.call("tabs_context_mcp"), "reply from librewolf-main");
    c.close();
    wa.close();
  });
});
