# API Reference

## Server Endpoints

The shim exposes these HTTP endpoints:

### Anthropic Messages API

```
POST /v1/messages
```

Proxies to OpenRouter's Anthropic-compatible endpoint. Used by Claude Code.

**Request Body:** Anthropic Messages API format

```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 4096,
  "messages": [
    {"role": "user", "content": "Hello!"}
  ]
}
```

**Notes:**
- Model names are automatically remapped based on `ANTHROPIC_MODEL` environment variable
- Streaming is supported
- Rate limit retries use custom backoff for Claude Code

### OpenAI Chat Completions

```
POST /v1/chat/completions
```

Standard OpenAI chat completions endpoint.

**Request Body:** OpenAI Chat Completions format

```json
{
  "model": "moonshotai/kimi-k2.5",
  "messages": [
    {"role": "user", "content": "Hello!"}
  ]
}
```

### OpenAI Responses API

```
POST /v1/responses
```

OpenAI Responses API endpoint.

### List Models

```
GET /v1/models
```

Returns available models from OpenRouter. Pass-through with no modification.

### Health Check

```
GET /healthz
```

Returns server status.

**Response:**

```json
{
  "status": "ok"
}
```

### Version

```
GET /version
```

Returns shim version information.

**Response:**

```json
{
  "version": "1.0.0"
}
```

### Configuration

```
GET /config
```

Returns current configuration (sanitized, API keys redacted).

**Response:**

```json
{
  "port": 8787,
  "host": "127.0.0.1",
  "mergeMode": "merge",
  "authMode": "passthrough",
  "provider": {
    "only": ["fireworks"],
    "sort": "throughput"
  }
}
```

## Provider Object

The shim injects a `provider` object into requests to OpenRouter. This controls routing behavior.

### Full Provider Object

```json
{
  "provider": {
    "allow_fallbacks": false,
    "require_parameters": true,
    "data_collection": "deny",
    "order": ["fireworks", "together"],
    "ignore": ["openai"],
    "quantizations": ["fp8", "fp16"],
    "sort": "throughput"
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `allow_fallbacks` | boolean | Allow OpenRouter to use fallback providers |
| `require_parameters` | boolean | Require providers to support all request parameters |
| `data_collection` | string | `"allow"` or `"deny"` training data collection |
| `order` | string[] | Provider preference order (highest first) |
| `ignore` | string[] | Providers to exclude |
| `quantizations` | string[] | Allowed quantization types (fp8, fp16, int8, etc.) |
| `sort` | string | Sort providers by `price`, `throughput`, or `latency` |

## Authentication Headers

### Client to Shim

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes* | Bearer token (API key). *Not required if `SHIM_LOCAL_API_KEY` is not set |
| `Content-Type` | Yes | `application/json` |

### Shim to OpenRouter

The shim forwards requests to `https://openrouter.ai/api/v1` with:

| Header | Value |
|--------|-------|
| `Authorization` | `Bearer <OPENROUTER_API_KEY>` |
| `Content-Type` | `application/json` |
| `HTTP-Referer` | `https://github.com//openrouter-provider-shim` |
| `X-Title` | `openrouter-provider-shim` |

## Rate Limiting & Retries

The shim implements retry logic for rate-limited requests:

### Claude Code

- Retries on HTTP 429 (rate limit) errors
- Exponential backoff: 1s, 2s, 4s, 8s, 12s, 18s, 24s, 32s
- Maximum 8 retry attempts

### Other Clients

- Standard OpenRouter rate limiting applies
- No special retry handling (clients should handle 429s)

## Error Responses

| Status | Cause |
|--------|-------|
| 400 | Invalid JSON in request body |
| 401 | Missing or invalid local API key |
| 404 | Unknown endpoint |
| 422 | Request conflicts with policy (strict mode) |
| 429 | Rate limited by OpenRouter |
| 500 | Internal server error |
| 502/503/504 | OpenRouter API error |

## Logging

The shim logs all requests (content is never logged):

```json
{"timestamp":"2024-01-15T10:30:00Z","level":"info","message":"POST /v1/chat/completions 200 145ms moonshotai/kimi-k2.5"}
```

Log levels: `silent`, `error`, `info`, `debug`

Enable debug logging:

```bash
DEBUG=1 npx openrouter-provider-shim serve
```
