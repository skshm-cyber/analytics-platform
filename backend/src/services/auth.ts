/**
 * Authentication service: JWT (HMAC-SHA256) + password hashing (PBKDF2).
 *
 * Uses Web Crypto API (available in Cloudflare Workers).
 * No external dependencies.
 */

const JWT_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LENGTH = 64;
const SALT_LENGTH = 16;

// ── Password Hashing (PBKDF2-SHA256) ────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    PBKDF2_KEY_LENGTH * 8
  );

  const hash = new Uint8Array(derivedBits);
  return bytesToHex(salt) + ":" + bytesToHex(hash);
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const [saltHex, hashHex] = storedHash.split(":");
  if (!saltHex || !hashHex) return false;

  const encoder = new TextEncoder();
  const salt = hexToBytes(saltHex);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    PBKDF2_KEY_LENGTH * 8
  );

  const newHash = bytesToHex(new Uint8Array(derivedBits));
  return newHash === hashHex;
}

// ── JWT (HMAC-SHA256) ───────────────────────────────────────────────────────

interface JwtPayload {
  user_id: string;
  email: string;
  name: string;
  is_admin: number;
  exp: number;
}

function base64UrlEncode(data: string): string {
  return btoa(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(data: string): string {
  let base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  return atob(base64);
}

async function hmacSign(
  secret: string,
  data: string
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));
}

export async function signJwt(
  payload: Omit<JwtPayload, "exp">,
  secret: string
): Promise<string> {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, exp: now + JWT_EXPIRY_SECONDS };
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = await hmacSign(secret, `${header}.${body}`);
  return `${header}.${body}.${signature}`;
}

export async function verifyJwt(
  token: string,
  secret: string
): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const expectedSig = await hmacSign(secret, `${header}.${body}`);
  if (signature !== expectedSig) return null;

  try {
    const payload: JwtPayload = JSON.parse(base64UrlDecode(body));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Cookie helpers ───────────────────────────────────────────────────────────

export function getSessionCookie(token: string): string {
  return `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${JWT_EXPIRY_SECONDS}`;
}

export function getClearCookie(): string {
  return "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

export function extractSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/session=([^;]+)/);
  return match ? match[1] : null;
}
