import { describe, it, expect } from "vitest";
import { applyProviderPolicy } from "../src/policy/providerPolicy";
import type { ProviderPolicy, MergeMode } from "../src/config";

describe("applyProviderPolicy", () => {
  const policy: ProviderPolicy = {
    only: ["fireworks", "moonshotai"],
    sort: "throughput",
    allow_fallbacks: false,
  };

  it("injects policy when request has no provider", () => {
    const body = { model: "moonshotai/kimi-k2.5", messages: [] };
    const result = applyProviderPolicy(body, policy, "merge", false);
    expect(result.provider).toEqual(policy);
  });

  it("merges with request provider in merge mode", () => {
    const body = { model: "moonshotai/kimi-k2.5", provider: { order: ["moonshotai"] } };
    const result = applyProviderPolicy(body, policy, "merge", false);
    expect(result.provider.only).toEqual(["fireworks", "moonshotai"]);
    expect(result.provider.order).toEqual(["moonshotai"]);
    expect(result.provider.sort).toBe("throughput");
  });

  it("overrides request provider in override mode", () => {
    const body = { model: "moonshotai/kimi-k2.5", provider: { order: ["moonshotai"] } };
    const result = applyProviderPolicy(body, policy, "override", false);
    expect(result.provider).toEqual(policy);
    expect(result.provider.order).toBeUndefined();
  });

  it("intersects only arrays in soft enforce mode", () => {
    const body = { model: "moonshotai/kimi-k2.5", provider: { only: ["fireworks", "hyperbolic"] } };
    const result = applyProviderPolicy(body, policy, "merge", true);
    expect(result.provider.only).toEqual(["fireworks"]);
  });

  it("throws in strict mode when fields conflict", () => {
    const body = { model: "moonshotai/kimi-k2.5", provider: { only: ["hyperbolic"] } };
    expect(() => applyProviderPolicy(body, policy, "strict", false)).toThrow();
  });

  it("allows matching values in strict mode", () => {
    const body = { model: "moonshotai/kimi-k2.5", provider: { only: ["fireworks", "moonshotai"] } };
    const result = applyProviderPolicy(body, policy, "strict", false);
    expect(result.provider.only).toEqual(["fireworks", "moonshotai"]);
  });
});
