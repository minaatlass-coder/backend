import { query } from "../db.js";

export interface DateRange {
  from: Date;
  to: Date;
}

export interface DashboardStats {
  range: { from: string; to: string };
  traffic_filter: "valid_ma_only";
  funnel: {
    page_views: number;
    product_views: number;
    add_to_cart: number;
    open_checkout: number;
    submit_order_success: number;
    orders: number;
    upsells_accepted: number;
    contacts: number;
    whatsapp_clicks: number;
  };
  revenue: {
    orders_subtotal_mad: number;
    upsell_revenue_mad: number;
    total_mad: number;
    aov_mad: number;
  };
  conversion: {
    view_to_cart_pct: number;
    cart_to_checkout_pct: number;
    checkout_to_order_pct: number;
    overall_conversion_pct: number;
  };
  by_product: Array<{
    slug: string;
    views: number;
    add_to_cart: number;
    orders: number;
    revenue_mad: number;
  }>;
  by_day: Array<{
    date: string;
    page_views: number;
    orders: number;
    revenue_mad: number;
  }>;
}

function pct(num: number, den: number): number {
  if (den <= 0) return 0;
  return Math.round((num / den) * 1000) / 10;
}

export async function getDashboardStats(range: DateRange): Promise<DashboardStats> {
  const from = range.from.toISOString();
  const to = range.to.toISOString();

  const eventCounts = await query<{ event_name: string; c: string }>(
    `SELECT event_name, COUNT(*)::text AS c
     FROM site_events
     WHERE is_valid_ma = TRUE
       AND created_at >= $1::timestamptz
       AND created_at < $2::timestamptz
     GROUP BY event_name`,
    [from, to],
  );

  const countMap = new Map<string, number>();
  for (const row of eventCounts.rows) {
    countMap.set(row.event_name, Number(row.c));
  }

  const ordersRes = await query<{
    orders: string;
    subtotal: string;
  }>(
    `SELECT
       COUNT(*)::text AS orders,
       COALESCE(SUM((payload->>'order_total')::numeric), 0)::text AS subtotal
     FROM (
       SELECT DISTINCT ON (order_id) order_id, payload
       FROM order_events
       WHERE event_type = 'order_created'
         AND created_at >= $1::timestamptz
         AND created_at < $2::timestamptz
         AND (payload->>'traffic_valid_ma')::boolean = TRUE
       ORDER BY order_id, id DESC
     ) o`,
    [from, to],
  );

  const upsellRes = await query<{ c: string; revenue: string }>(
    `SELECT COUNT(*)::text AS c,
            COALESCE(SUM((payload->'upsell'->>'unit_price')::numeric), 0)::text AS revenue
     FROM order_events e
     WHERE event_type = 'upsell_added'
       AND created_at >= $1::timestamptz
       AND created_at < $2::timestamptz
       AND EXISTS (
         SELECT 1 FROM order_events o
         WHERE o.order_id = e.order_id
           AND o.event_type = 'order_created'
           AND (o.payload->>'traffic_valid_ma')::boolean = TRUE
         LIMIT 1
       )`,
    [from, to],
  );

  const contactsRes = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
     FROM order_events
     WHERE event_type = 'contact_message'
       AND created_at >= $1::timestamptz
       AND created_at < $2::timestamptz
       AND (payload->>'traffic_valid_ma')::boolean = TRUE`,
    [from, to],
  );

  const pageViews = countMap.get("page_view") ?? 0;
  const productViews = countMap.get("view_product") ?? 0;
  const addToCart = countMap.get("add_to_cart") ?? 0;
  const openCheckout = countMap.get("open_checkout") ?? 0;
  const submitSuccess = countMap.get("submit_order_success") ?? 0;
  const orders = Number(ordersRes.rows[0]?.orders ?? 0);
  const subtotal = Number(ordersRes.rows[0]?.subtotal ?? 0);
  const upsells = Number(upsellRes.rows[0]?.c ?? 0);
  const upsellRevenue = Number(upsellRes.rows[0]?.revenue ?? 0);
  const contacts = Number(contactsRes.rows[0]?.c ?? 0);
  const whatsapp = countMap.get("whatsapp_click") ?? 0;
  const totalRevenue = subtotal + upsellRevenue;

  const byProductViews = await query<{ slug: string; c: string }>(
    `SELECT COALESCE(product_slug, 'unknown') AS slug, COUNT(*)::text AS c
     FROM site_events
     WHERE is_valid_ma = TRUE
       AND event_name = 'view_product'
       AND created_at >= $1::timestamptz AND created_at < $2::timestamptz
     GROUP BY product_slug`,
    [from, to],
  );

  const byProductCart = await query<{ slug: string; c: string }>(
    `SELECT COALESCE(product_slug, 'unknown') AS slug, COUNT(*)::text AS c
     FROM site_events
     WHERE is_valid_ma = TRUE
       AND event_name = 'add_to_cart'
       AND created_at >= $1::timestamptz AND created_at < $2::timestamptz
     GROUP BY product_slug`,
    [from, to],
  );

  const byProductOrders = await query<{ slug: string; orders: string; revenue: string }>(
    `SELECT item->>'sku' AS slug,
            COUNT(*)::text AS orders,
            COALESCE(SUM((item->>'line_total')::numeric), 0)::text AS revenue
     FROM (
       SELECT DISTINCT ON (order_id) payload
       FROM order_events
       WHERE event_type = 'order_created'
         AND created_at >= $1::timestamptz AND created_at < $2::timestamptz
         AND (payload->>'traffic_valid_ma')::boolean = TRUE
       ORDER BY order_id, id DESC
     ) o,
     LATERAL jsonb_array_elements(o.payload->'items') AS item
     GROUP BY item->>'sku'`,
    [from, to],
  );

  const slugSet = new Set<string>();
  for (const r of byProductViews.rows) slugSet.add(r.slug);
  for (const r of byProductCart.rows) slugSet.add(r.slug);
  for (const r of byProductOrders.rows) slugSet.add(r.slug);

  const viewsMap = new Map(byProductViews.rows.map((r) => [r.slug, Number(r.c)]));
  const cartMap = new Map(byProductCart.rows.map((r) => [r.slug, Number(r.c)]));
  const orderMap = new Map(
    byProductOrders.rows.map((r) => [r.slug, { orders: Number(r.orders), revenue: Number(r.revenue) }]),
  );

  const byProduct = [...slugSet]
    .filter((s) => s !== "unknown")
    .map((slug) => ({
      slug,
      views: viewsMap.get(slug) ?? 0,
      add_to_cart: cartMap.get(slug) ?? 0,
      orders: orderMap.get(slug)?.orders ?? 0,
      revenue_mad: orderMap.get(slug)?.revenue ?? 0,
    }))
    .sort((a, b) => b.revenue_mad - a.revenue_mad);

  const byDayEvents = await query<{ d: string; page_views: string }>(
    `SELECT to_char(created_at AT TIME ZONE 'Africa/Casablanca', 'YYYY-MM-DD') AS d,
            COUNT(*) FILTER (WHERE event_name = 'page_view')::text AS page_views
     FROM site_events
     WHERE is_valid_ma = TRUE
       AND created_at >= $1::timestamptz AND created_at < $2::timestamptz
     GROUP BY 1
     ORDER BY 1`,
    [from, to],
  );

  const byDayOrders = await query<{ d: string; orders: string; revenue: string }>(
    `SELECT to_char(created_at AT TIME ZONE 'Africa/Casablanca', 'YYYY-MM-DD') AS d,
            COUNT(*)::text AS orders,
            COALESCE(SUM((payload->>'order_total')::numeric), 0)::text AS revenue
     FROM (
       SELECT DISTINCT ON (order_id) order_id, payload, created_at
       FROM order_events
       WHERE event_type = 'order_created'
         AND created_at >= $1::timestamptz AND created_at < $2::timestamptz
         AND (payload->>'traffic_valid_ma')::boolean = TRUE
       ORDER BY order_id, id DESC
     ) x
     GROUP BY 1
     ORDER BY 1`,
    [from, to],
  );

  const dayMap = new Map<string, { page_views: number; orders: number; revenue_mad: number }>();
  for (const r of byDayEvents.rows) {
    dayMap.set(r.d, {
      page_views: Number(r.page_views),
      orders: 0,
      revenue_mad: 0,
    });
  }
  for (const r of byDayOrders.rows) {
    const prev = dayMap.get(r.d) ?? { page_views: 0, orders: 0, revenue_mad: 0 };
    dayMap.set(r.d, {
      ...prev,
      orders: Number(r.orders),
      revenue_mad: Number(r.revenue),
    });
  }

  const by_day = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));

  return {
    range: { from, to },
    traffic_filter: "valid_ma_only",
    funnel: {
      page_views: pageViews,
      product_views: productViews,
      add_to_cart: addToCart,
      open_checkout: openCheckout,
      submit_order_success: submitSuccess,
      orders,
      upsells_accepted: upsells,
      contacts,
      whatsapp_clicks: whatsapp,
    },
    revenue: {
      orders_subtotal_mad: subtotal,
      upsell_revenue_mad: upsellRevenue,
      total_mad: totalRevenue,
      aov_mad: orders > 0 ? Math.round((totalRevenue / orders) * 100) / 100 : 0,
    },
    conversion: {
      view_to_cart_pct: pct(addToCart, productViews),
      cart_to_checkout_pct: pct(openCheckout, addToCart),
      checkout_to_order_pct: pct(orders, openCheckout),
      overall_conversion_pct: pct(orders, pageViews),
    },
    by_product: byProduct,
    by_day,
  };
}

export interface AdminOrderRow {
  order_id: string;
  created_at: string;
  name: string;
  phone_normalized: string;
  address: string;
  items: Array<{
    sku: string;
    name_fr: string;
    qty: number;
    unit_price: number;
    line_total: number;
  }>;
  items_subtotal: number;
  order_total: number;
  upsell: {
    sku: string;
    name_fr: string;
    unit_price: number;
  } | null;
  currency: string;
  source: string;
  source_url: string;
  context: Record<string, unknown>;
  traffic_valid_ma: boolean;
  ip_country: string | null;
}

export async function listAdminOrders(
  range: DateRange,
  page: number,
  limit: number,
): Promise<{ orders: AdminOrderRow[]; total: number }> {
  const from = range.from.toISOString();
  const to = range.to.toISOString();
  const offset = (page - 1) * limit;

  const countRes = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM (
       SELECT DISTINCT order_id
       FROM order_events
       WHERE event_type = 'order_created'
         AND created_at >= $1::timestamptz AND created_at < $2::timestamptz
         AND (payload->>'traffic_valid_ma')::boolean = TRUE
     ) t`,
    [from, to],
  );
  const total = Number(countRes.rows[0]?.total ?? 0);

  const { rows } = await query<{ order_id: string; payload: AdminOrderRow & Record<string, unknown>; created_at: Date }>(
    `SELECT DISTINCT ON (order_id) order_id, payload, created_at
     FROM order_events
     WHERE event_type = 'order_created'
       AND created_at >= $1::timestamptz AND created_at < $2::timestamptz
       AND (payload->>'traffic_valid_ma')::boolean = TRUE
     ORDER BY order_id, id DESC`,
    [from, to],
  );

  const sorted = rows
    .map((r) => ({
      order_id: r.order_id,
      created_at: r.created_at.toISOString(),
      payload: r.payload,
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const pageRows = sorted.slice(offset, offset + limit);
  const orderIds = pageRows.map((r) => r.order_id);

  const upsellMap = new Map<string, AdminOrderRow["upsell"]>();
  if (orderIds.length > 0) {
    const upsellRes = await query<{ order_id: string; payload: { upsell?: AdminOrderRow["upsell"] } }>(
      `SELECT DISTINCT ON (order_id) order_id, payload
       FROM order_events
       WHERE event_type = 'upsell_added'
         AND order_id = ANY($1::varchar[])
       ORDER BY order_id, id DESC`,
      [orderIds],
    );
    for (const u of upsellRes.rows) {
      if (u.payload?.upsell) upsellMap.set(u.order_id, u.payload.upsell);
    }
  }

  const orders: AdminOrderRow[] = pageRows.map((r) => {
    const p = r.payload as Record<string, unknown>;
    return {
      order_id: r.order_id,
      created_at: String(p.created_at ?? r.created_at),
      name: String(p.name ?? ""),
      phone_normalized: String(p.phone_normalized ?? ""),
      address: String(p.address ?? ""),
      items: (p.items as AdminOrderRow["items"]) ?? [],
      items_subtotal: Number(p.items_subtotal ?? 0),
      order_total: Number(p.order_total ?? 0),
      upsell: upsellMap.get(r.order_id) ?? null,
      currency: String(p.currency ?? "MAD"),
      source: String(p.source ?? "website"),
      source_url: String(p.source_url ?? ""),
      context: (p.context as Record<string, unknown>) ?? {},
      traffic_valid_ma: Boolean(p.traffic_valid_ma),
      ip_country: (p.ip_country as string) ?? null,
    };
  });

  return { orders, total };
}

export async function getAdminOrder(orderId: string): Promise<AdminOrderRow | null> {
  const { rows } = await query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM order_events
     WHERE event_type = 'order_created' AND order_id = $1
     ORDER BY id DESC LIMIT 1`,
    [orderId],
  );
  if (!rows[0]) return null;
  const p = rows[0].payload;

  const upsellRes = await query<{ payload: { upsell?: AdminOrderRow["upsell"] } }>(
    `SELECT payload FROM order_events
     WHERE event_type = 'upsell_added' AND order_id = $1
     ORDER BY id DESC LIMIT 1`,
    [orderId],
  );

  return {
    order_id: orderId,
    created_at: String(p.created_at ?? ""),
    name: String(p.name ?? ""),
    phone_normalized: String(p.phone_normalized ?? ""),
    address: String(p.address ?? ""),
    items: (p.items as AdminOrderRow["items"]) ?? [],
    items_subtotal: Number(p.items_subtotal ?? 0),
    order_total: Number(p.order_total ?? 0),
    upsell: upsellRes.rows[0]?.payload?.upsell ?? null,
    currency: String(p.currency ?? "MAD"),
    source: String(p.source ?? "website"),
    source_url: String(p.source_url ?? ""),
    context: (p.context as Record<string, unknown>) ?? {},
    traffic_valid_ma: Boolean(p.traffic_valid_ma),
    ip_country: (p.ip_country as string) ?? null,
  };
}

export function parseDateRange(
  fromStr: string | undefined,
  toStr: string | undefined,
): DateRange | { error: string } {
  const now = new Date();
  const defaultTo = new Date(now);
  defaultTo.setHours(23, 59, 59, 999);
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  defaultFrom.setHours(0, 0, 0, 0);

  const from = fromStr ? new Date(fromStr) : defaultFrom;
  const to = toStr ? new Date(toStr) : defaultTo;

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { error: "Dates invalides (format ISO attendu)." };
  }
  if (from >= to) {
    return { error: "La date de début doit être avant la date de fin." };
  }
  const maxSpan = 366 * 24 * 60 * 60 * 1000;
  if (to.getTime() - from.getTime() > maxSpan) {
    return { error: "Période maximale : 366 jours." };
  }

  return { from, to };
}
