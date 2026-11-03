<p align="center">
  <img src="extension/icons/icon128.png" width="96" alt="Claude in Firefox">
</p>

<h1 align="center">Claude in Firefox</h1>

<p align="center">
  <em>Browser automation for Claude in your own Firefox or LibreWolf, through a local Docker hub.</em>
</p>

A fork of [beto621/open-claude-in-firefox](https://github.com/beto621/open-claude-in-firefox), itself a Firefox port of
[open-claude-in-chrome](https://github.com/noemica-io/open-claude-in-chrome). It gives Claude (Claude Desktop or Claude Code) the same
browser tools as Claude in Chrome, driving your real browser with your real sign-ins. See [License](#license) for the licensing of this code and its upstreams.

## What's different in this fork

| | Upstream | This fork |
|---|---|---|
| Browser link | Native messaging (registry key / manifest) | WebSocket over `wss`, **no native messaging, no registry changes** |
| Runtime | Node on the host | Docker container (`ocf-hub`) behind your Traefik |
| Auth | Extension ID | ES256 JWT per browser, verified against a JWKS; unknown browsers are approved in a TUI |
| Browsers | One | Several at once (LibreWolf, Firefox Developer Edition, ...), selectable per MCP client |
| Domain blocklist | None | Optional, by category plus custom domains (off by default) |
| Claude Desktop | MCP entry by hand | Installable extension bundle (`.mcpb`) with an on/off toggle, plus a usage skill |

## Architecture

```
Claude Desktop / Code --stdio--> docker exec -i ocf-hub node /app/mcp-server.js --TCP 127.0.0.1:18765--> hub (ocf-hub)
                                                                                                           ^
Firefox / LibreWolf extension --wss://ocf.localhost/ws (JWT in Sec-WebSocket-Protocol)--> Traefik --> :18766 (WS bridge)
```

- **Hub (`host/`)**: the MCP server and the WebSocket bridge, in one container on the external Docker network `global-proxy`. No host ports are published.
  The internal client port (18765) listens on loopback only inside the container.
- **Traefik**: an HTTP router for `ocf.localhost` on `websecure`, using a certificate from a local CA that is name-constrained to `ocf.localhost`
  (`certs/generate.sh` creates it and drops the leaf into Traefik's watched dynamic directory).
- **Extension (`extension/`)**: Manifest V3. It creates a non-extractable ES256 key, signs a short-lived JWT, and connects. It offers its public key to the hub
  so you can approve it in the TUI.
- **TUI (`ocf-tui`)**: run `docker exec -it ocf-hub ocf-tui` to approve browsers, manage keys and edit settings. Enrollment is deliberately not available
  through MCP tools.

## Quick start

1. Start the hub: `docker compose up -d --build` (needs the external network `global-proxy`).
2. Create the certificate: `sh certs/generate.sh <traefik dynamic dir>`, then import `certs/ocf-hub-ca.crt` into the browser
   (Settings > Privacy & Security > View Certificates > Authorities > Import, trust for websites).
3. Install the extension (`claude-in-firefox-<version>-unsigned.xpi` from the release, or build it, see below). Unsigned add-ons need
   `xpinstall.signatures.required=false` in LibreWolf or Firefox Developer Edition; release builds signed through Mozilla install anywhere.
4. Open the extension options, name the browser, then approve it: `docker exec -it ocf-hub ocf-tui` > Pending approvals.
5. Give Claude the server: install the `.mcpb` in Claude Desktop (Settings > Extensions, gives a toggle), or
   `claude mcp add claude-in-firefox -- docker exec -i ocf-hub node /app/mcp-server.js`. Use one of the two, not both.
6. Optionally copy `skill/firefox-browser/SKILL.md` to `~/.claude/skills/firefox-browser/`.

Full steps, configuration reference and a code map are in [MCP-SETUP.md](MCP-SETUP.md).

## Tools

| Tool | Description |
|------|-------------|
| `list_connected_browsers` | Browsers (profiles) connected to the hub |
| `select_browser` | Choose the browser the following tools act on (needed only when several are connected) |
| `tabs_context_mcp` | Tabs in the MCP window |
| `tabs_create_mcp` | New tab in the MCP window |
| `navigate` | Go to a URL, back or forward |
| `computer` | Mouse, keyboard, scrolling and screenshots inside the browser |
| `read_page` | Accessibility tree with element refs |
| `get_page_text` | Article/main text |
| `find` | Find elements by text or purpose |
| `form_input` | Set form values by ref |
| `javascript_tool` | Run JavaScript in the page |
| `read_console_messages` | Console output (filtered) |
| `read_network_requests` | Network activity |
| `resize_window` | Resize the browser window |
| `update_plan` | Present a plan (auto-approved) |
| `upload_image`, `gif_creator`, `shortcuts_list`, `shortcuts_execute`, `switch_browser` | Stubs or unsupported in Firefox WebExtensions |

## Domain blocklist

Extension options > Blocked domains. Categories (banking, investing, payments, buy now pay later, neobanks, crypto, gambling, dating, adult,
news, social) plus your own domains. Everything is off by default. When on, tools refuse to navigate to or act on matching pages.

## Security model

- A browser can connect only with a key listed in `data/jwks.json`. Tokens are ES256 JWTs (120 s lifetime, one-time `jti`, audience and issuer checked)
  sent in the `Sec-WebSocket-Protocol` header, and the WebSocket `Origin` must be an extension origin.
- Unknown browsers are held as pending until a person approves them in the TUI; nothing reachable through MCP can authorize a browser.
- The extension acts with your real sign-ins. Treat it like giving someone your browser: use the blocklist, and approve actions you would not do yourself.

## Firefox notes

- **MCP window instead of tab groups.** Firefox has no tab groups API, so Claude's tabs live in a dedicated window; its ID is remembered across restarts.
- **Synthetic events.** Clicks, typing and scrolling are dispatched as DOM events from a content script (`isTrusted: false`). Most apps work; a few hardened ones
  ignore them.
- **Screenshots** capture the active tab; the extension activates the target tab first.
- **Console monitoring** starts at the first `read_console_messages` call on a tab, so call it early.
- **Reconnect backoff.** Firefox delays WebSocket reconnects after failures (up to about a minute); tokens live long enough to survive it.

## Building and releasing

- Extension: `docker run --rm -v "$PWD:/src" -w /src node:22-alpine npx --yes web-ext@8 build -s extension -a dist`, rename the zip to `.xpi`.
- Claude Desktop bundle: `docker run --rm -v "$PWD:/src" -w /src node:22-alpine npx --yes @anthropic-ai/mcpb pack mcpb dist/claude-in-firefox.mcpb`.
- Releases follow gitflow (`develop`, `release/X.Y.Z` squashed onto `main`, tag `vX.Y.Z`). Pushing a tag runs `.github/workflows/release.yml`, which builds
  `claude-in-firefox-<version>-unsigned.xpi` (or the signed `claude-in-firefox-<version>.xpi` when the `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` secrets exist)
  and `claude-in-firefox-<version>.mcpb`, and attaches them to the GitHub release.

## Updating after code changes

| What changed | What to do |
|---|---|
| `extension/` | Rebuild the XPI and reinstall (or reload it in `about:debugging` for a temporary install) |
| `host/` | `docker compose up -d --build` |
| `certs/` | Re-run `certs/generate.sh` (leaf valid 730 days) |
| `mcpb/` | Repack and reinstall the `.mcpb` |

## Repository layout

`extension/` browser extension, `host/` hub image sources, `certs/` CA and leaf generator, `mcpb/` Claude Desktop bundle, `skill/` usage skill,
`docker-compose.yml`, `MCP-SETUP.md` (setup guide, authentication details and troubleshooting), `LICENSE`.

## License

This repository is released under the [MIT License](LICENSE).

Upstream notes: the Firefox port this fork starts from ([beto621/open-claude-in-firefox](https://github.com/beto621/open-claude-in-firefox)) declares MIT in its README but
ships no license file. That port is based on [noemica-io/open-claude-in-chrome](https://github.com/noemica-io/open-claude-in-chrome), which is published under the
[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0). If you plan commercial use or redistribution, check those upstream terms yourself.

This is an independent project and is not affiliated with Anthropic. "Claude" is a trademark of Anthropic.
