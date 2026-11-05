/**
 * The account line (desktop AccountMenu's chip and credits). A plan is named only when the engine said which: a read that
 * failed names none, so a paying writer is never told they are on Free.
 */
import { formatNumber } from "@/utils/format";

/** Desktop src/types/billing.ts PLAN_OPTIONS: the subscription tiers' display names. */
const PLAN_NAMES: Readonly<Record<string, string>> = { quill: "Quill", storyteller: "Storyteller", saga: "Saga" };

/** `subscription` is the raw answer of GET /v1/billing/subscription, or null when the read failed. */
export function planName(subscription: unknown): string | null {
  if (!subscription || typeof subscription !== "object") return null;
  const { active, tier } = subscription as { active?: unknown; tier?: unknown };
  if (typeof active !== "boolean") return null;
  if (!active) return "Free";
  if (typeof tier !== "string" || !tier.trim()) return null;
  return PLAN_NAMES[tier] ?? tier;
}

/** "Storyteller · 12,345 credits", or as much of it as is known. */
export function accountSummary(plan: string | null, balance: number | null): string | null {
  const credits = balance === null ? null : Math.max(0, Math.round(balance));
  const parts = [plan, credits === null ? null : `${formatNumber(credits)} ${credits === 1 ? "credit" : "credits"}`].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}
