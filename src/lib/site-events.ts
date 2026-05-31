import { query } from "../db.js";
import type { IpGeoResult } from "./ip-geo.js";

export interface SiteEventInput {
  eventName: string;
  eventId: string;
  pagePath?: string;
  productSlug?: string;
  value?: number;
  currency?: string;
  ipHash: string;
  geo: IpGeoResult;
  sourceUrl?: string;
  userAgent?: string;
  payload?: Record<string, unknown>;
}

export async function saveSiteEvent(input: SiteEventInput): Promise<void> {
  await query(
    `INSERT INTO site_events (
       event_name, event_id, page_path, product_slug, value, currency,
       ip_hash, country_code, is_valid_ma, is_proxy, is_hosting,
       source_url, user_agent, payload
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
    [
      input.eventName,
      input.eventId,
      input.pagePath ?? null,
      input.productSlug ?? null,
      input.value ?? null,
      input.currency ?? "MAD",
      input.ipHash,
      input.geo.countryCode,
      input.geo.isValidMa,
      input.geo.isProxy,
      input.geo.isHosting,
      input.sourceUrl ?? null,
      input.userAgent ?? null,
      JSON.stringify(input.payload ?? {}),
    ],
  );
}
