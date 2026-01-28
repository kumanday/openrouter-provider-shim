# OpenRouter Provider Shim

A lightweight local proxy that lets AI agent tools use OpenRouter's provider-specific routing controls.

## What It Does

Many AI coding tools (Claude Code, OpenCode, OpenHands, Droid) can connect to OpenAI-compatible endpoints, but they cannot attach OpenRouter's per-request `provider` routing object. This shim injects those routing fields server-side, giving you full control over which AI providers handle your requests.

## Quick Start

### 1. Set Your API Key

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
```

### 2. Start the Shim

```bash
npx openrouter-provider-shim serve --port 8787 --provider-only fireworks
```

### 3. Configure Your AI Tool

Point your tool at `http://127.0.0.1:8787` instead of the OpenRouter URL.

## Installation

No installation required. Use directly with npx:

```bash
npx openrouter-provider-shim --help
```

Or install globally:

```bash
npm install -g openrouter-provider-shim
openrouter-provider-shim serve
```

## Supported Tools

| Tool | Compatibility | Notes |
|------|--------------|-------|
| Claude Code | Full | Auto-detected, model remapping supported |
| OpenCode | Full | OpenAI-compatible endpoint |
| OpenHands | Full | OpenAI-compatible endpoint |
| Droid | Full | OpenAI-compatible endpoint |
| Continue | Full | OpenAI-compatible endpoint |

## Next Steps

- [Configuration Guide](./configuration.md) - All options explained
- [Usage Examples](./examples.md) - Common setup scenarios
- [API Reference](./api.md) - Endpoints and protocols
