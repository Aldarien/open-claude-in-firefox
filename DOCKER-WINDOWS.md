# Docker / Windows setup (local modifications)

- `docker compose up -d --build` runs the hub (`ocf-hub`) on the `global-proxy` network; no host ports are published. Traefik routes it via a TCP router on `websecure` (SNI `ocf.localhost`, TLS terminated by Traefik).
- `windows/install-native-host.ps1` registers the native host (registry, current user; see note for LibreWolf) and starts the hub. The host bridge runs in Docker via `windows/native-host.bat` (image `ocf-host`, network `global-proxy`).
- Claude Desktop / Code MCP entry: command `docker`, args `["exec","-i","ocf-hub","node","/app/mcp-server.js"]`.
- Extension: build with `docker run --rm -v "$PWD:/src" -w /src node:22-alpine npx --yes web-ext@8 build -s extension -a dist`; rename the zip to `.xpi`.
- Blocklist: extension options page (about:addons > Claude MCP > Preferences). Categories are off by default; custom domains supported.
- Release Firefox only installs signed add-ons. Either sign it (AMO unlisted, `web-ext sign` with API keys), or use Firefox Developer Edition/Nightly/ESR/LibreWolf with `xpinstall.signatures.required=false`.
