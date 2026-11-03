@echo off
REM Native messaging host for Firefox/LibreWolf: runs the bridge in Docker (stdio passthrough)
REM and reaches the hub through the global Traefik proxy (TLS, SNI ocf.localhost).
docker run -i --rm --network global-proxy -e OCF_HOST=traefik -e OCF_PORT=443 -e OCF_TLS_SERVERNAME=ocf.localhost ocf-host node /app/native-host.js
