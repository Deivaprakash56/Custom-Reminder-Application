// Run: node --test tests/test_webpush.mjs   (Node 20+)
// Checks the Web Push encryption against the RFC 8291 test vector, and VAPID signatures.
import test from "node:test";
import assert from "node:assert/strict";
import { encryptPayload, vapidAuthorization, b64u } from "../push-worker/src/webpush.js";

const V = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

async function importPair(pubB64, privB64) {
  const pub = b64u.decode(pubB64);
  const jwk = { kty: "EC", crv: "P-256", x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33, 65)), d: privB64 };
  return {
    privateKey: await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]),
    publicKey: await crypto.subtle.importKey("raw", pub, { name: "ECDH", namedCurve: "P-256" }, true, []),
  };
}

test("RFC 8291 test vector", async () => {
  const asKeyPair = await importPair(V.asPublic, V.asPrivate);
  const body = await encryptPayload(V.plaintext, V.uaPublic, V.auth, { asKeyPair, salt: b64u.decode(V.salt) });
  assert.equal(b64u.encode(body), V.body);
});

test("random keys produce a well-formed body", async () => {
  const body = await encryptPayload("hello", V.uaPublic, V.auth);
  assert.equal(body.length, 86 + 5 + 1 + 16);
  assert.equal(new DataView(body.buffer).getUint32(16), 4096);
});

test("VAPID JWT verifies with the public key", async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = b64u.encode(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)));
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", pub, jwk, "https://example.com/");
  const m = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m);
  assert.equal(m[4], pub);
  const claims = JSON.parse(Buffer.from(m[2], "base64url").toString());
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, kp.publicKey, b64u.decode(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
  assert.equal(ok, true);
});
