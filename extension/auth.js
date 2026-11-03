// Extension identity: an ES256 key pair (private key non-extractable, kept in IndexedDB) used to sign
// short-lived JWTs that the hub verifies against its JWKS before accepting the WebSocket.

const OCF_DB = "ocf-auth";
const OCF_STORE = "keys";
const OCF_KEY_ID = "identity";
const OCF_ISSUER = "ocf-extension";
const OCF_AUDIENCE = "ocf-hub";
const OCF_DEFAULT_HUB_URL = "wss://ocf.localhost/ws";

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(OCF_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(OCF_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(OCF_STORE, mode);
      const req = fn(tx.objectStore(OCF_STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

async function thumbprint(jwk) {
  const canon = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon)));
}

async function getIdentity() {
  let id = await idb("readonly", (s) => s.get(OCF_KEY_ID));
  if (!id) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const pub = { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y };
    const kid = await thumbprint(pub);
    id = { privateKey: pair.privateKey, publicJwk: { ...pub, kid, alg: "ES256", use: "sig" } };
    await idb("readwrite", (s) => s.put(id, OCF_KEY_ID));
  }
  return id;
}

async function createToken() {
  const { privateKey, publicJwk } = await getIdentity();
  const now = Math.floor(Date.now() / 1000);
  const { label } = await chrome.storage.local.get("label");
  // The public key and a label hint ride in the protected header so the hub can offer this key for approval in its TUI.
  const { kty, crv, x, y } = publicJwk;
  const head = b64urlJson({ alg: "ES256", typ: "JWT", kid: publicJwk.kid, jwk: { kty, crv, x, y }, label: label || "firefox" });
  const body = b64urlJson({ iss: OCF_ISSUER, aud: OCF_AUDIENCE, iat: now, exp: now + 120, jti: crypto.randomUUID() });
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`; // WebCrypto returns raw r||s, which is the JWS ES256 format
}

async function getHubUrl() {
  const s = await chrome.storage.local.get("hubUrl");
  return s.hubUrl || OCF_DEFAULT_HUB_URL;
}
