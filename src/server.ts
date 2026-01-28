import http, { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { readJsonBody, writeJson, writeError, pipeFetchResponse, getInboundAuth } from "./util/http.js";
import { applyProviderPolicy } from "./policy/providerPolicy.js";
import { validateLocalAuth, validateMethod } from "./policy/validation.js";
import { makeLogger } from "./util/log.js";
import { redactBody } from "./util/redact.js";
import { getVersion } from "./util/version.js";
import type { ShimConfig } from "./config.js";

const OPENROUTER_BASE_V1 = "https://openrouter.ai/api/v1";

function upstreamUrlForPath(pathname: string, config: ShimConfig): string | null {
  if (pathname === "/v1/messages" && config.enable_anthropic) {
    return `${OPENROUTER_BASE_V1}/messages`;
  }
  if (pathname === "/v1/chat/completions" && config.enable_chat) {
    return `${OPENROUTER_BASE_V1}/chat/completions`;
  }
  if (pathname === "/v1/responses" && config.enable_responses) {
    return `${OPENROUTER_BASE_V1}/responses`;
  }
  if (pathname === "/v1/models") {
    return `${OPENROUTER_BASE_V1}/models`;
  }
  return null;
}

function getUpstreamAuth(req: IncomingMessage, cfg: ShimConfig): string | undefined {
  if (cfg.auth_mode === "upstream-key") {
    if (!cfg.upstream_api_key) return undefined;
    return `Bearer ${cfg.upstream_api_key}`;
  }
  // passthrough
  return getInboundAuth(req) ?? (cfg.upstream_api_key ? `Bearer ${cfg.upstream_api_key}` : undefined);
}

export function startServer(cfg: ShimConfig): http.Server {
  const log = makeLogger(cfg);

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? "/", `http://${cfg.host}:${cfg.port}`);

    try {
      // Convenience endpoints
      if (req.method === "GET" && url.pathname === "/healthz") {
        return writeJson(res, 200, { ok: true, timestamp: new Date().toISOString() });
      }

      if (req.method === "GET" && url.pathname === "/version") {
        return writeJson(res, 200, {
          name: "openrouter-provider-shim",
          version: cfg._runtime.version,
        });
      }

      if (req.method === "GET" && url.pathname === "/config") {
        // Return sanitized config (never includes upstream_api_key)
        const { upstream_api_key, ...safe } = cfg as any;
        return writeJson(res, 200, safe);
      }

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        res.writeHead(200, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "authorization, content-type, x-api-key",
        });
        res.end();
        return;
      }

      // Find upstream URL
      const upstream = upstreamUrlForPath(url.pathname, cfg);
      if (!upstream) {
        return writeError(res, 404, "Not found");
      }

      // Local auth (optional)
      if (cfg.local_api_key) {
        const authError = validateLocalAuth(req, cfg.local_api_key);
        if (authError) {
          return writeError(res, authError.status, authError.message, authError.code);
        }
      }

      // Method validation
      const methodError = validateMethod(req.method ?? "GET", url.pathname);
      if (methodError) {
        return writeError(res, methodError.status, methodError.message, methodError.code);
      }

      // Get upstream auth
      const upstreamAuth = getUpstreamAuth(req, cfg);
      if (!upstreamAuth) {
        return writeError(res, 401, "Missing upstream authentication", "ERR_MISSING_AUTH");
      }

      // For GET /v1/models, no body to process
      let body: any = undefined;
      if (req.method === "POST") {
        try {
          body = await readJsonBody(req, cfg.max_body_bytes);
        } catch (err: any) {
          if (err.code === "ERR_BODY_TOO_LARGE") {
            return writeError(res, 413, err.message, "ERR_BODY_TOO_LARGE");
          }
          return writeError(res, 400, err.message, "ERR_INVALID_BODY");
        }

        // Log body if configured
        if (cfg.log_body) {
          const bodyToLog = cfg.redact_body ? redactBody(body) : body;
          log.debug({ body: bodyToLog }, "request body");
        }

        // Apply provider policy
        try {
          body = applyProviderPolicy(body, cfg.policy, cfg.merge_mode, cfg._runtime.soft_enforce_only);
        } catch (err: any) {
          if (err.code === "ERR_PROVIDER_CONFLICT") {
            return writeError(res, 422, err.message, err.code);
          }
          throw err;
        }

        // Optional OpenRouter debug injection for chat completions only (development)
        if (cfg._runtime.debug_openrouter_upstream_body && url.pathname === "/v1/chat/completions") {
          body.stream = true;
          body.debug = { ...(body.debug ?? {}), echo_upstream_body: true };
        }
      }

      // Prepare headers for upstream request
      const headers: Record<string, string> = {
        "authorization": upstreamAuth,
        "content-type": "application/json",
      };

      // Optional attribution headers for OpenRouter analytics
      if (cfg.add_attribution_headers) {
        if (cfg.attribution?.referer) headers["http-referer"] = cfg.attribution.referer;
        if (cfg.attribution?.title) headers["x-title"] = cfg.attribution.title;
      }

      // Make upstream request
      let upstreamResp: Response;
      try {
        upstreamResp = await fetch(upstream, {
          method: req.method,
          headers,
          body: req.method === "POST" ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(cfg.request_timeout_ms),
        });
      } catch (err: any) {
        log.error({ err: err.message, upstream }, "upstream request failed");
        return writeError(res, 502, `Upstream request failed: ${err.message}`, "ERR_UPSTREAM_FAILED");
      }

      // Pipe response back to caller
      await pipeFetchResponse(upstreamResp, res);

      // Log request metadata (never log prompt content by default)
      const model = body?.model ?? body?.models?.[0] ?? "unknown";
      log.info({
        path: url.pathname,
        method: req.method,
        status: upstreamResp.status,
        ms: Date.now() - started,
        model,
      }, "request");

    } catch (err: any) {
      const ms = Date.now() - started;
      const msg = err?.message ?? String(err);
      writeError(res, 500, msg, "ERR_INTERNAL");
      log.error({ ms, err: msg, path: url.pathname }, "error");
    }
  });

  server.listen(cfg.port, cfg.host, () => {
    log.info({
      host: cfg.host,
      port: cfg.port,
      upstream: cfg.upstream,
      merge_mode: cfg.merge_mode,
      auth_mode: cfg.auth_mode,
      enable_anthropic: cfg.enable_anthropic,
      enable_chat: cfg.enable_chat,
      enable_responses: cfg.enable_responses,
    }, "server started");
  });

  return server;
}
