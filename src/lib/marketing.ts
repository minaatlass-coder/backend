import { createHash } from "node:crypto";

export interface MarketingContext {
  fbp?: string;
  fbc?: string;
  ttclid?: string;
  ttp?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}

export interface ConversionPayload {
  eventName: string;
  eventId: string;
  eventTime: number;
  sourceUrl?: string;
  userAgent: string;
  ip: string;
  name?: string;
  phoneNormalized?: string;
  address?: string;
  value?: number;
  currency?: string;
  contents?: Array<{ id: string; quantity: number; item_price: number }>;
  context?: MarketingContext;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function splitName(name: string): { first: string; last: string } {
  const clean = name.trim().toLowerCase().replace(/\s+/g, " ");
  const [first = "", ...rest] = clean.split(" ");
  return { first, last: rest.join(" ") };
}

function normalizeMetaPhone(phoneNormalized?: string): string | undefined {
  if (!phoneNormalized) return undefined;
  return phoneNormalized.replace(/\D/g, "");
}

function normalizeE164Phone(phoneNormalized?: string): string | undefined {
  if (!phoneNormalized) return undefined;
  const digits = phoneNormalized.replace(/\D/g, "");
  if (!/^212[67]\d{8}$/.test(digits)) return undefined;
  return `+${digits}`;
}

async function postJson(url: string, body: unknown, headers?: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[marketing] HTTP", res.status, url, text.slice(0, 300));
  }
}

async function sendMetaConversion(payload: ConversionPayload): Promise<void> {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !accessToken) return;

  const ph = normalizeMetaPhone(payload.phoneNormalized);
  const userData: Record<string, unknown> = {
    client_ip_address: payload.ip,
    client_user_agent: payload.userAgent,
  };
  if (ph) userData.ph = [sha256(ph)];
  if (payload.context?.fbp) userData.fbp = payload.context.fbp;
  if (payload.context?.fbc) userData.fbc = payload.context.fbc;
  if (payload.context?.ttclid) userData.external_id = [sha256(payload.context.ttclid)];
  if (payload.name) {
    const split = splitName(payload.name);
    if (split.first) userData.fn = [sha256(split.first)];
    if (split.last) userData.ln = [sha256(split.last)];
  }

  const customData: Record<string, unknown> = {};
  if (typeof payload.value === "number") customData.value = payload.value;
  if (payload.currency) customData.currency = payload.currency;
  if (payload.contents?.length) customData.contents = payload.contents;
  if (payload.address) customData.delivery_address = payload.address;

  await postJson(
    `https://graph.facebook.com/v22.0/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`,
    {
      data: [
        {
          event_name: payload.eventName,
          event_time: payload.eventTime,
          event_id: payload.eventId,
          action_source: "website",
          event_source_url: payload.sourceUrl ?? "",
          user_data: userData,
          custom_data: customData,
        },
      ],
    },
  );
}

async function sendTikTokConversion(payload: ConversionPayload): Promise<void> {
  const pixelId = process.env.TIKTOK_PIXEL_ID;
  const accessToken = process.env.TIKTOK_EVENTS_API_ACCESS_TOKEN;
  if (!pixelId || !accessToken) return;

  const phone = normalizeE164Phone(payload.phoneNormalized);
  const body = {
    event_source: "web",
    event_source_id: pixelId,
    data: [
      {
        event: payload.eventName,
        event_id: payload.eventId,
        event_time: payload.eventTime,
        context: {
          ad: {
            callback: payload.context?.ttclid ?? "",
          },
          user: {
            ip: payload.ip,
            user_agent: payload.userAgent,
            ...(phone ? { phone: [sha256(phone)] } : {}),
          },
          page: {
            url: payload.sourceUrl ?? "",
          },
        },
        properties: {
          ...(typeof payload.value === "number" ? { value: payload.value } : {}),
          ...(payload.currency ? { currency: payload.currency } : {}),
          ...(payload.contents?.length ? { contents: payload.contents } : {}),
        },
      },
    ],
  };

  await postJson("https://business-api.tiktok.com/open_api/v1.3/event/track/", body, {
    "access-token": accessToken,
  });
}

export async function sendCapiEvent(payload: ConversionPayload): Promise<void> {
  await Promise.allSettled([sendMetaConversion(payload), sendTikTokConversion(payload)]);
}

