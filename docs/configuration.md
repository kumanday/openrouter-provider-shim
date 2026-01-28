# Configuration Guide

## Configuration Methods

Configuration is loaded in this priority order (highest to lowest):

1. **CLI flags** - Highest priority
2. **Environment variables**
3. **Config file** (`shim-config.json`) - Lowest priority

## Quick Reference

| CLI Flag | Environment Variable | Config Key | Description |
|----------|---------------------|------------|-------------|
| `--port` | `SHIM_PORT` | `port` | Port to bind (default: 8787) |
| `--host` | `SHIM_HOST` | `host` | Host to bind (default: 127.0.0.1) |
| `--provider-only` | `SHIM_PROVIDER_ONLY` | `provider.only` | Comma-separated allowed providers |
| `--provider-order` | `SHIM_PROVIDER_ORDER` | `provider.order` | Provider priority order |
| `--provider-ignore` | `SHIM_PROVIDER_IGNORE` | `provider.ignore` | Providers to skip |
| `--sort` | `SHIM_PROVIDER_SORT` | `provider.sort` | Sort by: `price`, `throughput`, `latency` |
| `--no-fallbacks` | `SHIM_PROVIDER_ALLOW_FALLBACKS` | `provider.allowFallbacks` | Set to `false` to disable fallbacks |
| `--require-parameters` | `SHIM_PROVIDER_REQUIRE_PARAMETERS` | `provider.requireParameters` | Require all parameter support |
| `--data-collection` | `SHIM_PROVIDER_DATA_COLLECTION` | `provider.dataCollection` | `allow` or `deny` |
| `--zdr` | `SHIM_PROVIDER_ZDR` | - | Enable Zero Data Retention |
| `--quantizations` | `SHIM_PROVIDER_QUANTIZATIONS` | `provider.quantizations` | Comma-separated quantization types |
| `--auth-mode` | `SHIM_AUTH_MODE` | `auth.mode` | `passthrough` or `upstream-key` |
| `--upstream-key` | `OPENROUTER_API_KEY` | - | Your OpenRouter API key |
| `--local-api-key` | `SHIM_LOCAL_API_KEY` | `auth.localApiKey` | Key to protect the shim endpoint |
| `--merge-mode` | `SHIM_MERGE_MODE` | `mergeMode` | `merge`, `override`, or `strict` |

## Provider Routing Options

### Restrict to Specific Providers

Only use Fireworks and Together:

```bash
npx openrouter-provider-shim serve --provider-only "fireworks,together"
```

### Set Provider Priority

Prefer Fireworks, fallback to others:

```bash
npx openrouter-provider-shim serve --provider-order "fireworks,together,openai"
```

### Ignore Unwanted Providers

Skip specific providers:

```bash
npx openrouter-provider-shim serve --provider-ignore "openai,azure"
```

### Sort Providers

Sort by lowest price:

```bash
npx openrouter-provider-shim serve --sort price
```

Or by highest throughput:

```bash
npx openrouter-provider-shim serve --sort throughput
```

### Disable Fallbacks

Prevent OpenRouter from falling back to other providers:

```bash
npx openrouter-provider-shim serve --provider-only fireworks --no-fallbacks
```

## Authentication Modes

### Passthrough Mode (Default)

Forwards the Authorization header from the client to OpenRouter.

```bash
npx openrouter-provider-shim serve --auth-mode passthrough
```

**Smart Substitution:** If the inbound request has an Anthropic key (`sk-ant-*`) and you've set `OPENROUTOR_API_KEY`, the shim automatically substitutes it.

### Upstream Key Mode

Always uses your configured OpenRouter key, ignoring client auth:

```bash
npx openrouter-provider-shim serve --auth-mode upstream-key --upstream-key "sk-or-v1-..."
```

### Local API Key Protection

Require clients to authenticate to the shim itself:

```bash
npx openrouter-provider-shim serve --local-api-key "shim-secret-key"
```

Clients must include `Authorization: Bearer shim-secret-key` in their requests.

## Merge Modes

Controls how the shim combines its configured policy with any provider settings in client requests.

### Merge Mode (Default)

Injects missing policy fields without overriding client settings:

```bash
npx openrouter-provider-shim serve --merge-mode merge
```

- If client sends no `provider` object: shim injects full policy
- If client sends partial `provider` object: shim fills in missing fields
- Existing client values are preserved

### Override Mode

Completely replaces client provider settings:

```bash
npx openrouter-provider-shim serve --merge-mode override
```

The shim's policy always wins. Use this for strict enforcement.

### Strict Mode

Rejects requests that conflict with policy:

```bash
npx openrouter-provider-shim serve --merge-mode strict
```

Returns HTTP 422 if the client's `provider` object contains values that conflict with the shim's configuration.

## Config File Example

Create `shim-config.json` in your working directory:

```json
{
  "port": 8787,
  "host": "127.0.0.1",
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

Then simply run:

```bash
npx openrouter-provider-shim serve
```

## Environment Variables Example

```bash
export SHIM_PORT=8787
export SHIM_PROVIDER_ONLY="fireworks,together"
export SHIM_PROVIDER_SORT="throughput"
export SHIM_MERGE_MODE="merge"
export OPENROUTER_API_KEY="sk-or-v1-..."

npx openrouter-provider-shim serve
```

## Validation

Test your configuration before starting:

```bash
npx openrouter-provider-shim doctor
```

This validates your settings and checks OpenRouter connectivity.
