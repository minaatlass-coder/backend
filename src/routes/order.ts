import { createHash } from "node:crypto";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { products, type ProductSlug } from "../data/products.js";
import { generateOrderId, isValidSlug } from "../lib/order.js";
import { normalizePhone, validateAddress, validateName } from "../lib/phone.js";
import { getOrderSnapshot, saveOrderEvent } from "../lib/persist.js";
import { sendCapiEvent, type MarketingContext } from "../lib/marketing.js";

interface CartLineInput {
  slug: string;
  qty: number;
}

interface OrderBody {
  event?: string;
  source?: "website" | "contact";
  order_id?: string;
  event_id?: string;
  name?: string;
  address?: string;
  phone?: string;
  items?: CartLineInput[];
  upsell_slug?: string;
  message?: string;
  website?: string;
  source_url?: string;
  context?: MarketingContext;
}

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 6;
const ipHits = new Map<string, number[]>();

function getIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real) return real;
  return req.socket.remoteAddress ?? "unknown";
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = ipHits.get(ip) ?? [];
  const recent = list.filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  ipHits.set(ip, recent);
  return recent.length > RATE_MAX;
}

function hashIp(ip: string): string {
  return createHash("sha256")
    .update(ip + (process.env.IP_HASH_SALT ?? "sahha"))
    .digest("hex")
    .slice(0, 16);
}

const WEBHOOK_TIMEOUT_MS = 20_000;

async function forwardToWebhook(payload: unknown): Promise<void> {
  const url = process.env.ORDER_WEBHOOK_URL;
  if (!url) {
    if (process.env.NODE_ENV !== "production") {
      console.log("[order webhook — DEV mock]", JSON.stringify(payload, null, 2));
    }
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[order webhook] HTTP", res.status, text.slice(0, 500));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[order webhook] forward failed", msg);
  } finally {
    clearTimeout(timeout);
  }
}

function scheduleWebhook(payload: unknown): void {
  void forwardToWebhook(payload).catch((e) => {
    console.error("[order webhook] async error", e);
  });
}

function schedulePersist(
  eventType: string,
  orderId: string | null,
  payload: unknown,
): void {
  void saveOrderEvent(eventType, orderId, payload).catch((e) => {
    console.error("[order persist] failed", e);
  });
}

