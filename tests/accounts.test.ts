import { describe, expect, it } from "vitest";
import { accountDir, accountKey, parseOtherAccounts, settleAccount, NO_ACCOUNT_STATE, type AccountOwned } from "@/helpers/accounts";

const owned = (over: Partial<AccountOwned> = {}): AccountOwned => ({ ...NO_ACCOUNT_STATE, ...over });
const data = (over: Partial<AccountOwned> & { accountKey?: string | null; rootAccount?: string | null; otherAccounts?: Record<string, AccountOwned> } = {}) => ({
  accountKey: null as string | null, rootAccount: null as string | null, otherAccounts: {} as Record<string, AccountOwned>, ...owned(), ...over });

describe("whose data this is", () => {
  it("names an account by a hash, never by its id", () => {
    const key = accountKey("firebase-uid-1");
    expect(key).toMatch(/^[0-9a-f]{24}$/u);
    expect(key).toBe(accountKey("firebase-uid-1"));
    expect(key).not.toBe(accountKey("firebase-uid-2"));
    expect(key).not.toContain("firebase");
  });

  it("the first account to sign in keeps what is already here", () => {
    const { next, swapped } = settleAccount(data({ dismissed: ["a"] }), "k1");
    expect(swapped).toBe(false);
    expect(next).toMatchObject({ accountKey: "k1", rootAccount: "k1", dismissed: ["a"] });
  });

  it("the same account signing back in changes nothing", () => {
    const before = data({ accountKey: "k1", rootAccount: "k1", dismissed: ["a"] });
    expect(settleAccount(before, "k1")).toEqual({ next: before, changed: false, swapped: false });
  });

  it("another account finds nothing of the first, and the first's data is kept", () => {
    const before = data({ accountKey: "k1", rootAccount: "k1", dismissed: ["a"], source: { kind: "folder", path: "Book" } });
    const { next, swapped } = settleAccount(before, "k2");
    expect(swapped).toBe(true);
    expect(next).toMatchObject({ accountKey: "k2", rootAccount: "k1", dismissed: [], source: null, lastReview: null });
    expect(next.otherAccounts.k1).toMatchObject({ dismissed: ["a"], source: { kind: "folder", path: "Book" } });
  });

  it("the first account coming back has its data again, and the second's stays held", () => {
    const first = data({ accountKey: "k1", rootAccount: "k1", deliberate: ["a"] });
    const second = { ...settleAccount(first, "k2").next, deliberate: ["b"] };
    const { next } = settleAccount(second, "k1");
    expect(next).toMatchObject({ accountKey: "k1", deliberate: ["a"] });
    expect(next.otherAccounts).toEqual({ k2: expect.objectContaining({ deliberate: ["b"] }) });
  });

  it("does not change what it was given", () => {
    const before = data({ accountKey: "k1", rootAccount: "k1", dismissed: ["a"] });
    const copy = structuredClone(before);
    settleAccount(before, "k2");
    expect(before).toEqual(copy);
  });

  it("the files of the account that was here first stay beside data.json; another's go in its own folder", () => {
    const k = "a".repeat(24);
    const other = "b".repeat(24);
    expect(accountDir("plugins/bunsho", { accountKey: k, rootAccount: k })).toBe("plugins/bunsho");
    expect(accountDir("plugins/bunsho", { accountKey: null, rootAccount: null })).toBe("plugins/bunsho");
    expect(accountDir("plugins/bunsho", { accountKey: other, rootAccount: k })).toBe(`plugins/bunsho/accounts/${other}`);
  });

  it("never builds a path from a key that is not one of ours", () => {
    expect(accountDir("plugins/bunsho", { accountKey: "../../evil", rootAccount: "a".repeat(24) })).toBe("plugins/bunsho");
  });

  it("reads held data from a hand-edited file only when it is the right shape", () => {
    const k = "c".repeat(24);
    const parsed = parseOtherAccounts({ [k]: { dismissed: ["a", 3], deliberate: "x", fixed: [], source: { kind: "folder", path: "B" }, plan: null, lastReview: { issues: 1 }, stopped: {} }, bad: { dismissed: [] }, [`${"d".repeat(24)}`]: 7 });
    expect(Object.keys(parsed)).toEqual([k]);
    expect(parsed[k]).toEqual({ ...NO_ACCOUNT_STATE, dismissed: ["a"], source: { kind: "folder", path: "B" } });
    expect(parseOtherAccounts("nope")).toEqual({});
  });
});
