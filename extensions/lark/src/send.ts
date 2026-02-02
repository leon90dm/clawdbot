import { createHmac } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ERROR_CHARS = 300;

function normalizeSecret(secret: string | undefined): string | null {
  const trimmed = secret?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function computeLarkWebhookSign(params: { timestamp: string; secret: string }): string {
  const stringToSign = `${params.timestamp}\n${params.secret}`;
  return createHmac("sha256", params.secret).update(stringToSign).digest("base64");
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readErrorResponse(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    const collapsed = text.replace(/\s+/g, " ").trim();
    if (!collapsed) {
      return undefined;
    }
    if (collapsed.length <= MAX_ERROR_CHARS) {
      return collapsed;
    }
    return `${collapsed.slice(0, MAX_ERROR_CHARS)}…`;
  } catch {
    return undefined;
  }
}

export async function sendLarkWebhookMessage(params: {
  webhookUrl: string;
  text: string;
  secret?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}): Promise<{ ok: true; response: unknown } | { ok: false; error: string }> {
  const webhookUrl = params.webhookUrl.trim();
  if (!webhookUrl) {
    return { ok: false, error: "Lark webhookUrl is required." };
  }

  const fetchFn = params.fetchFn ?? fetch;
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const secret = normalizeSecret(params.secret);
  const timestamp = String(Math.floor(Date.now() / 1000));

  const payload: Record<string, unknown> = {
    msg_type: "text",
    content: { text: params.text },
  };

  if (secret) {
    payload.timestamp = timestamp;
    payload.sign = computeLarkWebhookSign({ timestamp, secret });
  }

  const res = await fetchWithTimeout(
    webhookUrl,
    {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    },
    timeoutMs,
    fetchFn,
  );

  if (!res.ok) {
    const details = await readErrorResponse(res);
    return {
      ok: false,
      error: `Lark webhook request failed: HTTP ${res.status}${details ? ` (${details})` : ""}`,
    };
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = await res.text().catch(() => null);
  }

  const statusCode = (json as { StatusCode?: unknown } | null)?.StatusCode;
  if (typeof statusCode === "number" && statusCode !== 0) {
    const statusMessage = (json as { StatusMessage?: unknown } | null)?.StatusMessage;
    const msg = typeof statusMessage === "string" ? statusMessage.trim() : "";
    return {
      ok: false,
      error: `Lark webhook rejected message: ${statusCode}${msg ? ` (${msg})` : ""}`,
    };
  }

  return { ok: true, response: json };
}