export function orderRouter(): Router {
  const router = createRouter();

  router.post("/", async (req: Request, res: Response) => {
    const body = req.body as OrderBody;

    if (body.website && body.website.trim().length > 0) {
      res.json({ ok: true, order_id: "SAH-IGNORED" });
      return;
    }

    const ip = getIp(req);
    if (rateLimited(ip)) {
      res.status(429).json({
        ok: false,
        error: "Trop de requêtes, réessayez dans une minute.",
      });
      return;
    }

    const event = body.event ?? "order_created";

    if (event === "order_created") {
      const nameRes = validateName(body.name ?? "");
      if (!nameRes.ok) {
        res.status(400).json({ ok: false, error: nameRes.errorKey });
        return;
      }
      const phoneRes = normalizePhone(body.phone ?? "");
      if (!phoneRes.ok) {
        res.status(400).json({ ok: false, error: phoneRes.errorKey });
        return;
      }
      const addressRes = validateAddress(body.address ?? "");
      if (!addressRes.ok) {
        res.status(400).json({ ok: false, error: addressRes.errorKey });
        return;
      }
      if (!Array.isArray(body.items) || body.items.length === 0) {
        res.status(400).json({ ok: false, error: "Panier vide." });
        return;
      }

      const validItems = body.items
        .filter((it) => isValidSlug(it.slug) && Number.isFinite(it.qty) && it.qty > 0)
        .map((it) => {
          const slug = it.slug as ProductSlug;
          const p = products[slug];
          const qty = Math.min(Math.floor(it.qty), 10);
          return {
            sku: slug,
            name_fr: p.nameFr,
            qty,
            unit_price: p.price,
            line_total: p.price * qty,
          };
        });

      if (validItems.length === 0) {
        res.status(400).json({ ok: false, error: "Aucun produit valide." });
        return;
      }

      const subtotal = validItems.reduce((s, i) => s + i.line_total, 0);
      const order_id = generateOrderId();
      const event_id = body.event_id || `${order_id}-purchase`;

      const payload = {
        event: "order_created" as const,
        event_id,
        order_id,
        created_at: new Date().toISOString(),
        name: nameRes.name!,
        address: addressRes.address!,
        phone_normalized: phoneRes.phone!,
        phone_raw: body.phone,
        items: validItems,
        items_subtotal: subtotal,
        upsell: null,
        order_total: subtotal,
        currency: "MAD" as const,
        source: body.source ?? "website",
        source_url: body.source_url ?? String(req.headers.referer ?? ""),
        context: body.context ?? {},
        user_agent: req.headers["user-agent"] ?? "",
        referrer: req.headers.referer ?? "",
        ip_hash: hashIp(ip),
      };

      scheduleWebhook(payload);
      schedulePersist("order_created", order_id, payload);
      void sendCapiEvent({
        eventName: "Purchase",
        eventId: event_id,
        eventTime: Math.floor(Date.now() / 1000),
        sourceUrl: payload.source_url,
        userAgent: String(req.headers["user-agent"] ?? ""),
        ip,
        name: nameRes.name,
        phoneNormalized: phoneRes.phone,
        address: addressRes.address,
        value: subtotal,
        currency: "MAD",
        contents: validItems.map((i) => ({
          id: i.sku,
          quantity: i.qty,
          item_price: i.unit_price,
        })),
        context: body.context,
      }).catch((e) => {
        console.error("[order capi] purchase failed", e);
      });

      res.json({
        ok: true,
        order_id,
        items: validItems,
        items_subtotal: subtotal,
        order_total: subtotal,
        name: nameRes.name,
        address: addressRes.address,
        phone: phoneRes.phone,
        created_at: payload.created_at,
      });
      return;
    }

    if (event === "upsell_added") {
      if (!body.order_id || !body.upsell_slug || !isValidSlug(body.upsell_slug)) {
        res.status(400).json({ ok: false, error: "Requête invalide." });
        return;
      }
      const slug = body.upsell_slug as ProductSlug;
      const p = products[slug];

      const payload = {
        event: "upsell_added" as const,
        event_id: body.event_id ?? `${body.order_id}-upsell-${slug}`,
        order_id: body.order_id,
        upsell: {
          sku: slug,
          name_fr: p.nameFr,
          unit_price: p.upsellPrice,
          accepted: true,
        },
        currency: "MAD" as const,
      };

      scheduleWebhook(payload);
      schedulePersist("upsell_added", body.order_id, payload);
      const snapshot = await getOrderSnapshot(body.order_id).catch(() => null);
      void sendCapiEvent({
        eventName: "UpsellAccepted",
        eventId: payload.event_id,
        eventTime: Math.floor(Date.now() / 1000),
        sourceUrl: body.source_url ?? String(req.headers.referer ?? ""),
        userAgent: String(req.headers["user-agent"] ?? ""),
        ip,
        name: snapshot?.name,
        phoneNormalized: snapshot?.phone_normalized,
        address: snapshot?.address,
        value: p.upsellPrice,
        currency: "MAD",
        contents: [{ id: slug, quantity: 1, item_price: p.upsellPrice }],
        context: body.context,
      }).catch((e) => {
        console.error("[order capi] upsell failed", e);
      });

      res.json({
        ok: true,
        order_id: body.order_id,
        upsell: payload.upsell,
      });
      return;
    }

    if (event === "contact_message") {
      const nameRes = validateName(body.name ?? "");
      if (!nameRes.ok) {
        res.status(400).json({ ok: false, error: nameRes.errorKey });
        return;
      }
      const phoneRes = normalizePhone(body.phone ?? "");
      if (!phoneRes.ok) {
        res.status(400).json({ ok: false, error: phoneRes.errorKey });
        return;
      }
      const message = (body.message ?? "").trim();
      if (message.length < 5) {
        res.status(400).json({ ok: false, error: "contact.msgShort" });
        return;
      }
      if (message.length > 2000) {
        res.status(400).json({ ok: false, error: "contact.msgLong" });
        return;
      }

      const payload = {
        event: "contact_message" as const,
        event_id: body.event_id ?? generateOrderId(),
        created_at: new Date().toISOString(),
        name: nameRes.name!,
        phone_normalized: phoneRes.phone!,
        phone_raw: body.phone,
        message,
        source: "contact" as const,
        source_url: body.source_url ?? String(req.headers.referer ?? ""),
        context: body.context ?? {},
        user_agent: req.headers["user-agent"] ?? "",
        referrer: req.headers.referer ?? "",
        ip_hash: hashIp(ip),
      };

      scheduleWebhook(payload);
      schedulePersist("contact_message", null, payload);
      void sendCapiEvent({
        eventName: "Lead",
        eventId: payload.event_id,
        eventTime: Math.floor(Date.now() / 1000),
        sourceUrl: payload.source_url,
        userAgent: String(req.headers["user-agent"] ?? ""),
        ip,
        name: nameRes.name,
        phoneNormalized: phoneRes.phone,
        context: body.context,
      }).catch((e) => {
        console.error("[order capi] contact failed", e);
      });

      res.json({ ok: true });
      return;
    }

    res.status(400).json({ ok: false, error: "Événement inconnu." });
  });

  return router;
}
