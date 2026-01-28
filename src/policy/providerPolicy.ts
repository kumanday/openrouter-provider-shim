import type { ProviderPolicy, MergeMode } from "../config.js";

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function intersect(a?: string[], b?: string[]): string[] | undefined {
  if (!a?.length || !b?.length) return a ?? b;
  const set = new Set(a);
  return b.filter((x) => set.has(x));
}

export function applyProviderPolicy(
  body: any,
  policy: ProviderPolicy,
  mode: MergeMode,
  softEnforceOnly: boolean
): any {
  if (!policy || Object.keys(policy).length === 0) return body;

  const out = deepClone(body ?? {});
  const reqProv = out.provider;

  // If no provider in request, simply inject the policy
  if (!reqProv) {
    out.provider = deepClone(policy);
    return out;
  }

  // Override mode: completely replace request provider with policy
  if (mode === "override") {
    out.provider = deepClone(policy);
    return out;
  }

  // Strict mode: reject if any enforced fields conflict
  if (mode === "strict") {
    // Compare only the keys that policy sets
    for (const [k, v] of Object.entries(policy)) {
      const rv = (reqProv as any)[k];
      if (rv === undefined) continue; // missing is allowed; shim will fill in
      if (JSON.stringify(rv) !== JSON.stringify(v)) {
        const e: any = new Error(`provider.${k} conflicts with enforced policy`);
        e.code = "ERR_PROVIDER_CONFLICT";
        throw e;
      }
    }
    // Fill missing fields from policy
    out.provider = { ...deepClone(policy), ...reqProv };
    // Apply soft enforce for 'only' if both exist
    if (softEnforceOnly && policy.only && reqProv.only) {
      out.provider.only = intersect(policy.only, reqProv.only);
    }
    return out;
  }

  // Merge mode (default): merge policy with request, request takes precedence
  out.provider = { ...deepClone(policy), ...reqProv };
  // Apply soft enforce for 'only' if both exist (intersect instead of replace)
  if (softEnforceOnly && policy.only && reqProv.only) {
    out.provider.only = intersect(policy.only, reqProv.only);
  }
  return out;
}
