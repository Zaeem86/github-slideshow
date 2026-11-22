// Trustly sends payment notifications here (NotificationURL). We:
//   1. verify Trustly's RSA signature – unsigned or forged requests are rejected,
//   2. record the event in the database (idempotent: Trustly retries until it gets OK),
//   3. answer with our signed {status: "OK"}.
// The field names inside params.data (notificationid, messageid, orderid, amount, currency) follow
// Trustly's notification format; confirm against your Trustly integration docs before going live.
import { NextResponse } from "next/server";
import { amountCents, notificationResponse, trustlyEnabled, verify } from "@/lib/trustly";
import { serviceRpc } from "@/lib/supabase/service";

type Notification = { method?: string; params?: { signature?: string; uuid?: string; data?: Record<string, unknown> }; version?: string };

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export async function POST(request: Request) {
  if (!trustlyEnabled()) return NextResponse.json({ error: "Trustly is not configured" }, { status: 503 });

  let n: Notification;
  try { n = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const method = n.method, uuid = n.params?.uuid, data = n.params?.data, signature = n.params?.signature;
  if (!method || !uuid || !data || !signature) return NextResponse.json({ error: "Malformed notification" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!verify(method, uuid, data as any, signature)) {
    console.warn("Trustly notification with invalid signature rejected", { method, uuid });
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  try {
    const outcome = await serviceRpc<string>("record_payment_event", {
      p_provider: "trustly",
      p_notification_id: str(data.notificationid) ?? `${method}:${uuid}`,
      p_method: method,
      p_message_id: str(data.messageid),
      p_provider_order_id: str(data.orderid),
      p_amount_cents: amountCents(data.amount),
      p_currency: str(data.currency),
      p_payload: n
    });
    if (outcome !== "paid" && outcome !== "pending" && outcome !== "duplicate") {
      console.warn("Trustly notification recorded with outcome", outcome, { method, orderid: data.orderid });
    }
  } catch (e) {
    // Not answering OK makes Trustly retry later.
    console.error("Trustly notification could not be recorded", e);
    return NextResponse.json(notificationResponse(method, uuid, "FAILED"), { status: 500 });
  }
  return NextResponse.json(notificationResponse(method, uuid, "OK"));
}
