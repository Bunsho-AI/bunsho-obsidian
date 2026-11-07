/**
 * Whose data this is. Findings, decisions, the World and canon live on the writer's machine and stay when they sign out (founder,
 * 5 November 2026). A vault can be signed into by a different Bunsho account later, on a shared machine or a synced vault: that
 * account sees none of it and sends none of it, and nothing of the first account's is deleted or overwritten. It returns when the
 * first account does. Pure: no Obsidian, no file access.
 */
import { sha256 } from "@/utils/hash";
import type { SavedPlan, SourceChoice } from "@/helpers/sources";
import type { ReviewOutcome } from "@/helpers/reviewMerge";
import type { StoppedReview } from "@/types";

/** What belongs to one account on this vault. Note ids and the install stay with the vault. */
export interface AccountOwned {
  source: SourceChoice | null;
  plan: SavedPlan | null;
  dismissed: string[];
  deliberate: string[];
  fixed: string[];
  lastReview: ReviewOutcome | null;
  stopped: StoppedReview | null;
  /** The paid plan this account was last seen on: how a lapse is told from never having had one. */
  lastPlan: LastPlan | null;
}
export interface LastPlan { tier: string; renewsAt: string | null }

export const NO_ACCOUNT_STATE: AccountOwned = { source: null, plan: null, dismissed: [], deliberate: [], fixed: [], lastReview: null, stopped: null, lastPlan: null };

const KEY = /^[0-9a-f]{24}$/u;
/** The name an account's data goes under. A hash, so the file holds no account id. */
export const accountKey = (uid: string): string => sha256(uid).slice(0, 24);

interface Owner { accountKey: string | null; rootAccount: string | null; otherAccounts: Record<string, AccountOwned> }

const ownedOf = (data: AccountOwned): AccountOwned => ({ source: data.source, plan: data.plan, dismissed: data.dismissed, deliberate: data.deliberate, fixed: data.fixed,
  lastReview: data.lastReview, stopped: data.stopped, lastPlan: data.lastPlan });

/**
 * This account now holds the vault. The first ever keeps what is here. Any other has its own data, or none, in one save of
 * data.json, so a crash cannot leave one account's decisions on another's findings.
 */
export function settleAccount<T extends Owner & AccountOwned>(data: T, key: string): { next: T; changed: boolean; swapped: boolean } {
  if (data.accountKey === key) return { next: data, changed: false, swapped: false };
  if (data.accountKey === null) return { next: { ...data, accountKey: key, rootAccount: data.rootAccount ?? key }, changed: true, swapped: data.rootAccount !== null && data.rootAccount !== key };
  const { [key]: returning, ...others } = data.otherAccounts;
  return { next: { ...data, ...(returning ?? NO_ACCOUNT_STATE), accountKey: key, otherAccounts: { ...others, [data.accountKey]: ownedOf(data) } }, changed: true, swapped: true };
}

/** Where this account's world.json and canon.json are. A key that is not one of ours builds no path. */
export function accountDir(dir: string, owner: Pick<Owner, "accountKey" | "rootAccount">): string {
  const { accountKey: key, rootAccount } = owner;
  return key && KEY.test(key) && key !== rootAccount ? `${dir}/accounts/${key}` : dir;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
const choice = (value: unknown): SourceChoice | null => (record(value) && (value.kind === "folder" || value.kind === "note") && typeof value.path === "string" ? value as unknown as SourceChoice : null);
const plan = (value: unknown): SavedPlan | null => (record(value) && Array.isArray(value.order) && Array.isArray(value.excluded) ? { order: ids(value.order), excluded: ids(value.excluded) } : null);
export const parseLastPlan = (value: unknown): LastPlan | null => (record(value) && typeof value.tier === "string" && value.tier ? { tier: value.tier, renewsAt: typeof value.renewsAt === "string" ? value.renewsAt : null } : null);

/** Held data from data.json, which can be synced or hand-edited: only well-formed accounts stay, and only well-formed parts of them. */
export function parseOtherAccounts(value: unknown): Record<string, AccountOwned> {
  if (!record(value)) return {};
  const valid = Object.entries(value).filter(([key, held]) => KEY.test(key) && record(held));
  return Object.fromEntries(valid.map(([key, held]) => {
    const raw = held as Record<string, unknown>;
    const review = record(raw.lastReview) && Array.isArray(raw.lastReview.pages) && Array.isArray(raw.lastReview.issues) ? raw.lastReview as unknown as ReviewOutcome : null;
    const stopped = record(raw.stopped) && typeof raw.stopped.status === "string" && record(raw.stopped.source) ? raw.stopped as unknown as StoppedReview : null;
    return [key, { source: choice(raw.source), plan: plan(raw.plan), dismissed: ids(raw.dismissed), deliberate: ids(raw.deliberate), fixed: ids(raw.fixed), lastReview: review, stopped, lastPlan: parseLastPlan(raw.lastPlan) }];
  }));
}

/** Held accounts' data as a rename leaves it: what they picked, their review and their stopped review all follow a note or folder. */
export function followHeld(others: Readonly<Record<string, AccountOwned>>, follow: (choice: SourceChoice) => SourceChoice): Record<string, AccountOwned> {
  return Object.fromEntries(Object.entries(others).map(([key, held]) => [key, { ...held,
    source: held.source && follow(held.source),
    lastReview: held.lastReview && { ...held.lastReview, source: follow(held.lastReview.source) },
    stopped: held.stopped && { ...held.stopped, source: follow(held.stopped.source) } }]));
}
