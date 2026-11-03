# MCP setup: Claude in Firefox over Docker + Traefik

Architecture:

```
Claude Desktop/Code --stdio--> docker exec -i ocf-hub node /app/mcp-server.js ---TCP 127.0.0.1:18765---> hub (primary)
                                                                                                             |
LibreWolf/Firefox extension --wss://ocf.localhost/ws (JWT in Sec-WebSocket-Protocol)--> Traefik --> hub :18766
```

- The hub is one container (`ocf-hub`) on the external Docker network `global-proxy`. No host ports are published.
- Claude's MCP entry runs a second `mcp-server.js` inside that container; it detects the running hub and acts as a client of it.
- Browsers authenticate with an ES256 JWT; you approve each browser once in the hub TUI.

## 1. Prerequisites
- Docker with the external network `global-proxy` and a Traefik container on it (entrypoint `websecure`, Docker provider on `global-proxy`,
  file provider watching a `dynamic` directory).
- LibreWolf or Firefox (see step 5 for unsigned add-ons).

## 2. Start the hub
```bash
git clone https://github.com/Aldarien/open-claude-in-firefox claude-in-firefox   # or use your checkout
cd claude-in-firefox
git checkout develop
docker compose up -d --build
```
`docker-compose.yml` (summary): image `ocf-host`, container `ocf-hub`, `stdin_open: true`, `restart: unless-stopped`, network `global-proxy`,
volume `./data:/data`, env `OCF_BIND_HOST=0.0.0.0`, `OCF_JWKS=/data/jwks.json`, `OCF_CONFIG=/data/config.json`, and these Traefik labels:

```yaml
traefik.enable: "true"
traefik.docker.network: global-proxy
traefik.http.routers.ocf-hub.rule: "Host(`ocf.localhost`)"
traefik.http.routers.ocf-hub.entrypoints: websecure
traefik.http.routers.ocf-hub.tls: "true"
traefik.http.services.ocf-hub.loadbalancer.server.port: "18766"
```

## 3. Certificate (once)
```bash
sh certs/generate.sh "D:/Users/Aldarien/Workspace/docks/traefik/config/dynamic"
```
This creates a CA limited to `ocf.localhost` (key stays in `data/ca`, git-ignored) and drops `ocf-hub.crt`, `ocf-hub.key`, `ocf-hub-tls.yml`
into Traefik's dynamic directory (picked up without a restart; only served for SNI `ocf.localhost`). Renew within 730 days by re-running it.

Import `certs/ocf-hub-ca.crt` into each browser: Settings > Privacy & Security > View Certificates > Authorities > Import >
"Trust this CA to identify websites". (An extension cannot install certificates; this is a browser limitation.)

## 4. Claude's MCP entry
Claude Desktop (`%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "claude-in-firefox": {
      "command": "docker",
      "args": ["exec", "-i", "ocf-hub", "node", "/app/mcp-server.js"]
    }
  }
}
```
Claude Code:
```bash
claude mcp add claude-in-firefox -- docker exec -i ocf-hub node /app/mcp-server.js
```
Restart Claude afterwards. The hub container must be running (it restarts automatically with Docker).

## 5. Install the extension
Build (already done: `dist/claude-in-firefox-1.0.0.xpi`):
```bash
docker run --rm -v "$PWD:/src" -w /src node:22-alpine npx --yes web-ext@8 build -s extension -a dist
```
Rename the zip to `.xpi`. Release Firefox only installs signed add-ons. In LibreWolf try `about:config` > `xpinstall.signatures.required` = false,
then open the `.xpi` (about:addons > gear > Install Add-on From File). Otherwise sign it with `web-ext sign` (AMO API keys, unlisted).

## 6. Approve the browser
1. Open the extension options. Set the browser name, check the status pill, and note the fingerprint.
2. Run the hub TUI and approve:
   ```bash
   docker exec -it ocf-hub ocf-tui
   ```
   Open **Pending approvals**, match the fingerprint, press `a 1`, confirm the label. The extension connects on its next retry (a few seconds).
3. Repeat for each browser profile (LibreWolf, Firefox Dev, ...).

Enrollment is intentionally not available through MCP: a tool that Claude (or a prompt injection) can call must not be able to authorize
new browsers. Keys can only be approved by a person in the TUI, or by editing `data/jwks.json`.

## 7. Using it
Tools: `list_connected_browsers`, `select_browser` (needed only when several browsers are connected; selection is per MCP client), then
`tabs_context_mcp`, `tabs_create_mcp`, `navigate`, `computer`, `find`, `form_input`, `get_page_text`, `read_page`, `javascript_tool`,
`read_console_messages`, `read_network_requests`, `resize_window`, `update_plan`, and the rest of the upstream tool set.
Optional domain blocklist: extension options > Blocked domains (all categories off by default).

## 8. Configuration reference
Environment (container; restart needed): `OCF_BIND_HOST` (default `127.0.0.1`; compose sets `0.0.0.0` for the WS bridge only), `OCF_WS_PORT` (18766),
`OCF_JWKS` (`/data/jwks.json`), `OCF_CONFIG` (`/data/config.json`), `OCF_PORT` (TUI's internal port, 18765).
`/data/config.json` (edit in the TUI > Settings, applies live): `tokenMaxAgeSeconds` (60), `requestTimeoutSeconds` (60),
`reconnectGraceSeconds` (5), `allowedOriginPrefixes` (`["moz-extension://"]`), `maxPendingKeys` (20), `pendingTtlHours` (168).
Files in `data/`: `jwks.json` (authorized keys, each with a `label`), `pending.json` (keys awaiting approval), `config.json`, `ca/` (CA key).

## Code map
- `host/mcp-server.js`: MCP server and hub (browser registry, per-client selection, routing, timeouts).
- `host/ws-bridge.js`: wss endpoint, JWT verification (jose), Origin check, pending-key capture.
- `host/keystore.js`: `jwks.json` / `pending.json` management. `host/config.js`: live settings. `host/tui.js`: terminal UI.
- `extension/auth.js`: key pair + JWT. `extension/background.js`: WebSocket connection and tool dispatch + blocklist guard.
- `extension/blocklist.js`, `extension/options.*`: blocklist and settings page.
- `certs/`: CA/leaf generator. `docker-compose.yml`, `host/Dockerfile`: container setup.
