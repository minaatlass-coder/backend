import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

function secret(): string {
  return process.env.ADMIN_SESSION_SECRET?.trim() ?? "";
}

function sessionTtlMs(): number {
  const hours = Number(process.env.ADMIN_SESSION_TTL_HOURS ?? 24);
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function adminAuthConfigured(): boolean {
  const user = process.env.ADMIN_USERNAME?.trim();
  const pass = process.env.ADMIN_PASSWORD?.trim();
  const sec = secret();
  return Boolean(user && pass && sec.length >= 16);
}

export function verifyAdminCredentials(
  username: string,
  password: string,
): boolean {
  if (!adminAuthConfigured()) return false;
  const expectedUser = process.env.ADMIN_USERNAME!.trim();
  const expectedPass = process.env.ADMIN_PASSWORD!.trim();
  return safeEqual(username.trim(), expectedUser) && safeEqual(password, expectedPass);
}

function b64url(data: string): string {
  return Buffer.from(data, "utf8").toString("base64url");
}

function b64urlDecode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

export function signAdminToken(): string {
  const exp = Date.now() + sessionTtlMs();
  const payload = JSON.stringify({ sub: "admin", exp });
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${b64url(payload)}.${sig}`;
}

export function verifyAdminToken(token: string): boolean {
  const sec = secret();
  if (!sec || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;
  let payload: string;
  try {
    payload = b64urlDecode(payloadB64);
  } catch {
    return false;
  }
  const expected = createHmac("sha256", sec).update(payload).digest("base64url");
  if (!safeEqual(sig, expected)) return false;
  try {
    const data = JSON.parse(payload) as { sub?: string; exp?: number };
    if (data.sub !== "admin" || typeof data.exp !== "number") return false;
    return data.exp > Date.now();
  } catch {
    return false;
  }
}

export function extractBearer(req: Request): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  const cookie = req.headers.cookie;
  if (typeof cookie === "string") {
    const match = cookie.match(/(?:^|;\s*)sahha_admin=([^;]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

export function requireAdmin(req: Request): boolean {
  const token = extractBearer(req);
  return token !== null && verifyAdminToken(token);
}
