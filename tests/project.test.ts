import { describe, expect, it } from "vitest";
import { projectState } from "@/helpers/project";
import { readProjectState } from "@/lib/services/project/projectService";

const reg = (workspaceId: string, name: string | null = "Harbour") => ({ registration: { workspaceId, name, registeredAt: "2026-10-31T00:00:00Z", revision: 1 } });

describe("projectState", () => {
  it("never limits a paid plan", () => {
    expect(projectState({ active: true }, reg("other"), "mine").state).toBe("paid");
  });
  it("free with no project registered: this manuscript will become it", () => {
    expect(projectState({ active: false }, { registration: null }, "mine").state).toBe("unregistered");
  });
  it("free and this is the registered project", () => {
    expect(projectState({ active: false }, reg("mine"), "mine").state).toBe("ok");
  });
  it("free and another manuscript is the project: blocked, with its name", () => {
    expect(projectState({ active: false }, reg("other", "Nine Fathoms"), "mine")).toEqual({ state: "blocked", registeredName: "Nine Fathoms" });
  });
  it("does not block when the plan or registry cannot be read", () => {
    expect(projectState(null, reg("other"), "mine").state).toBe("unknown");
    expect(projectState({ active: false }, null, "mine").state).toBe("unknown");
    expect(projectState({ active: false }, { registration: { name: "x" } }, "mine").state).toBe("unknown");
  });
});

describe("readProjectState", () => {
  const transport = (answers: Record<string, unknown>) => ({ getJson: (path: string) => (path in answers ? Promise.resolve(answers[path]) : Promise.reject(new Error("down"))) }) as never;
  it("gives the plan's name from the one subscription read it already makes", async () => {
    const seen: string[] = [];
    const t = { getJson: (path: string) => { seen.push(path); return Promise.resolve(path.includes("billing") ? { active: true, tier: "saga" } : { registration: null }); } } as never;
    expect(await readProjectState(t, "mine")).toEqual({ state: "paid", registeredName: null, planName: "Saga" });
    expect(seen.filter((path) => path === "/v1/billing/subscription")).toHaveLength(1);
  });
  it("claims no plan when the read failed, and does not fail", async () => {
    expect(await readProjectState(transport({}), "mine")).toEqual({ state: "unknown", registeredName: null, planName: null });
  });
});
