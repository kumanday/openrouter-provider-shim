import { z } from "zod";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type MergeMode = "merge" | "override" | "strict";

export type Upstream = "openrouter";

export type ProviderSort =
  | "price"
  | "throughput"
  | "latency"
  | { by: "price" | "throughput" | "latency"; partition?: "model" | "none" };

export type ProviderThreshold = number | { p50?: number; p75?: number; p90?: number; p99?: number };

export interface ProviderPolicy {
  order?: string[];
  only?: string[];
  ignore?: string[];
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
  data_collection?: "allow" | "deny";
  zdr?: boolean;
  enforce_distillable_text?: boolean;
  quantizations?: string[];
  sort?: ProviderSort;
  preferred_min_throughput?: ProviderThreshold;
  preferred_max_latency?: ProviderThreshold;
  max_price?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
}

export interface ShimConfig {
  host: string;
  port: number;
  upstream: Upstream;

  enable_anthropic: boolean;
  enable_chat: boolean;
  enable_responses: boolean;

  auth_mode: "passthrough" | "upstream-key";
  upstream_api_key?: string;
  local_api_key?: string;

  merge_mode: MergeMode;
  policy: ProviderPolicy;

  request_timeout_ms: number;
  max_body_bytes: number;
  add_attribution_headers?: boolean;
  attribution?: { referer?: string; title?: string };

  log_level: "silent" | "error" | "info" | "debug";
  log_body: boolean;
  redact_body: boolean;

  _runtime: {
    version: string;
    soft_enforce_only: boolean;
    debug_openrouter_upstream_body: boolean;
  };
}

const ProviderSortSchema = z.union([
  z.enum(["price", "throughput", "latency"]),
  z.object({
    by: z.enum(["price", "throughput", "latency"]),
    partition: z.enum(["model", "none"]).optional(),
  }),
]);

const ProviderThresholdSchema = z.union([
  z.number(),
  z.object({
    p50: z.number().optional(),
    p75: z.number().optional(),
    p90: z.number().optional(),
    p99: z.number().optional(),
  }),
]);

const ProviderPolicySchema = z.object({
  order: z.array(z.string()).optional(),
  only: z.array(z.string()).optional(),
  ignore: z.array(z.string()).optional(),
  allow_fallbacks: z.boolean().optional(),
  require_parameters: z.boolean().optional(),
  data_collection: z.enum(["allow", "deny"]).optional(),
  zdr: z.boolean().optional(),
  enforce_distillable_text: z.boolean().optional(),
  quantizations: z.array(z.string()).optional(),
  sort: ProviderSortSchema.optional(),
  preferred_min_throughput: ProviderThresholdSchema.optional(),
  preferred_max_latency: ProviderThresholdSchema.optional(),
  max_price: z.object({
    prompt: z.number().optional(),
    completion: z.number().optional(),
    total: z.number().optional(),
  }).optional(),
});

const ShimConfigSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().default(8787),
  upstream: z.enum(["openrouter"]).default("openrouter"),

  enable_anthropic: z.boolean().default(true),
  enable_chat: z.boolean().default(true),
  enable_responses: z.boolean().default(true),

  auth_mode: z.enum(["passthrough", "upstream-key"]).default("passthrough"),
  upstream_api_key: z.string().optional(),
  local_api_key: z.string().optional(),

  merge_mode: z.enum(["merge", "override", "strict"]).default("merge"),
  policy: ProviderPolicySchema.default({}),

  request_timeout_ms: z.number().default(600000),
  max_body_bytes: z.number().default(50 * 1024 * 1024),
  add_attribution_headers: z.boolean().default(false),
  attribution: z.object({
    referer: z.string().optional(),
    title: z.string().optional(),
  }).optional(),

  log_level: z.enum(["silent", "error", "info", "debug"]).default("info"),
  log_body: z.boolean().default(false),
  redact_body: z.boolean().default(true),

  _runtime: z.object({
    version: z.string(),
    soft_enforce_only: z.boolean(),
    debug_openrouter_upstream_body: z.boolean(),
  }),
});

function parseCommaList(value: string | undefined): string[] | undefined {
  if (!value || value.trim() === "") return undefined;
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseProviderSort(value: string | undefined): ProviderSort | undefined {
  if (!value) return undefined;
  if (value === "price" || value === "throughput" || value === "latency") {
    return value;
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && "by" in parsed) {
      return parsed as ProviderSort;
    }
  } catch {
    // Not JSON, ignore
  }
  return undefined;
}

