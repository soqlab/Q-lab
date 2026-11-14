/*
 * Q-Lab provenance certificate check, in the browser. Plain script, no build step: it needs
 * /vendor/qlab-pq-verify.js (ML-DSA-65, Ed25519, SHA-256 from @noble, vendored) loaded first, and
 * defines globalThis.QLabCertificate. It never talks to the network: give it the certificate.
 *
 * The same rules as backend/app/provenance/verify.py (the offline verifier):
 *   body_sha256 = SHA-256 of the body as canonical JSON (keys sorted, no whitespace, integers,
 *                 strings, booleans and null only; decimals are strings);
 *   signed text = "qlab-provenance-certificate/1\nkey <id>\nsigned-at <time>\nbody-sha256 <hex>\n";
 *   Ed25519 over it, and ML-DSA-65 over it with the context string "qlab-provenance-certificate/1";
 *   key id = "qrk-" + first 32 hex of SHA-256("qlab-rewind-key/1\n" + ml_dsa_65_public + ed25519_public).
 */
(function () {
  "use strict";
  var FORMAT = "qlab-provenance-certificate/1";
  var MAX = 9007199254740991;
  var enc = new TextEncoder();

  function fail(msg) { var e = new Error(msg); e.malformed = true; throw e; }

  function canonical(v, path) {
    path = path || "certificate";
    if (v === null) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") {
      if (!Number.isInteger(v) || Math.abs(v) > MAX) fail(path + ": only integers are allowed (decimals are strings).");
      return String(v);
    }
    if (typeof v === "string") {
      if (/[\uD800-\uDFFF]/.test(v.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""))) fail(path + ": lone surrogate.");
      return JSON.stringify(v);
    }
    if (Array.isArray(v)) return "[" + v.map(function (x, i) { return canonical(x, path + "[" + i + "]"); }).join(",") + "]";
    if (typeof v === "object") {
      var keys = Object.keys(v).sort();
      return "{" + keys.map(function (k) {
        if (!/^[\x00-\x7f]*$/.test(k)) fail(path + ": object keys must be ASCII.");
        return JSON.stringify(k) + ":" + canonical(v[k], path + "." + k);
      }).join(",") + "}";
    }
    return fail(path + ": " + typeof v + " is not allowed.");
  }

  function hex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return s;
  }

  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function b64(s, what, len) {
    if (typeof s !== "string" || !s || s.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) fail(what + " is not valid base64.");
    var pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
    var out = new Uint8Array(s.length / 4 * 3 - pad), o = 0;
    for (var i = 0; i < s.length; i += 4) {
      var n = 0;
      for (var j = 0; j < 4; j++) n = (n << 6) | (s[i + j] === "=" ? 0 : B64.indexOf(s[i + j]));
      if (o < out.length) out[o++] = (n >> 16) & 255;
      if (o < out.length) out[o++] = (n >> 8) & 255;
      if (o < out.length) out[o++] = n & 255;
    }
    if (len && out.length !== len) fail(what + " must be " + len + " bytes, not " + out.length + ".");
    return out;
  }

  function concat(parts) {
    var n = 0, i, off = 0;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n);
    for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
  }

  function pq() {
    var P = globalThis.QLabPQ;
    if (!P) fail("The verifier library (/vendor/qlab-pq-verify.js) isn't loaded.");
    return P;
  }

  function bodySha256(body) { return hex(pq().sha256(enc.encode(canonical(body)))); }

  function keyId(mlPub, edPub) {
    return "qrk-" + hex(pq().sha256(concat([enc.encode("qlab-rewind-key/1\n"), mlPub, edPub]))).slice(0, 32);
  }

  /** {valid, body_hash_ok, ed25519, ml_dsa_65, key_id, body_sha256, reason}; throws (e.malformed) on a malformed document. */
  function verify(doc, expectKey) {
    var P = pq();
    if (!doc || typeof doc !== "object" || doc.format !== FORMAT) fail("Not a " + FORMAT + " document.");
    var body = doc.certificate;
    if (!body || typeof body !== "object" || Array.isArray(body)) fail("The certificate body is missing.");
    if (body.schema !== FORMAT) fail("The body's schema is not " + FORMAT + ".");
    var actual = bodySha256(body);
    var out = { valid: false, body_hash_ok: actual === doc.body_sha256, ed25519: false, ml_dsa_65: false,
                key_id: null, body_sha256: actual, reason: null };
    if (!out.body_hash_ok) { out.reason = "The body's hash is not the one stated: the certificate was changed after it was issued."; return out; }
    var sig = doc.signature;
    if (!sig) { out.reason = "The certificate is not signed (the server had no signing key)."; return out; }
    var pub = sig.public_key || {};
    var edPub = b64(pub.ed25519, "public_key.ed25519", 32);
    var mlPub = b64(pub.ml_dsa_65, "public_key.ml_dsa_65", 1952);
    var kid = keyId(mlPub, edPub);
    out.key_id = kid;
    if (sig.key !== kid || (pub.key_id !== undefined && pub.key_id !== kid)) { out.reason = "The key id does not match the public keys sent with it."; return out; }
    if (typeof sig.signed_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(sig.signed_at)) fail("signature.signed_at is malformed.");
    var message = enc.encode(FORMAT + "\nkey " + kid + "\nsigned-at " + sig.signed_at + "\nbody-sha256 " + actual + "\n");
    var edSig = b64(sig.ed25519, "signature.ed25519");
    var mlSig = b64(sig.ml_dsa_65, "signature.ml_dsa_65");
    try { out.ed25519 = P.ed25519Verify(edSig, message, edPub) === true; } catch (e) { out.ed25519 = false; }
    try { out.ml_dsa_65 = P.mlDsa65Verify(mlSig, message, mlPub, enc.encode(FORMAT)) === true; } catch (e) { out.ml_dsa_65 = false; }
    if (!(out.ed25519 && out.ml_dsa_65)) out.reason = "The signature does not match the certificate: it was changed after signing, or signed by another key.";
    else if (expectKey && expectKey !== kid) out.reason = "Signed by " + kid + ", not by the key you trust (" + expectKey + ").";
    out.valid = out.reason === null;
    return out;
  }

  globalThis.QLabCertificate = Object.freeze({ FORMAT: FORMAT, canonical: canonical, bodySha256: bodySha256, verify: verify });
})();
