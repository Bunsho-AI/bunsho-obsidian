/**
 * The account line (desktop AccountMenu's chip and credits). A plan is named only when the engine said which: a read that
 * failed names none, so a paying writer is never told they are on Free.
 */
import { formatNumber } from "@/utils/format";

/** Desktop src/types/billing.ts PLAN_OPTIONS: the subscription tiers' display names. */
const PLAN_NAMES: ReadonlyMap<string, string> = new Map([["quill", "Quill"], ["storyteller", "Storyteller"], ["saga", "Saga"]]);

/** `subscription` is the raw answer of GET /v1/billing/subscription, or null when the read failed. */
export function planName(subscription: unknown): string | null {
  if (!subscription || typeof subscription !== "object") return null;
  const { active, tier } = subscription as { active?: unknown; tier?: unknown };
  if (typeof active !== "boolean") return null;
  if (!active) return "Free";
  if (typeof tier !== "string" || !tier.trim()) return null;
  return PLAN_NAMES.get(tier) ?? tier;
}

/** What the subscription read says, when it said anything: a failed read is no evidence a plan ended. */
export interface PlanRead { active: boolean; tier: string | null; renewsAt: string | null }

export function planRead(subscription: unknown): PlanRead | null {
  if (!subscription || typeof subscription !== "object") return null;
  const { active, tier, renewsAt } = subscription as { active?: unknown; tier?: unknown; renewsAt?: unknown };
  if (typeof active !== "boolean") return null;
  return { active, tier: typeof tier === "string" && tier.trim() ? tier : null, renewsAt: typeof renewsAt === "string" && renewsAt ? renewsAt : null };
}

/** A plan that ended: the name it went by, and the date when it is known. */
export interface LapsedPlan { plan: string; endedAt: string | null }

/** A subscription that was active and is not: the canon pen rests, and everything declared still reads. Decided on a fresh read only. */
export function lapsedPlan(read: PlanRead | null, last: { tier: string; renewsAt: string | null } | null): LapsedPlan | null {
  if (!read || read.active) return null;
  const tier = read.tier ?? last?.tier;
  return tier ? { plan: PLAN_NAMES.get(tier) ?? tier, endedAt: read.renewsAt ?? last?.renewsAt ?? null } : null;
}

/** "Your Storyteller plan ended on 12 March." */
export function lapsedTitle({ plan, endedAt }: LapsedPlan, locale?: string): string {
  const when = endedAt ? new Date(endedAt) : null;
  const date = when && !Number.isNaN(when.getTime()) ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(when) : null;
  return date ? `Your ${plan} plan ended on ${date}.` : `Your ${plan} plan ended.`;
}

/** "Storyteller · 12,345 credits", or as much of it as is known. */
export function accountSummary(plan: string | null, balance: number | null): string | null {
  const credits = balance === null ? null : Math.max(0, Math.round(balance));
  const parts = [plan, credits === null ? null : `${formatNumber(credits)} ${credits === 1 ? "credit" : "credits"}`].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}
