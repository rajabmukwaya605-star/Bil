// End-to-end encryption helpers (Web Crypto): ECDH P-256 key agreement + AES-256-GCM.
// The private key never leaves this browser (stored in localStorage as a JWK).
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export { b64, unb64 };

const ALG = { name: "ECDH", namedCurve: "P-256" };
const lsKey = (uid) => "cyph_ecdh_" + uid;
const shared = new Map();

export async function fingerprint(pubB64) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", unb64(pubB64)));
  const hex = [...d].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
  return hex.match(/.{1,4}/g).slice(0, 12).join(" ");
}

// Returns { privateKey, publicB64, fingerprint, created } - generates a pair on first use per browser.
export async function loadOrCreateKeys(uid) {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(lsKey(uid)) || "null"); } catch {}
  if (stored?.priv && stored?.pub) {
    const privateKey = await crypto.subtle.importKey("jwk", stored.priv, ALG, false, ["deriveKey", "deriveBits"]);
    return { privateKey, publicB64: stored.pub, fingerprint: await fingerprint(stored.pub), created: false };
  }
  const kp = await crypto.subtle.generateKey(ALG, true, ["deriveKey", "deriveBits"]);
  const priv = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const pub = b64(await crypto.subtle.exportKey("raw", kp.publicKey));
  localStorage.setItem(lsKey(uid), JSON.stringify({ priv, pub }));
  const privateKey = await crypto.subtle.importKey("jwk", priv, ALG, false, ["deriveKey", "deriveBits"]);
  return { privateKey, publicB64: pub, fingerprint: await fingerprint(pub), created: true };
}

export async function sharedKey(privateKey, peerPubB64) {
  if (shared.has(peerPubB64)) return shared.get(peerPubB64);
  const peer = await crypto.subtle.importKey("raw", unb64(peerPubB64), ALG, false, []);
  const key = await crypto.subtle.deriveKey({ name: "ECDH", public: peer }, privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  shared.set(peerPubB64, key);
  return key;
}

export async function encryptBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { data: new Uint8Array(ct), iv: b64(iv) };
}
export async function decryptBytes(key, bytes, ivB64) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, key, bytes));
}
export async function encryptText(key, text) {
  const { data, iv } = await encryptBytes(key, enc.encode(text));
  return { ct: b64(data), iv };
}
export async function decryptText(key, ctB64, ivB64) {
  return dec.decode(await decryptBytes(key, unb64(ctB64), ivB64));
}
