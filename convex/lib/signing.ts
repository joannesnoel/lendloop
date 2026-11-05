// HMAC-SHA256 helpers built on Web Crypto, which is available in the Convex
// runtime. Used to sign webhooks sent to n8n and to verify requests n8n sends
// back.

const encoder = new TextEncoder();

/** Requests older (or newer) than this are rejected as possible replays. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const SIGNATURE_HEADER = "X-LendLoop-Signature";
export const TIMESTAMP_HEADER = "X-LendLoop-Timestamp";

async function importKey(secret: string, usage: "sign" | "verify") {
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function hmacSha256Hex(
  secret: string,
  message: string,
): Promise<string> {
  const key = await importKey(secret, "sign");
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Constant-time check of a hex HMAC-SHA256 signature. */
export async function verifyHmacSha256Hex(
  secret: string,
  message: string,
  signatureHex: string,
): Promise<boolean> {
  const signature = fromHex(signatureHex);
  if (!signature) return false;
  const key = await importKey(secret, "verify");
  return await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encoder.encode(message),
  );
}

/** The string n8n signs for a request to a Convex HTTP endpoint. */
export function requestSigningString(
  timestamp: string,
  method: string,
  path: string,
  body: string,
): string {
  return `${timestamp}.${method.toUpperCase()}.${path}.${body}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Verifies a request signed as
 *   X-LendLoop-Timestamp: <unix ms>
 *   X-LendLoop-Signature: sha256=<hex hmac of "timestamp.METHOD.path.body">
 * Binding the method and path stops a signature for one endpoint being
 * replayed against another; the timestamp bounds replay of the same request.
 */
export async function verifySignedRequest(
  request: Request,
  body: string,
  secret: string,
  now: number = Date.now(),
): Promise<VerifyResult> {
  const timestamp = request.headers.get(TIMESTAMP_HEADER);
  const header = request.headers.get(SIGNATURE_HEADER);
  if (!timestamp || !header) {
    return { ok: false, reason: "Missing signature headers." };
  }
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, reason: "Timestamp outside the allowed window." };
  }
  const signature = header.startsWith("sha256=") ? header.slice(7) : header;
  const path = new URL(request.url).pathname;
  const valid = await verifyHmacSha256Hex(
    secret,
    requestSigningString(timestamp, request.method, path, body),
    signature,
  );
  return valid ? { ok: true } : { ok: false, reason: "Invalid signature." };
}
