import type { IncomingMessage, ServerResponse } from "node:http";

export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<any> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      const e: any = new Error(`Body too large (> ${maxBytes} bytes)`);
      e.code = "ERR_BODY_TOO_LARGE";
      throw e;
    }
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

export function writeJson(res: ServerResponse, status: number, obj: any): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

export function writeError(res: ServerResponse, status: number, message: string, code?: string): void {
  writeJson(res, status, {
    error: {
      message,
      ...(code && { code }),
    },
  });
}

export async function pipeFetchResponse(upstreamResp: Response, res: ServerResponse): Promise<void> {
  // Pass through key headers only. Avoid forwarding content-length if streaming.
  const ct = upstreamResp.headers.get("content-type") ?? "application/json";
  const headers: Record<string, string> = { "content-type": ct };

  const cache = upstreamResp.headers.get("cache-control");
  if (cache) headers["cache-control"] = cache;

  // Forward other useful headers
  const xRequestId = upstreamResp.headers.get("x-request-id");
  if (xRequestId) headers["x-request-id"] = xRequestId;

  res.writeHead(upstreamResp.status ?? 200, headers);

  if (!upstreamResp.body) {
    res.end();
    return;
  }

  const reader = upstreamResp.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        res.write(Buffer.from(value));
      }
    }
  } finally {
    res.end();
  }
}

export function getInboundAuth(req: IncomingMessage): string | undefined {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.trim()) return auth;
  const xApiKey = req.headers["x-api-key"];
  if (typeof xApiKey === "string" && xApiKey.trim()) {
    // Don't add "Bearer " if x-api-key already has it
    if (xApiKey.toLowerCase().startsWith("bearer ")) {
      return xApiKey;
    }
    return `Bearer ${xApiKey}`;
  }
  return undefined;
}
