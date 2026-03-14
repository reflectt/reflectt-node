import type { RunKind } from "./agent-interface.js";

export const ALLOWED_ACTIONS: RunKind[] = ["github_issue_create"];
export const ALLOWED_DOMAINS: string[] = ["github.com"];

export function checkActionAllowed(
  kind: RunKind,
  target?: string
): { allowed: boolean; reason?: string } {
  if (!ALLOWED_ACTIONS.includes(kind)) {
    return { allowed: false, reason: `Action "${kind}" is not in the approved action list` };
  }
  if (target) {
    const url = (() => { try { return new URL(target); } catch { return null; } })();
    if (url && !ALLOWED_DOMAINS.some(d => url.hostname === d || url.hostname.endsWith("." + d))) {
      return { allowed: false, reason: `Domain "${url.hostname}" is not in the approved domain list` };
    }
  }
  return { allowed: true };
}

export function requiresApprovalGate(_kind: RunKind): boolean {
  // All v1 actions are irreversible — always require human approval
  return true;
}
