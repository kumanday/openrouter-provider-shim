# Usage Examples

## Claude Code with Fireworks

Route Claude Code through Fireworks for lower latency:

```bash
# Set your keys
export OPENROUTER_API_KEY="sk-or-v1-..."
export ANTHROPIC_API_KEY="sk-ant-..."  # Optional, auto-substituted

# Start the shim
npx openrouter-provider-shim serve --port 8787 --provider-only fireworks --sort throughput &

# Configure Claude Code
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
export ANTHROPIC_MODEL="anthropic/claude-sonnet-4-5-20250929"

# Launch Claude Code
claude
```

## Claude Code with Multiple Providers

Allow multiple providers with priority ordering:

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."

npx openrouter-provider-shim serve \
  --port 8787 \
  --provider-order "fireworks,together,novita" \
  --sort latency \
  --no-fallbacks &

export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
claude
```

## OpenCode with Provider Lock

Force OpenCode to use only Together AI:

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."

npx openrouter-provider-shim serve --port 8787 --provider-only together &

# In OpenCode settings:
# Base URL: http://127.0.0.1:8787/v1
# Model: openai/gpt-4o
# API Key: (your OpenRouter key)
```

## OpenHands with Privacy Controls

Deny data collection and require specific quantizations:

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."

npx openrouter-provider-shim serve \
  --port 8787 \
  --provider-only fireworks \
  --data-collection deny \
  --quantizations "fp8,fp16" \
  --zdr &

# In OpenHands settings, use:
# Base URL: http://127.0.0.1:8787
```

## Multi-Tool Setup with Config File

Create `shim-config.json`:

```json
{
  "port": 8787,
  "mergeMode": "merge",
  "provider": {
    "only": ["fireworks", "together"],
    "order": ["fireworks"],
    "sort": "throughput",
    "allowFallbacks": false,
    "dataCollection": "deny"
  },
  "auth": {
    "mode": "passthrough"
  }
}
```

Start the shim:

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
npx openrouter-provider-shim serve
```

Now multiple tools can use the same endpoint:

| Tool | Setting | Value |
|------|---------|-------|
| Claude Code | `ANTHROPIC_BASE_URL` | `http://127.0.0.1:8787` |
| OpenCode | Base URL | `http://127.0.0.1:8787/v1` |
| OpenHands | Base URL | `http://127.0.0.1:8787/v1` |
| Continue | API Base | `http://127.0.0.1:8787/v1` |

## Strict Enterprise Setup

For regulated environments where routing rules must be enforced:

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
export SHIM_LOCAL_API_KEY="internal-secret-123"

npx openrouter-provider-shim serve \
  --port 8787 \
  --host 10.0.0.5 \
  --provider-only fireworks \
  --no-fallbacks \
  --data-collection deny \
  --merge-mode strict \
  --local-api-key "$SHIM_LOCAL_API_KEY"
```

This setup:
- Binds to internal network only (10.0.0.5)
- Rejects any client requests that try to override provider settings
- Requires authentication to access the shim
- Denies providers that collect training data

## Cheapest Provider Routing

Always pick the cheapest available provider:

```bash
npx openrouter-provider-shim serve --sort price --no-fallbacks
```

## Lowest Latency Routing

Always pick the lowest latency provider:

```bash
npx openrouter-provider-shim serve --sort latency --no-fallbacks
```

## Print Environment Setup

Get ready-to-export environment variables for your setup:

```bash
npx openrouter-provider-shim print-env --port 8787
```

Output:

```bash
# Claude Code
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"

# OpenCode / OpenHands / Droid / Continue
export OPENAI_BASE_URL="http://127.0.0.1:8787/v1"
```

## Testing Configuration

Validate everything before going live:

```bash
# Test configuration and connectivity
npx openrouter-provider-shim doctor --provider-only fireworks

# Check if shim is running
curl http://127.0.0.1:8787/healthz

# View current configuration
curl http://127.0.0.1:8787/config
```
