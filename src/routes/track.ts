import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { resolveIpGeo } from "../lib/ip-geo.js";
import { sendCapiEvent, type MarketingContext } from "../lib/marketing.js";
import { saveOrderEvent } from "../lib/persist.js";
import { getClientIp, hashIp, pagePathFromUrl } from "../lib/request-ip.js";
import { saveSiteEvent } from "../lib/site-events.js";

interface TrackBody {
  event?: string;
  event_id?: string;
  event_time?: number;
  ts?: number;
  value?: number;
  currency?: string;
  source_url?: string;
  slug?: string;
  product_slug?: string;
  page_path?: string;
  name?: string;
  phone?: string;
  address?: string;
  contents?: Array<{ id: string; quantity: number; item_price: number }>;
  context?: MarketingContext;
}

function mapEventName(event: string): string {
  const m: Record<string, string> = {
    page_view: "PageView",
    view_product: "ViewContent",
    add_to_cart: "AddToCart",
    open_checkout: "InitiateCheckout",
    submit_order_success: "Purchase",
    upsell_shown: "UpsellShown",
    upsell_accepted: "UpsellAccepted",
    thank_you_view: "ThankYouView",
    whatsapp_click: "WhatsAppClick",
  };
  return m[event] ?? event;
}

export function trackRouter(): Router {
  const router = createRouter();

  router.post("/", async (req: Request, res: Response) => {
    const body = req.body as TrackBody;
    const event = (body.event ?? "").trim();
    const eventId = (body.event_id ?? "").trim();
    if (!event || !eventId) {
      res.status(400).json({ ok: false, error: "event and event_id required" });
      return;
    }

    const ip = getClientIp(req);
    const geo = await resolveIpGeo(ip);
    const ipHash = hashIp(ip);
    const sourceUrl = body.source_url ?? "";
    const productSlug = (body.slug ?? body.product_slug ?? "").trim() || undefined;
    const pagePath =
      (body.page_path ?? "").trim() || pagePathFromUrl(sourceUrl) || undefined;

    const payload = {
      event,
      event_id: eventId,
      event_time: body.event_time ?? Math.floor((body.ts ?? Date.now()) / 1000),
      value: body.value,
      currency: body.currency ?? "MAD",
      source_url: sourceUrl,
      context: body.context ?? {},
      traffic_valid_ma: geo.isValidMa,
      ip_country: geo.countryCode,
    };

    res.json({ ok: true });

    void saveSiteEvent({
      eventName: event,
      eventId,
      pagePath,
      productSlug,
      value: body.value,
      currency: body.currency,
      ipHash,
      geo,
      sourceUrl,
      userAgent: String(req.headers["user-agent"] ?? ""),
      payload: body as Record<string, unknown>,
    }).catch((e) => {
      console.error("[track site_events] failed", e);
    });

    void saveOrderEvent("marketing_event", null, payload).catch((e) => {
      console.error("[track persist] failed", e);
    });

    void sendCapiEvent({
      eventName: mapEventName(event),
      eventId,
      eventTime: payload.event_time,
      sourceUrl: body.source_url,
      userAgent: String(req.headers["user-agent"] ?? ""),
      ip,
      name: body.name,
      phoneNormalized: body.phone,
      address: body.address,
      value: body.value,
      currency: body.currency ?? "MAD",
      contents: body.contents,
      context: body.context,
    }).catch((e) => {
      console.error("[track capi] failed", e);
    });
  });

  return router;
}
