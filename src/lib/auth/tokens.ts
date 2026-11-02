// Tokens, hashes and signed cookie values. Web Crypto only, so it works in the proxy and in routes.

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 random bytes as base64url (43 characters). Used for invite links. */
export function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Random value for a CSP nonce. */
export function randomNonce(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(18)));
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmacHex(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** "<payload>.<hmac>". The payload must not contain secrets: it is readable. */
export async function signValue(payload: string, secret: string): Promise<string> {
  return `${payload}.${await hmacHex(payload, secret)}`;
}

/** Returns the payload if the signature is valid, otherwise null. */
export async function verifySignedValue(value: string | undefined | null, secret: string): Promise<string | null> {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  return constantTimeEqual(mac, await hmacHex(payload, secret)) ? payload : null;
}
