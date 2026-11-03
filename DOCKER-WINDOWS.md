# Docker / Traefik setup (local modifications)

No native messaging and no registry changes: the extension connects to the hub over a WebSocket.

- `docker compose up -d --build` runs the hub (`ocf-hub`) on the external `global-proxy` network; no host ports are published.
  Traefik routes `https://ocf.localhost` (HTTP router on `websecure`) to the hub's WebSocket bridge (port 18766).
- TLS: Traefik's own generated self-signed certificate. Firefox/LibreWolf cannot be told to trust a certificate by an extension,
  so open the extension options and use "Trust the hub certificate" once (accept the warning). Traefik regenerates that
  certificate when it restarts, so you may need to accept it again; a persistent certificate in Traefik's dynamic config avoids that.
- Auth: the extension generates an ES256 key pair (private key non-extractable, in IndexedDB). Copy its public JWK from the options
  page into `data/jwks.json` (`{"keys":[ ... ]}`; re-read on every connection, no restart needed). It then connects with
  `new WebSocket(url, ["ocf.v1", <JWT>])`; the hub verifies the JWT (ES256, `iss`/`aud`, 30 s `exp`, one-time `jti`) from the
  `Sec-WebSocket-Protocol` header before the upgrade, and requires a `moz-extension://` Origin.
- Claude Desktop / Code MCP entry: command `docker`, args `["exec","-i","ocf-hub","node","/app/mcp-server.js"]`.
- Extension build: `docker run --rm -v "$PWD:/src" -w /src node:22-alpine npx --yes web-ext@8 build -s extension -a dist`; rename the zip to `.xpi`.
- Blocklist: extension options page. Categories are off by default; custom domains supported.
- Release Firefox only installs signed add-ons. LibreWolf: try `xpinstall.signatures.required=false`, or sign via AMO unlisted (`web-ext sign`).

## Multiple browsers
Each browser profile has its own key; add one entry per profile to `data/jwks.json` and give it a `label`
(`{"kty":"EC","crv":"P-256","x":"…","y":"…","kid":"…","alg":"ES256","use":"sig","label":"librewolf-main"}`).
With one browser connected it is used automatically; with several, call `list_connected_browsers` then `select_browser`
(selection is per MCP client). The hub is still a single MCP hub: tab IDs are per browser.
