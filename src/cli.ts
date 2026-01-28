#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig, type CliOptions } from "./config.js";
import { startServer } from "./server.js";
import { getVersion } from "./util/version.js";

const program = new Command();

program
  .name("openrouter-provider-shim")
  .description("Local shim for OpenRouter provider routing (Claude Code + OpenAI-compatible harnesses)")
  .version(getVersion());

// Default/serve command
program
  .command("serve", { isDefault: true })
  .description("Start the local shim server")
  .option("--config <path>", "Path to config JSON file")
  .option("--host <host>", "Host to bind (default: 127.0.0.1)", "127.0.0.1")
  .option("--port <port>", "Port to bind (default: 8787)", (v) => Number(v), 8787)
  .option("--merge-mode <mode>", "Provider merge mode: merge|override|strict", "merge")
  .option("--provider-only <list>", "Comma-separated list of allowed providers (e.g., fireworks)", "")
  .option("--provider-order <list>", "Comma-separated list of provider priority order", "")
  .option("--provider-ignore <list>", "Comma-separated list of providers to skip", "")
  .option("--sort <sort>", "Sort providers by: price|throughput|latency")
  .option("--no-fallbacks", "Disable fallback providers")
  .option("--require-parameters", "Require providers to support all parameters")
  .option("--data-collection <allow|deny>", "Provider data collection policy")
  .option("--zdr", "Enforce Zero Data Retention endpoints")
  .option("--quantizations <list>", "Comma-separated list of quantizations (fp8,int8,...)")
  .option("--preferred-min-throughput <value>", "Preferred minimum throughput (number or JSON object with p50/p75/p90/p99)")
  .option("--preferred-max-latency <value>", "Preferred maximum latency in seconds (number or JSON object)")
  .option("--max-price <json>", `Max price as JSON: {"prompt":1.0,"completion":4.0}`)
  .option("--auth-mode <mode>", "Authentication mode: passthrough|upstream-key", "passthrough")
  .option("--upstream-key <key>", "OpenRouter API key (prefer env OPENROUTER_API_KEY)")
  .option("--local-api-key <key>", "Require inbound requests to use this key for local auth")
  .option("--enable-responses", "Enable /v1/responses endpoint", true)
  .option("--disable-responses", "Disable /v1/responses endpoint")
  .option("--log-level <level>", "Log level: silent|error|info|debug", "info")
  .option("--log-body", "Log request/response bodies (default: false)", false)
  .option("--soft-enforce-only", "Intersect provider.only arrays instead of replacing", false)
  .option("--debug-openrouter-upstream-body", "Enable OpenRouter debug mode for chat completions", false)
  .action(async (opts: CliOptions) => {
    try {
      const cfg = loadConfig(opts);
      startServer(cfg);
      console.log(`openrouter-provider-shim v${cfg._runtime.version} listening on http://${cfg.host}:${cfg.port}`);
    } catch (err: any) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

// Doctor command
program
  .command("doctor")
  .description("Validate config and check connectivity to OpenRouter")
  .option("--config <path>", "Path to config JSON file")
  .option("--host <host>", "Host to bind")
  .option("--port <port>", "Port to bind", (v) => v ? Number(v) : undefined)
  .option("--merge-mode <mode>", "Provider merge mode")
  .option("--provider-only <list>", "Comma-separated list of allowed providers")
  .option("--provider-order <list>", "Comma-separated list of provider priority order")
  .option("--provider-ignore <list>", "Comma-separated list of providers to skip")
  .option("--sort <sort>", "Sort providers by: price|throughput|latency")
  .option("--no-fallbacks", "Disable fallback providers")
  .option("--require-parameters", "Require providers to support all parameters")
  .option("--data-collection <allow|deny>", "Provider data collection policy")
  .option("--zdr", "Enforce Zero Data Retention endpoints")
  .option("--quantizations <list>", "Comma-separated list of quantizations")
  .option("--auth-mode <mode>", "Authentication mode: passthrough|upstream-key")
  .option("--upstream-key <key>", "OpenRouter API key")
  .option("--local-api-key <key>", "Local API key")
  .option("--log-level <level>", "Log level: silent|error|info|debug")
  .option("--preferred-min-throughput <value>", "Preferred minimum throughput")
  .option("--preferred-max-latency <value>", "Preferred maximum latency")
  .option("--max-price <json>", "Max price as JSON")
  .action(async (opts: CliOptions) => {
    try {
      const cfg = loadConfig(opts);

      console.log("=== Configuration ===");
      console.log(`Version: ${cfg._runtime.version}`);
      console.log(`Host: ${cfg.host}`);
      console.log(`Port: ${cfg.port}`);
      console.log(`Upstream: ${cfg.upstream}`);
      console.log(`Auth mode: ${cfg.auth_mode}`);
      console.log(`Merge mode: ${cfg.merge_mode}`);
      console.log(`Enable Anthropic: ${cfg.enable_anthropic}`);
      console.log(`Enable Chat: ${cfg.enable_chat}`);
      console.log(`Enable Responses: ${cfg.enable_responses}`);
      console.log(`\nProvider Policy:`);
      console.log(JSON.stringify(cfg.policy, null, 2));

      // Check connectivity to OpenRouter
      console.log("\n=== Connectivity Check ===");
      const upstreamKey = cfg.upstream_api_key;
      if (!upstreamKey) {
        console.log("⚠️  No OpenRouter API key configured (set OPENROUTER_API_KEY or --upstream-key)");
      } else {
        try {
          const resp = await fetch("https://openrouter.ai/api/v1/models", {
            headers: { "Authorization": `Bearer ${upstreamKey}` },
            signal: AbortSignal.timeout(10000),
          });
          if (resp.ok) {
            console.log("✅ OpenRouter API connectivity: OK");
            const data = await resp.json() as { data?: unknown[] };
            console.log(`   Available models: ${data.data?.length ?? "unknown"}`);
          } else {
            console.log(`❌ OpenRouter API returned ${resp.status}: ${resp.statusText}`);
          }
        } catch (err: any) {
          console.log(`❌ Failed to connect to OpenRouter: ${err.message}`);
        }
      }

      console.log("\n=== Summary ===");
      console.log("Configuration is valid. Run 'serve' to start the server.");
    } catch (err: any) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

// Print-env command
program
  .command("print-env")
  .description("Print environment variable configurations for various clients")
  .option("--host <host>", "Shim host", "127.0.0.1")
  .option("--port <port>", "Shim port", (v) => Number(v), 8787)
  .action((opts: { host: string; port: number }) => {
    const baseUrl = `http://${opts.host}:${opts.port}`;

    console.log("=== Claude Code (Automatic - Recommended) ===");
    console.log("# Works if you have both ANTHROPIC_API_KEY and OPENROUTER_API_KEY set");
    console.log(`export ANTHROPIC_BASE_URL="${baseUrl}"`);
    console.log(`export ANTHROPIC_MODEL="moonshotai/kimi-k2.5"`);
    console.log("# The shim will automatically substitute your Anthropic key with your OpenRouter key");
    console.log("");

    console.log("=== Claude Code (Explicit Control) ===");
    console.log(`export ANTHROPIC_BASE_URL="${baseUrl}"`);
    console.log(`export ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY"`);
    console.log(`export ANTHROPIC_API_KEY=""`);
    console.log(`export ANTHROPIC_MODEL="moonshotai/kimi-k2.5"`);
    console.log("");

    console.log("=== OpenAI-compatible clients (OpenCode, OpenHands, Droid) ===");
    console.log(`export OPENAI_BASE_URL="${baseUrl}/v1"`);
    console.log(`export OPENAI_API_KEY="$OPENROUTER_API_KEY"`);
    console.log("");

    console.log("=== Windows PowerShell (Automatic) ===");
    console.log(`$env:ANTHROPIC_BASE_URL="${baseUrl}"`);
    console.log(`$env:ANTHROPIC_MODEL="moonshotai/kimi-k2.5"`);
    console.log("");

    console.log("=== Windows PowerShell (Explicit) ===");
    console.log(`$env:ANTHROPIC_BASE_URL="${baseUrl}"`);
    console.log(`$env:ANTHROPIC_AUTH_TOKEN=$env:OPENROUTER_API_KEY`);
    console.log(`$env:ANTHROPIC_API_KEY=""`);
    console.log(`$env:ANTHROPIC_MODEL="moonshotai/kimi-k2.5"`);
    console.log("");

    console.log("=== Shim Configuration ===");
    console.log(`export SHIM_HOST="${opts.host}"`);
    console.log(`export SHIM_PORT="${opts.port}"`);
  });

program.parse(process.argv);
