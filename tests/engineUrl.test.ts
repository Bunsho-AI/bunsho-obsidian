import { describe, expect, it } from "vitest";
import { acceptableEngineUrl } from "@/utils/url";

describe("acceptableEngineUrl", () => {
  it("allows Bunsho's own engines over https", () => {
    expect(acceptableEngineUrl("https://engine.bunsho.io")).toBe(true);
    expect(acceptableEngineUrl("https://engine-stage.bunsho.io")).toBe(true);
  });

  it("allows plain http only on this machine", () => {
    expect(acceptableEngineUrl("http://localhost:8788")).toBe(true);
    expect(acceptableEngineUrl("http://127.0.0.1:8799")).toBe(true);
    expect(acceptableEngineUrl("http://engine.bunsho.io")).toBe(false);
    expect(acceptableEngineUrl("http://localhost.evil.com")).toBe(false);
  });

  it.each([
    "https://evil.example",
    "https://bunsho.io",
    "https://engine.bunsho.io.evil.example",
    "https://engine.bunsho.io@evil.example",
    "https://evil.engine.bunsho.io",
    "https://engine.bunsho.io:8443",
  ])("refuses %s, which would receive the writer's sign-in token", (address) => {
    expect(acceptableEngineUrl(address)).toBe(false);
  });

  it("refuses other schemes and text that is not an address", () => {
    expect(acceptableEngineUrl("ws://localhost:8788")).toBe(false);
    expect(acceptableEngineUrl("not a url")).toBe(false);
  });
});