function parseProviderThreshold(value: string | undefined): ProviderThreshold | undefined {
  if (!value) return undefined;
  const num = Number(value);
  if (!isNaN(num)) return num;
  try {
    return JSON.parse(value) as ProviderThreshold;
  } catch {
    return undefined;
  }
}

function parseMaxPrice(value: string | undefined): ProviderPolicy["max_price"] | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as ProviderPolicy["max_price"];
  } catch {
    return undefined;
  }
}

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export interface CliOptions {
  config?: string;
  host?: string;
  port?: number;
  mergeMode?: string;
  providerOnly?: string;
  providerOrder?: string;
  providerIgnore?: string;
  sort?: string;
  noFallbacks?: boolean;
  requireParameters?: boolean;
  dataCollection?: string;
  zdr?: boolean;
  quantizations?: string;
  authMode?: string;
  upstreamKey?: string;
  localApiKey?: string;
  enableResponses?: boolean;
  disableResponses?: boolean;
  logLevel?: string;
  logBody?: boolean;
  softEnforceOnly?: boolean;
  debugOpenrouterUpstreamBody?: boolean;
  preferredMinThroughput?: string;
  preferredMaxLatency?: string;
  maxPrice?: string;
  [key: string]: unknown;
}

export function loadConfig(cliOpts: CliOptions = {}): ShimConfig {
  // 1. Load config file if specified
  let fileConfig: Partial<ShimConfig> = {};
  if (cliOpts.config) {
    try {
      const content = readFileSync(resolve(cliOpts.config), "utf8");
      fileConfig = JSON.parse(content) as Partial<ShimConfig>;
    } catch (err: any) {
      throw new Error(`Failed to load config file: ${err.message}`);
    }
  }

  // 2. Environment variables
  const envConfig: Partial<ShimConfig> = {
    host: process.env.SHIM_HOST,
    port: process.env.SHIM_PORT ? Number(process.env.SHIM_PORT) : undefined,
    auth_mode: process.env.SHIM_AUTH_MODE as "passthrough" | "upstream-key" | undefined,
    upstream_api_key: process.env.OPENROUTER_API_KEY,
    local_api_key: process.env.SHIM_LOCAL_API_KEY ?? cliOpts.localApiKey,
    merge_mode: process.env.SHIM_MERGE_MODE as MergeMode | undefined,
    log_level: process.env.SHIM_LOG_LEVEL as "silent" | "error" | "info" | "debug" | undefined,
  };

  // 3. Provider policy from environment
  const envPolicy: ProviderPolicy = {};
  if (process.env.SHIM_PROVIDER_ONLY) envPolicy.only = parseCommaList(process.env.SHIM_PROVIDER_ONLY);
  if (process.env.SHIM_PROVIDER_ORDER) envPolicy.order = parseCommaList(process.env.SHIM_PROVIDER_ORDER);
  if (process.env.SHIM_PROVIDER_IGNORE) envPolicy.ignore = parseCommaList(process.env.SHIM_PROVIDER_IGNORE);
  if (process.env.SHIM_PROVIDER_SORT) envPolicy.sort = parseProviderSort(process.env.SHIM_PROVIDER_SORT);
  if (process.env.SHIM_PROVIDER_ALLOW_FALLBACKS !== undefined) {
    envPolicy.allow_fallbacks = process.env.SHIM_PROVIDER_ALLOW_FALLBACKS !== "false";
  }
  if (process.env.SHIM_PROVIDER_REQUIRE_PARAMETERS !== undefined) {
    envPolicy.require_parameters = process.env.SHIM_PROVIDER_REQUIRE_PARAMETERS === "true";
  }
  if (process.env.SHIM_PROVIDER_DATA_COLLECTION) {
    envPolicy.data_collection = process.env.SHIM_PROVIDER_DATA_COLLECTION as "allow" | "deny";
  }
  if (process.env.SHIM_PROVIDER_ZDR !== undefined) {
    envPolicy.zdr = process.env.SHIM_PROVIDER_ZDR === "true";
  }
  if (process.env.SHIM_PROVIDER_QUANTIZATIONS) {
    envPolicy.quantizations = parseCommaList(process.env.SHIM_PROVIDER_QUANTIZATIONS);
  }
  if (process.env.SHIM_PROVIDER_PREFERRED_MIN_THROUGHPUT) {
    envPolicy.preferred_min_throughput = parseProviderThreshold(process.env.SHIM_PROVIDER_PREFERRED_MIN_THROUGHPUT);
  }
  if (process.env.SHIM_PROVIDER_PREFERRED_MAX_LATENCY) {
    envPolicy.preferred_max_latency = parseProviderThreshold(process.env.SHIM_PROVIDER_PREFERRED_MAX_LATENCY);
  }
  if (process.env.SHIM_PROVIDER_MAX_PRICE) {
    envPolicy.max_price = parseMaxPrice(process.env.SHIM_PROVIDER_MAX_PRICE);
  }

  // 4. CLI options to config mapping
  const cliPolicy: ProviderPolicy = {
    ...envPolicy,
  };
  if (cliOpts.providerOnly) cliPolicy.only = parseCommaList(cliOpts.providerOnly);
  if (cliOpts.providerOrder) cliPolicy.order = parseCommaList(cliOpts.providerOrder);
  if (cliOpts.providerIgnore) cliPolicy.ignore = parseCommaList(cliOpts.providerIgnore);
  if (cliOpts.sort) cliPolicy.sort = parseProviderSort(cliOpts.sort);
  if (cliOpts.noFallbacks !== undefined) cliPolicy.allow_fallbacks = !cliOpts.noFallbacks;
  if (cliOpts.requireParameters !== undefined) cliPolicy.require_parameters = cliOpts.requireParameters;
  if (cliOpts.dataCollection) cliPolicy.data_collection = cliOpts.dataCollection as "allow" | "deny";
  if (cliOpts.zdr !== undefined) cliPolicy.zdr = cliOpts.zdr;
  if (cliOpts.quantizations) cliPolicy.quantizations = parseCommaList(cliOpts.quantizations);
  if (cliOpts.preferredMinThroughput) {
    cliPolicy.preferred_min_throughput = parseProviderThreshold(cliOpts.preferredMinThroughput);
  }
  if (cliOpts.preferredMaxLatency) {
    cliPolicy.preferred_max_latency = parseProviderThreshold(cliOpts.preferredMaxLatency);
  }
  if (cliOpts.maxPrice) {
    cliPolicy.max_price = parseMaxPrice(cliOpts.maxPrice);
  }

  // Merge policies: file < env < cli
  const mergedPolicy: ProviderPolicy = {
    ...fileConfig.policy,
    ...envPolicy,
    ...cliPolicy,
  };

  // 5. Determine enable_responses
  let enableResponses = fileConfig.enable_responses ?? true;
  if (cliOpts.disableResponses) enableResponses = false;
  if (cliOpts.enableResponses !== undefined) enableResponses = cliOpts.enableResponses;

  // 6. Build final config with priority: defaults < file < env < cli
  const rawConfig = {
    // File config base
    ...fileConfig,
    // Environment overrides
    ...(envConfig.host && { host: envConfig.host }),
    ...(envConfig.port && { port: envConfig.port }),
    ...(envConfig.auth_mode && { auth_mode: envConfig.auth_mode }),
    ...(envConfig.upstream_api_key && { upstream_api_key: envConfig.upstream_api_key }),
    ...(envConfig.local_api_key && { local_api_key: envConfig.local_api_key }),
    ...(envConfig.merge_mode && { merge_mode: envConfig.merge_mode }),
    ...(envConfig.log_level && { log_level: envConfig.log_level }),
    // CLI overrides
    ...(cliOpts.host && { host: cliOpts.host }),
    ...(cliOpts.port && { port: cliOpts.port }),
    ...(cliOpts.authMode && { auth_mode: cliOpts.authMode }),
    ...(cliOpts.upstreamKey && { upstream_api_key: cliOpts.upstreamKey }),
    ...(cliOpts.localApiKey && { local_api_key: cliOpts.localApiKey }),
    ...(cliOpts.mergeMode && { merge_mode: cliOpts.mergeMode }),
    ...(cliOpts.logLevel && { log_level: cliOpts.logLevel }),
    ...(cliOpts.logBody !== undefined && { log_body: cliOpts.logBody }),
    // Policy
    policy: mergedPolicy,
    // Responses
    enable_responses: enableResponses,
    // Runtime
    _runtime: {
      version: getVersion(),
      soft_enforce_only: cliOpts.softEnforceOnly ?? false,
      debug_openrouter_upstream_body: cliOpts.debugOpenrouterUpstreamBody ?? false,
    },
  };

  // 7. Validate with Zod
  const result = ShimConfigSchema.safeParse(rawConfig);
  if (!result.success) {
    throw new Error(`Config validation failed: ${result.error.message}`);
  }

  return result.data;
}
