import { describe, expect, it } from "vitest";
import { acceptableEngineUrl } from "@/utils/url";

describe("acceptableEngineUrl", () => {
  it("allows https and local http only", () => {
    expect(acceptableEngineUrl("https://engine.bunsho.io")).toBe(true);
    expect(acceptableEngineUrl("http://localhost:8788")).toBe(true);
    expect(acceptableEngineUrl("http://127.0.0.1:8799")).toBe(true);
    expect(acceptableEngineUrl("http://engine.bunsho.io")).toBe(false);
    expect(acceptableEngineUrl("http://localhost.evil.com")).toBe(false);
    expect(acceptableEngineUrl("ws://localhost:8788")).toBe(false);
    expect(acceptableEngineUrl("not a url")).toBe(false);
  });
});
