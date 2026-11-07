// Web Push for Cloudflare Workers / Node 20+ (WebCrypto only, no dependencies).
//  - RFC 8291 message encryption (aes128gcm, RFC 8188)
//  - RFC 8292 VAPID authentication (ES256 JWT)

const te = new TextEncoder();

export const b64u = {
  encode(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(str) {
    const s = String(str).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(s + "===".slice((s.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

function concat(...parts) {
  const arrs = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/**
 * Encrypt a push message for one subscription.
 * @param {string|Uint8Array} plaintext
 * @param {string} uaPublicB64  subscription.keys.p256dh (base64url, 65-byte uncompressed point)
 * @param {string} authB64      subscription.keys.auth (base64url, 16 bytes)
 * @param {{asKeyPair?: CryptoKeyPair, salt?: Uint8Array}} [fixed]  only for test vectors
 * @returns {Promise<Uint8Array>} request body (header + ciphertext)
 */
export async function encryptPayload(plaintext, uaPublicB64, authB64, fixed = {}) {
  const uaPublic = b64u.decode(uaPublicB64);
  const auth = b64u.decode(authB64);
  if (uaPublic.length !== 65 || auth.length < 16) throw new Error("bad subscription keys");
  const as = fixed.asKeyPair || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));

  const prkKey = await hmac(auth, ecdh);
  const ikm = await hmac(prkKey, concat(te.encode("WebPush: info\0"), uaPublic, asPublic, [1]));
  const salt = fixed.salt || crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(te.encode("Content-Encoding: aes128gcm\0"), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, concat(te.encode("Content-Encoding: nonce\0"), [1]))).slice(0, 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const data = typeof plaintext === "string" ? te.encode(plaintext) : plaintext;
  if (data.length > 3800) throw new Error("payload too large");
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(data, [2])));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ct);
}

/** VAPID Authorization header for a push endpoint. privateJwk: {kty:"EC",crv:"P-256",x,y,d} */
export async function vapidAuthorization(endpoint, publicKeyB64, privateJwk, subject, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const enc = (o) => b64u.encode(te.encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })}`;
  const key = await crypto.subtle.importKey("jwk", { ...privateJwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(unsigned)));
  return `vapid t=${unsigned}.${b64u.encode(sig)}, k=${publicKeyB64}`;
}

/**
 * Send one push. Returns the push service's HTTP status (201 = queued; 404/410 = subscription gone).
 * env: { VAPID_PUBLIC, VAPID_PRIVATE_JWK (JSON string), VAPID_SUBJECT }
 */
export async function sendPush(subscription, payload, env, { ttl = 86400, urgency = "high", topic } = {}) {
  const body = await encryptPayload(JSON.stringify(payload), subscription.keys.p256dh, subscription.keys.auth);
  const headers = {
    Authorization: await vapidAuthorization(subscription.endpoint, env.VAPID_PUBLIC, JSON.parse(env.VAPID_PRIVATE_JWK), env.VAPID_SUBJECT || "mailto:reminders@example.invalid"),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(ttl),
    Urgency: urgency,
  };
  if (topic) headers.Topic = topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  const res = await fetch(subscription.endpoint, { method: "POST", headers, body });
  return res.status;
}
