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

// Anthropic model names that Claude Code uses internally (for title generation, etc.)
// These need to be remapped to the user's preferred model
const ANTHROPIC_MODEL_PREFIXES = ["claude-", "claude-haiku-", "claude-sonnet-", "claude-opus-"];

function isAnthropicModel(model: string): boolean {
  return ANTHROPIC_MODEL_PREFIXES.some(prefix => model.toLowerCase().startsWith(prefix));
}

function getTargetModel(): string {
  // Use ANTHROPIC_MODEL env var (what the user configured for Claude Code)
  // Fall back to a sensible default
  return process.env.ANTHROPIC_MODEL || "moonshotai/kimi-k2.5";
}

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

function looksLikeAnthropicKey(auth: string): boolean {
  // Anthropic API keys typically start with "sk-ant-" or "sk-ant-api-"
  const key = auth.replace(/^Bearer\s+/i, "");
  return key.startsWith("sk-ant");
}

function looksLikeOpenRouterKey(auth: string): boolean {
  // OpenRouter API keys start with "sk-or-"
  const key = auth.replace(/^Bearer\s+/i, "");
  return key.startsWith("sk-or-");
}

function getUpstreamAuth(req: IncomingMessage, cfg: ShimConfig): string | undefined {
  if (cfg.auth_mode === "upstream-key") {
    if (!cfg.upstream_api_key) return undefined;
    return `Bearer ${cfg.upstream_api_key}`;
  }

  // passthrough mode with smart substitution
  const inboundAuth = getInboundAuth(req);

  if (inboundAuth) {
    // If inbound auth looks like an Anthropic key and we have an OpenRouter key,
    // substitute it automatically (common case: user has ANTHROPIC_API_KEY set for
    // other tools but wants to use OpenRouter via this shim)
    const isAnthropicKey = looksLikeAnthropicKey(inboundAuth);
    if (isAnthropicKey && cfg.upstream_api_key) {
      return `Bearer ${cfg.upstream_api_key}`;
    }
    // If it's already an OpenRouter key or some other key, pass it through
    return inboundAuth;
  }

  // No inbound auth, fall back to configured upstream key
  return cfg.upstream_api_key ? `Bearer ${cfg.upstream_api_key}` : undefined;
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
        
        // Force non-streaming mode only for Claude Code (Anthropic Messages API)
        // Claude Code has issues with SSE streaming from non-Claude models via OpenRouter
        // OpenAI-compatible clients (Droid, etc.) should use streaming normally
        const isAnthropicEndpoint = url.pathname === "/v1/messages";
        if (body?.stream === true && isAnthropicEndpoint) {
          body.stream = false;
          if (cfg.log_level === "debug") {
            log.debug({}, "disabled streaming for Anthropic API endpoint");
          }
        }

        // Debug: log model name and tools for troubleshooting
        if (cfg.log_level === "debug") {
          log.debug({ 
            model: body?.model, 
            modelLength: body?.model?.length,
            hasTools: !!body?.tools?.length,
            toolCount: body?.tools?.length ?? 0,
            toolNames: body?.tools?.map((t: any) => t.name),
            stream: body?.stream,
          }, "request details");
        }

        // Remap Anthropic model names to user's preferred model
        // Claude Code sends internal model names (claude-haiku, etc.) for helper functions
        if (body?.model && isAnthropicModel(body.model)) {
          const originalModel = body.model;
          const targetModel = getTargetModel();
          if (originalModel !== targetModel) {
            body.model = targetModel;
            if (cfg.log_level === "debug") {
              log.debug({ originalModel, targetModel }, "remapped model");
            }
          }
        }

        // Truncate metadata.user_id if it's too long (OpenRouter has 128 char limit)
        if (body?.metadata?.user_id && typeof body.metadata.user_id === "string") {
          if (body.metadata.user_id.length > 128) {
            if (cfg.log_level === "debug") {
              log.debug({ 
                originalLength: body.metadata.user_id.length,
                truncated: body.metadata.user_id.slice(0, 128)
              }, "truncating user_id");
            }
            body.metadata.user_id = body.metadata.user_id.slice(0, 128);
          }
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

      // Debug: Check auth header
      if (cfg.log_level === "debug") {
        log.debug({ 
          authLength: upstreamAuth?.length ?? 0, 
          authPrefix: upstreamAuth?.slice(0, 30),
          upstreamKeyLength: cfg.upstream_api_key?.length ?? 0,
        }, "auth header");
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

      // Make upstream request with retry logic for rate limits
      let upstreamResp: Response;
      let retries = 0;
      
      // Custom retry delays: 1, 2, 4, 8, 12, 18, 24, 32 seconds
      const retryDelays = [1000, 2000, 4000, 8000, 12000, 18000, 24000, 32000];
      
      // Auto-enable retry for Claude Code (detected by Anthropic Messages API endpoint)
      // Claude Code uses /v1/messages, while other harnesses use /v1/chat/completions
      const isClaudeCode = url.pathname === "/v1/messages";
      const maxRetries = isClaudeCode ? retryDelays.length : 0;
      
      while (true) {
        try {
          const requestBody = req.method === "POST" ? JSON.stringify(body) : undefined;
          
          // Debug: log the actual request body for troubleshooting
          if (cfg.log_level === "debug" && requestBody) {
            log.debug({ 
              url: upstream, 
              bodySize: requestBody.length,
              bodyPreview: requestBody.slice(0, 1000),
            }, "upstream request body");
          }
          
          upstreamResp = await fetch(upstream, {
            method: req.method,
            headers,
            body: requestBody,
            signal: AbortSignal.timeout(cfg.request_timeout_ms),
          });
          
          // If we get a 429 and retries are enabled, retry with custom delays
          if (upstreamResp.status === 429 && retries < maxRetries) {
            const delayMs = retryDelays[retries];
            retries++;
            log.info({ retries, delayMs, status: 429, isClaudeCode }, "rate limited, retrying");
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }
          
          break; // Success or non-retryable error
        } catch (err: any) {
          log.error({ err: err.message, upstream }, "upstream request failed");
          return writeError(res, 502, `Upstream request failed: ${err.message}`, "ERR_UPSTREAM_FAILED");
        }
      }

      // For error responses or non-streaming responses with tools, capture the body for logging
      let responseBodyForLogging: string | undefined;
      const isStreaming = body?.stream === true;
      const hasTools = !!body?.tools?.length;
      
      if (cfg.log_level === "debug" && (upstreamResp.status >= 400 || (!isStreaming && hasTools))) {
        try {
          responseBodyForLogging = await upstreamResp.clone().text();
        } catch {
          // Ignore clone/read errors
        }
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
      
      // Log response details for debugging
      if (responseBodyForLogging) {
        log.debug({ responseBody: responseBodyForLogging.slice(0, 2000) }, "upstream response");
      }

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
