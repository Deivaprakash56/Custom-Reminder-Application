// Generate a VAPID key pair for Web Push.   Run: node gen-vapid.mjs
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
const b64u = (b) => Buffer.from(b).toString("base64url");
const priv = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d });
console.log("VAPID_PUBLIC:\n" + b64u(raw) + "\n");
console.log("VAPID_PRIVATE_JWK (keep secret):\n" + priv + "\n");
console.log("Set them on the worker:");
console.log("  npx wrangler secret put VAPID_PUBLIC        # paste the public key");
console.log("  npx wrangler secret put VAPID_PRIVATE_JWK   # paste the JSON");
