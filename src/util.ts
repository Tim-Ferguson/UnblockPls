export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  /** "1" only in .dev.vars: enables /auth/dev so the site can be tested without X credentials. */
  DEV_LOGIN?: string;
}

export interface User {
  id: string;
  handle: string;
  name: string;
  avatar: string | null;
  closed?: number;
}

export const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

const enc = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function sha256(data: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", enc.encode(data)));
}

/** Signed, expiring cookie payloads: base64url(json).hmac */
export async function seal(secret: string, payload: Record<string, unknown>, ttlSeconds: number): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })));
  return `${body}.${await hmac(secret, body)}`;
}

export async function unseal<T>(secret: string, value: string | undefined): Promise<T | null> {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(secret, body);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const raw = atob(body.replace(/-/g, "+").replace(/_/g, "/"));
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))));
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data as T;
  } catch {
    return null;
  }
}

export function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("Cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function setCookie(name: string, value: string, maxAge: number, secure: boolean, httpOnly = true): string {
  return `${name}=${value}; Path=/; SameSite=Lax; Max-Age=${maxAge}${httpOnly ? "; HttpOnly" : ""}${secure ? "; Secure" : ""}`;
}

/** Only same-site relative paths are allowed as redirect targets. */
export function safeNext(next: string | null | undefined): string {
  // Browsers strip tabs/newlines and treat "\" like "/", so reject those before parsing.
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\x00-\x20\\]/.test(next)) return "/";
  try {
    const u = new URL(next, "http://self.invalid");
    return u.origin === "http://self.invalid" ? u.pathname + u.search : "/";
  } catch {
    return "/";
  }
}

export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

export function redirect(location: string, headers: [string, string][] = []): Response {
  const h = new Headers({ Location: location });
  for (const [k, v] of headers) h.append(k, v);
  return new Response(null, { status: 303, headers: h });
}

export function withParam(path: string, key: string, value: string): string {
  const u = new URL(path, "http://x");
  u.searchParams.set(key, value);
  return u.pathname + u.search;
}
