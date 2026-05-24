import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { saveOrderEvent } from "../lib/persist.js";
import { sendCapiEvent, type MarketingContext } from "../lib/marketing.js";

interface TrackBody {
  event?: string;
  event_id?: string;
  event_time?: number;
  value?: number;
  currency?: string;
  source_url?: string;
  name?: string;
  phone?: string;
  address?: string;
  contents?: Array<{ id: string; quantity: number; item_price: number }>;
  context?: MarketingContext;
}

function getIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real) return real;
  return req.socket.remoteAddress ?? "unknown";
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

    const payload = {
      event,
      event_id: eventId,
      event_time: body.event_time ?? Math.floor(Date.now() / 1000),
      value: body.value,
      currency: body.currency ?? "MAD",
      source_url: body.source_url ?? "",
      context: body.context ?? {},
    };

    void saveOrderEvent("marketing_event", null, payload).catch((e) => {
      console.error("[track persist] failed", e);
    });

    void sendCapiEvent({
      eventName: mapEventName(event),
      eventId,
      eventTime: payload.event_time,
      sourceUrl: body.source_url,
      userAgent: String(req.headers["user-agent"] ?? ""),
      ip: getIp(req),
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

    res.json({ ok: true });
  });

  return router;
}

