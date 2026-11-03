#!/bin/sh
# Runs inside an alpine container (see generate.sh). Creates (or reuses) a local CA constrained to
# ocf.localhost and issues a leaf certificate for it.
set -e
apk add --no-cache openssl >/dev/null
CA_DIR=/ca        # private: CA key lives here (kept out of git)
OUT=/out          # public CA certificate (committed)
TRAEFIK=/traefik  # Traefik dynamic config dir (leaf cert + key + tls file)

if [ ! -f "$CA_DIR/ca.key" ]; then
  openssl ecparam -name prime256v1 -genkey -noout -out "$CA_DIR/ca.key"
  cat > /tmp/ca.cnf <<CNF
[req]
distinguished_name=dn
x509_extensions=v3
prompt=no
[dn]
CN=Open Claude in Firefox local CA
[v3]
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
nameConstraints=critical,permitted;DNS:ocf.localhost
CNF
  openssl req -x509 -new -key "$CA_DIR/ca.key" -sha256 -days 3650 -config /tmp/ca.cnf -out "$OUT/ocf-hub-ca.crt"
fi

openssl ecparam -name prime256v1 -genkey -noout -out "$TRAEFIK/ocf-hub.key"
cat > /tmp/leaf.cnf <<CNF
[req]
distinguished_name=dn
prompt=no
[dn]
CN=ocf.localhost
[v3]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=DNS:ocf.localhost
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
CNF
openssl req -new -key "$TRAEFIK/ocf-hub.key" -config /tmp/leaf.cnf -out /tmp/leaf.csr
openssl x509 -req -in /tmp/leaf.csr -CA "$OUT/ocf-hub-ca.crt" -CAkey "$CA_DIR/ca.key" -CAcreateserial \
  -days 730 -sha256 -extfile /tmp/leaf.cnf -extensions v3 -out /tmp/leaf.crt
cat /tmp/leaf.crt "$OUT/ocf-hub-ca.crt" > "$TRAEFIK/ocf-hub.crt"
cat > "$TRAEFIK/ocf-hub-tls.yml" <<YML
tls:
  certificates:
    - certFile: /etc/traefik/dynamic/ocf-hub.crt
      keyFile: /etc/traefik/dynamic/ocf-hub.key
YML
openssl verify -CAfile "$OUT/ocf-hub-ca.crt" /tmp/leaf.crt
