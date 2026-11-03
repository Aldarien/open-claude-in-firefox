# Docker / Traefik setup (local modifications)

No native messaging and no registry changes: the extension connects to the hub over a WebSocket.

- `docker compose up -d --build` runs the hub (`ocf-hub`) on the external `global-proxy` network; no host ports are published.
  Traefik routes `https://ocf.localhost` (HTTP router on `websecure`) to the hub's WebSocket bridge (port 18766).
- TLS: a local CA constrained to `ocf.localhost` (name constraints, so it cannot vouch for any other site) and a leaf certificate.
  Generate/renew with `certs/generate.sh <traefik dynamic dir>`: it writes `ocf-hub.crt`, `ocf-hub.key` and `ocf-hub-tls.yml` into Traefik's
  watched dynamic directory (no restart; it is only served for SNI `ocf.localhost`, other hosts keep their own certificates) and keeps the CA key in
  `data/ca` (git-ignored). Import `certs/ocf-hub-ca.crt` once in each browser (Settings > Privacy & Security > View Certificates > Authorities > Import,
  "Trust this CA to identify websites"). The leaf is valid 730 days; rerun the script to renew.
- Note: Firefox delays WebSocket reconnects to a host after failures (`network.websocket.delay-failed-reconnects`, up to ~60 s), so tokens live 120 s; replay is still blocked by the one-time `jti`.
- Auth: the extension generates an ES256 key pair (private key non-extractable, in IndexedDB). Copy its public JWK from the options
  page into `data/jwks.json` (`{"keys":[ ... ]}`; re-read on every connection, no restart needed). It then connects with
  `new WebSocket(url, ["ocf.v1", <JWT>])`; the hub verifies the JWT (ES256, `iss`/`aud`, 120 s `exp`, one-time `jti`) from the
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
