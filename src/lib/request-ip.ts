import { createHash } from "node:crypto";
import type { Request } from "express";

export function getClientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real) return real;
  return req.socket.remoteAddress ?? "unknown";
}

export function hashIp(ip: string): string {
  return createHash("sha256")
    .update(ip + (process.env.IP_HASH_SALT ?? "sahha"))
    .digest("hex")
    .slice(0, 16);
}

export function pagePathFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.pathname || "/";
  } catch {
    return undefined;
  }
}
