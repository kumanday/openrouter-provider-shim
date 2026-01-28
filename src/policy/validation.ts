import type { IncomingMessage } from "node:http";

export interface ValidationError {
  code: string;
  message: string;
  status: number;
}

export function validateLocalAuth(
  req: IncomingMessage,
  localApiKey?: string
): ValidationError | null {
  if (!localApiKey) return null;

  const auth = req.headers["authorization"];
  const xApiKey = req.headers["x-api-key"];

  let providedKey: string | undefined;

  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    providedKey = auth.slice(7);
  } else if (typeof xApiKey === "string") {
    providedKey = xApiKey;
  }

  if (providedKey !== localApiKey) {
    return {
      code: "ERR_UNAUTHORIZED",
      message: "Unauthorized: invalid or missing local API key",
      status: 401,
    };
  }

  return null;
}

export function validateMethod(
  method: string,
  pathname: string
): ValidationError | null {
  // GET is allowed for /v1/models passthrough
  if (method === "GET" && pathname === "/v1/models") return null;
  // POST is allowed for all API endpoints
  if (method === "POST") return null;

  return {
    code: "ERR_METHOD_NOT_ALLOWED",
    message: `Method ${method} not allowed for ${pathname}`,
    status: 405,
  };
}

export function validateBodySize(size: number, maxBytes: number): ValidationError | null {
  if (size > maxBytes) {
    return {
      code: "ERR_BODY_TOO_LARGE",
      message: `Request body too large: ${size} bytes (max ${maxBytes})`,
      status: 413,
    };
  }
  return null;
}
