import { randomBytes } from "node:crypto";
import type { ProductSlug } from "../data/products.js";

const SLUGS: ProductSlug[] = ["vitalstride", "restwave", "floraease"];

export function generateOrderId(date = new Date()): string {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = randomBytes(2).toString("hex").toUpperCase();
  return `SAH-${ymd}-${rand}`;
}

export function isValidOrderId(s: unknown): s is string {
  return typeof s === "string" && /^SAH-\d{8}-[0-9A-F]{4}$/.test(s);
}

export function isValidSlug(s: unknown): s is ProductSlug {
  return typeof s === "string" && (SLUGS as readonly string[]).includes(s);
}
