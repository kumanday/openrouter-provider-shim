# openrouter-provider-shim

Local npx-runnable shim that enforces OpenRouter provider routing (e.g., Fireworks-only) for AI agent tools that cannot configure it natively. **Primarily for Claude Code** - other tools like OpenCode have native OpenRouter provider support.

## Why this shim exists

Some AI agent harnesses can point at an OpenAI-compatible base URL, but they cannot attach OpenRouter's per-request `provider` routing object. This includes **Claude Code**, which uses the Anthropic Messages API and has no way to specify provider preferences.

OpenRouter supports a `provider` object for routing preferences including `only`, `order`, `ignore`, `sort` (price, throughput, latency), performance thresholds, and max price. This shim injects these fields server-side, so end users do not need OpenRouter account-wide settings.

**Note:** Tools like OpenCode have native OpenRouter provider configuration and don't need this shim. See [When You DON'T Need This Shim](#when-you-dont-need-this-shim) below.

## Features

- **Multi-protocol support**: Anthropic Messages API, OpenAI Chat Completions, and OpenAI Responses API
- **Provider routing enforcement**: Merge, override, or strict modes for provider policies
- **Flexible authentication**: Passthrough or upstream-key auth modes
- **Zero dependencies for runtime**: Uses only Node.js built-ins
- **Privacy-first logging**: Logs metadata only, never prompt content
- **Cross-platform**: Works on macOS, Linux, and Windows

## Installation

```bash
# Run without installing
npx openrouter-provider-shim serve --port 8787 --provider-only fireworks --sort throughput --no-fallbacks

# Or install globally
npm install -g openrouter-provider-shim
openrouter-provider-shim serve --port 8787
```

## Quick Start

### Claude Code

**Option 1: Automatic key substitution (recommended)**

If you have both `ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY` set, the shim will automatically detect and substitute your Anthropic key with your OpenRouter key:

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
export ANTHROPIC_API_KEY="sk-ant-..."  # Can keep this set for other tools

# For best results with Claude Code, use an Anthropic model:
export ANTHROPIC_MODEL="anthropic/claude-3.5-sonnet"
# Or for non-Claude models (streaming disabled, auto-retry enabled):
# export ANTHROPIC_MODEL="moonshotai/kimi-k2.5"

npx openrouter-provider-shim serve --port 8787 --provider-only fireworks --sort throughput --no-fallbacks &
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"

claude
```

**Option 2: Explicit configuration**

If you prefer explicit control or the automatic substitution isn't working:

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
npx openrouter-provider-shim serve --port 8787 --provider-only fireworks --sort throughput --no-fallbacks &

export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
export ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY"
export ANTHROPIC_API_KEY=""  # Must be empty to use AUTH_TOKEN
export ANTHROPIC_MODEL="moonshotai/kimi-k2.5"

claude
```

### Known Limitations

**Rate limiting:** The shim includes automatic retry with custom backoff delays for Claude Code (detected by its use of the Anthropic Messages API). Retries use delays: 1s, 2s, 4s, 8s, 12s, 18s, 24s, 32s. If you hit rate limits:
- Add your own Fireworks API key to OpenRouter (BYOK) at https://openrouter.ai/settings/integrations
- Use the `--provider-order` option to allow fallback providers
- Wait a moment between requests and manually retry or prompt "Continue"

### When You DON'T Need This Shim

Some AI tools have **native OpenRouter provider routing support** and don't need this shim:

**OpenCode** - Has built-in OpenRouter provider configuration. In `~/.config/opencode/opencode.json`:
```json
{
  "provider": {
    "openrouter": {
      "models": {
        "moonshotai/kimi-k2.5": {
          "options": {
            "provider": {
              "order": ["fireworks"],
              "allow_fallbacks": false
            }
          }
        }
      }
    }
  }
}
```

### When You DO Need This Shim

Use this shim for tools that **cannot** configure OpenRouter's per-request provider routing:

#### Claude Code (Primary Use Case)
Uses Anthropic Messages API - cannot set OpenRouter provider routing. This is the primary use case for this shim.

```bash
export OPENROUTER_API_KEY="your-api-key"
npx openrouter-provider-shim serve --port 8787 --provider-only fireworks

export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
export ANTHROPIC_MODEL="moonshotai/kimi-k2.5"
claude
```

#### OpenHands
OpenHands documentation shows OpenRouter as a provider and using an OpenAI proxy via Base URL + Custom Model, but they **do NOT document** a way to pass OpenRouter per-request provider routing (`provider.order/only/allow_fallbacks`). If you need deterministic routing to Fireworks for Kimi K2.5, use this shim as an OpenAI-compatible base URL:

```bash
# In OpenHands settings:
# Base URL: http://127.0.0.1:8787/v1
# Model: moonshotai/kimi-k2.5
# API Key: (your OpenRouter API key)
```

**Note:** OpenHands mentions LiteLLM proxy, but you must set up and run LiteLLM proxy yourself - it's not "always running".

#### Droid (Factory)
Factory BYOK supports OpenRouter via `generic-chat-completion-api`. Their docs also support `extraArgs` for provider-specific request fields which **can** inject OpenRouter `provider: { order: ["fireworks"], allow_fallbacks: false }` without a shim.

However, testing shows **tool calls are NOT working** with Droid's native OpenRouter integration.

Try the shim as an alternative path:

```bash
# In Droid config:
# baseUrl: http://127.0.0.1:8787/v1
# provider: generic-chat-completion-api
# model: moonshotai/kimi-k2.5
```

You can also try the Anthropic `/v1/messages` path via the shim to test whether the issue is Droid's tool-call wiring vs provider behavior:

```bash
# In Droid config (alternative):
# baseUrl: http://127.0.0.1:8787
# provider: anthropic-messages
# model: moonshotai/kimi-k2.5
```

## CLI Commands

### `serve` (default)

Starts the local shim server.

```bash
npx openrouter-provider-shim serve \
  --port 8787 \
  --provider-only fireworks \
  --sort throughput \
  --no-fallbacks \
  --auth-mode passthrough
```

### `doctor`

Validates config and checks connectivity to OpenRouter.

```bash
npx openrouter-provider-shim doctor --provider-only fireworks
```

### `print-env`

Prints copy-paste environment variables for Claude Code and OpenAI clients.

```bash
npx openrouter-provider-shim print-env --port 8787
```

## Configuration

Configuration can be provided via:
1. CLI flags (highest priority)
2. Environment variables
3. Config file (lowest priority)

### Authentication

The shim supports several authentication modes:

**passthrough mode (default)**
- Forwards the `Authorization` header from the inbound request to OpenRouter
- **Smart substitution**: If the inbound auth looks like an Anthropic API key (starts with `sk-ant-`) and you have `OPENROUTER_API_KEY` set, the shim automatically substitutes it with your OpenRouter key
- This allows you to keep `ANTHROPIC_API_KEY` set for other tools while using OpenRouter via the shim

**upstream-key mode**
- Always uses the configured OpenRouter API key, ignoring inbound auth
- Useful when you don't want clients to know the OpenRouter key

```bash
# Default passthrough with smart substitution
npx openrouter-provider-shim serve --port 8787

# Explicit upstream key (never use inbound auth)
npx openrouter-provider-shim serve --port 8787 --auth-mode upstream-key --upstream-key "sk-or-v1-..."
```

### CLI Options

| Option | Description |
|--------|-------------|
| `--config <path>` | Path to config JSON file |
| `--host <host>` | Host to bind (default: 127.0.0.1) |
| `--port <port>` | Port to bind (default: 8787) |
| `--merge-mode <mode>` | Provider merge mode: merge, override, strict |
| `--provider-only <list>` | Comma-separated list of allowed providers |
| `--provider-order <list>` | Comma-separated provider priority order |
| `--provider-ignore <list>` | Comma-separated list of providers to skip |
| `--sort <sort>` | Sort by: price, throughput, latency |
| `--no-fallbacks` | Disable fallback providers |
| `--require-parameters` | Require providers to support all parameters |
| `--data-collection <allow\|deny>` | Data collection policy |
| `--zdr` | Enforce Zero Data Retention |
| `--quantizations <list>` | Comma-separated quantization list |
| `--auth-mode <mode>` | passthrough or upstream-key |
| `--upstream-key <key>` | OpenRouter API key |
| `--local-api-key <key>` | Local authentication key |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | Your OpenRouter API key |
| `SHIM_HOST` | Host to bind |
| `SHIM_PORT` | Port to bind |
| `SHIM_AUTH_MODE` | passthrough or upstream-key |
| `SHIM_LOCAL_API_KEY` | Local authentication key |
| `SHIM_MERGE_MODE` | merge, override, or strict |
| `SHIM_PROVIDER_ONLY` | Comma-separated allowed providers |
| `SHIM_PROVIDER_ORDER` | Comma-separated provider order |
| `SHIM_PROVIDER_IGNORE` | Comma-separated ignored providers |
| `SHIM_PROVIDER_SORT` | price, throughput, or latency |
| `SHIM_PROVIDER_ALLOW_FALLBACKS` | true or false |
| `SHIM_PROVIDER_REQUIRE_PARAMETERS` | true or false |
| `SHIM_PROVIDER_DATA_COLLECTION` | allow or deny |
| `SHIM_PROVIDER_ZDR` | true or false |
| `SHIM_PROVIDER_QUANTIZATIONS` | Comma-separated quantizations |
| `SHIM_PROVIDER_PREFERRED_MIN_THROUGHPUT` | Number or JSON thresholds |
| `SHIM_PROVIDER_PREFERRED_MAX_LATENCY` | Number or JSON thresholds |
| `SHIM_PROVIDER_MAX_PRICE` | JSON: `{"prompt":1.0,"completion":4.0}` |

### Config File

Create a `shim-config.json`:

```json
{
  "host": "127.0.0.1",
  "port": 8787,
  "merge_mode": "merge",
  "policy": {
    "only": ["fireworks"],
    "sort": "throughput",
    "allow_fallbacks": false
  },
  "auth_mode": "passthrough",
  "log_level": "info"
}
```

Run with: `npx openrouter-provider-shim serve --config shim-config.json`

## Merge Modes

### merge (default)
- If request has no `provider`, inject the configured policy
- If request has `provider`, merge missing fields from policy without overriding

### override
- Replace request `provider` entirely with policy `provider` (hard enforcement)

### strict
- If request `provider` exists and differs from policy for any enforced fields, reject with HTTP 422
- Useful for regulated enterprise policies

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /v1/messages` | Anthropic Messages API |
| `POST /v1/chat/completions` | OpenAI Chat Completions API |
| `POST /v1/responses` | OpenAI Responses API |
| `GET /v1/models` | List available models (pass-through) |
| `GET /healthz` | Health check |
| `GET /version` | Version information |
| `GET /config` | Current configuration (sanitized) |

## Testing

```bash
# Chat Completions
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "moonshotai/kimi-k2.5",
    "messages": [{"role":"user","content":"Say hello"}],
    "stream": false
  }'

# Anthropic Messages
curl http://127.0.0.1:8787/v1/messages \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "moonshotai/kimi-k2.5",
    "max_tokens": 256,
    "messages": [{"role":"user","content":"Hello from anthropic messages"}]
  }'

# Responses API
curl http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "moonshotai/kimi-k2.5",
    "input": "Hello from responses"
  }'
```

## License

MIT
