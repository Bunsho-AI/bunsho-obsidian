import { describe, expect, it } from "vitest";
import { projectState } from "@/helpers/project";

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
