import { describe, expect, it } from "vitest";
import { accountSummary, planName } from "@/helpers/account";

describe("planName", () => {
  it("names the active plan, from the same catalog as the desktop", () => {
    expect(planName({ active: true, tier: "quill" })).toBe("Quill");
    expect(planName({ active: true, tier: "storyteller" })).toBe("Storyteller");
    expect(planName({ active: true, tier: "saga" })).toBe("Saga");
  });
  it("says Free only when the engine says there is no plan", () => {
    expect(planName({ active: false, tier: null })).toBe("Free");
    expect(planName({ active: false, tier: "saga" })).toBe("Free");
  });
  it("shows a tier it does not know yet by its key, as the desktop does", () => {
    expect(planName({ active: true, tier: "novelist" })).toBe("novelist");
  });
  it("is not fooled by a tier named like an object's own property", () => {
    expect(planName({ active: true, tier: "constructor" })).toBe("constructor");
  });
  it("claims no plan when it cannot tell: a paying writer is never told they are on Free", () => {
    expect(planName(null)).toBeNull();
    expect(planName("nope")).toBeNull();
    expect(planName({})).toBeNull();
    expect(planName({ active: "yes", tier: "saga" })).toBeNull();
    expect(planName({ active: true, tier: null })).toBeNull();
    expect(planName({ active: true, tier: "  " })).toBeNull();
    expect(planName({ active: true, tier: 3 })).toBeNull();
  });
});

describe("accountSummary", () => {
  it("gives the plan and the balance", () => {
    expect(accountSummary("Storyteller", 12345)).toBe("Storyteller · 12,345 credits");
  });
  it("counts one credit as one", () => {
    expect(accountSummary("Free", 1)).toBe("Free · 1 credit");
    expect(accountSummary("Free", 0)).toBe("Free · 0 credits");
  });
  it("shows what it knows and nothing it does not", () => {
    expect(accountSummary(null, 40)).toBe("40 credits");
    expect(accountSummary("Saga", null)).toBe("Saga");
    expect(accountSummary(null, null)).toBeNull();
  });
  it("rounds and never shows a negative balance, as the desktop", () => {
    expect(accountSummary(null, 12.6)).toBe("13 credits");
    expect(accountSummary(null, -5)).toBe("0 credits");
  });
});
