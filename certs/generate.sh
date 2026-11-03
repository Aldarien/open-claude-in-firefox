#!/bin/sh
# Usage: certs/generate.sh /path/to/traefik/config/dynamic
# Generates the CA (once, key in data/ca) and a leaf certificate, and drops the leaf + a Traefik TLS file
# into the given Traefik dynamic config directory (Traefik's file provider picks it up without a restart).
set -e
DYN="$1"; [ -d "$DYN" ] || { echo "usage: $0 <traefik dynamic dir>"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/.."
mkdir -p "$ROOT/data/ca"
MSYS_NO_PATHCONV=1 docker run --rm -v "$HERE/gen.sh:/gen.sh:ro" -v "$ROOT/data/ca:/ca" -v "$HERE:/out" -v "$DYN:/traefik" alpine sh /gen.sh
