import { describe, expect, it } from "vitest";
import { SUPPORT_EMAIL, supportMailto } from "@/helpers/support";

describe("supportMailto", () => {
  it("opens a draft to the public support address, saying which plugin", () => {
    const url = new URL(supportMailto("0.1.0"));
    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe(SUPPORT_EMAIL);
    expect(SUPPORT_EMAIL).toBe("support@bunsho.io");
    expect(url.searchParams.get("subject")).toBe("Bunsho for Obsidian 0.1.0");
  });
  it("carries nothing but the subject: no body, no account, no manuscript text", () => {
    expect([...new URL(supportMailto("0.1.0")).searchParams.keys()]).toEqual(["subject"]);
  });
  it("cannot be broken by a version string", () => {
    const url = new URL(supportMailto("1.0&body=x y"));
    expect([...url.searchParams.keys()]).toEqual(["subject"]);
    expect(url.searchParams.get("subject")).toBe("Bunsho for Obsidian 1.0&body=x y");
  });
});
