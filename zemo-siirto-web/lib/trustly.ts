// Server-only Trustly client (JSON-RPC 1.1 API, RSA-SHA1 signatures).
//
// Signature = base64( RSA-SHA1( method + uuid + serialize(data) ) ), where serialize() concatenates
// keys in sorted order with their values (nested objects/arrays recursively; null → key only).
// Requests are signed with OUR private key; Trustly's responses and notifications are verified
// with TRUSTLY'S public key; our notification answers are signed with our private key.
import { createSign, createVerify, randomUUID } from "crypto";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const ENDPOINTS = { test: "https://test.trustly.com/api/1", production: "https://trustly.com/api/1" } as const;

function pem(value: string | undefined) {
  // Allow keys stored in env vars with literal "\n".
  return (value || "").replace(/\\n/g, "\n").trim();
}

export function trustlyConfig() {
  const env = process.env.TRUSTLY_ENV === "production" ? "production" : "test";
  return {
    env,
    endpoint: process.env.TRUSTLY_API_URL || ENDPOINTS[env],
    username: process.env.TRUSTLY_USERNAME || "",
    password: process.env.TRUSTLY_PASSWORD || "",
    privateKey: pem(process.env.TRUSTLY_PRIVATE_KEY),
    trustlyPublicKey: pem(process.env.TRUSTLY_PUBLIC_KEY),
    appUrl: (process.env.APP_URL || "").replace(/\/$/, "")
  };
}

/** True when all Trustly settings are present. */
export function trustlyEnabled() {
  const c = trustlyConfig();
  return !!(c.username && c.password && c.privateKey && c.trustlyPublicKey && c.appUrl);
}

export function serializeData(data: Json): string {
  if (data !== null && typeof data === "object") {
    const isArr = Array.isArray(data);
    const obj = data as Record<string, Json>;
    return Object.keys(obj).sort().map(k => {
      const v = obj[k];
      if (v === undefined) throw new Error(`Trustly: undefined value for "${k}"`);
      if (v === null) return k;
      return (isArr ? "" : k) + serializeData(v);
    }).join("");
  }
  return String(data);
}

export const signingString = (method: string, uuid: string, data: Json) => method + uuid + serializeData(data);

export function sign(method: string, uuid: string, data: Json, privateKey = trustlyConfig().privateKey) {
  return createSign("RSA-SHA1").update(signingString(method, uuid, data), "utf8").sign(privateKey, "base64");
}

export function verify(method: string, uuid: string, data: Json, signature: string, publicKey = trustlyConfig().trustlyPublicKey) {
  try {
    return createVerify("RSA-SHA1").update(signingString(method, uuid, data), "utf8").verify(publicKey, signature, "base64");
  } catch {
    return false;
  }
}

/** Call a Trustly API method; verifies Trustly's signature on the response and returns result.data. */
export async function trustlyCall(method: string, data: Record<string, Json>, attributes: Record<string, Json> | null) {
  const c = trustlyConfig();
  const uuid = randomUUID();
  const Data = { ...data, Attributes: attributes, Username: c.username, Password: c.password };
  const body = { method, params: { Data, UUID: uuid, Signature: sign(method, uuid, Data, c.privateKey) }, version: "1.1" };
  const res = await fetch(c.endpoint, {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const json = await res.json().catch(() => null) as
    | { result?: { method: string; uuid: string; signature: string; data: Record<string, Json> }; error?: { message?: string; error?: { data?: { message?: string } } } }
    | null;
  if (json?.result) {
    const r = json.result;
    if (r.uuid !== uuid || !verify(r.method, r.uuid, r.data, r.signature, c.trustlyPublicKey)) {
      throw new Error("Payment provider response could not be verified");
    }
    return r.data;
  }
  const msg = json?.error?.error?.data?.message || json?.error?.message || `HTTP ${res.status}`;
  throw new Error(`Payment provider error: ${msg}`);
}

/** Amount in Trustly's decimal string format, e.g. 63800 → "638.00". */
export const amountString = (cents: number) => (cents / 100).toFixed(2);
/** "638.00" → 63800 (null if not a valid amount). */
export function amountCents(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Signed answer to a notification. Trustly retries until it gets status OK. */
export function notificationResponse(method: string, uuid: string, status: "OK" | "FAILED") {
  const data = { status };
  return { result: { signature: sign(method, uuid, data), uuid, method, data }, version: "1.1" };
}
