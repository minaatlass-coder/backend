import { query } from "../db.js";

export interface StoredOrderSnapshot {
  name?: string;
  address?: string;
  phone_normalized?: string;
}

export async function saveOrderEvent(
  eventType: string,
  orderId: string | null,
  payload: unknown,
): Promise<void> {
  await query(
    `INSERT INTO order_events (event_type, order_id, payload)
     VALUES ($1, $2, $3::jsonb)`,
    [eventType, orderId, JSON.stringify(payload)],
  );
}

export async function getOrderSnapshot(
  orderId: string,
): Promise<StoredOrderSnapshot | null> {
  const { rows } = await query<{ payload: StoredOrderSnapshot }>(
    `SELECT payload
     FROM order_events
     WHERE event_type = 'order_created'
       AND order_id = $1
     ORDER BY id DESC
     LIMIT 1`,
    [orderId],
  );
  return rows[0]?.payload ?? null;
}
