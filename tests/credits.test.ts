import { afterEach, describe, expect, it } from "vitest";
import { startMockEngine } from "../scripts/mock-engine.mjs";
import { claimStarterCredits } from "@/lib/services/engine/engineService";

let engine: Awaited<ReturnType<typeof startMockEngine>> | undefined;
afterEach(async () => { await engine?.close(); engine = undefined; });

const connectionTo = (port: number) => ({
  baseUrl: `http://127.0.0.1:${port}`, installId: "install", version: "0.1.0", devUid: "",
  tokens: { idToken: async () => "test" },
} as unknown as Parameters<typeof claimStarterCredits>[0]);

describe("starter credits", () => {
  it("claims the starter grant once; a second claim adds nothing", async () => {
    engine = await startMockEngine({ balance: 0, starter: 10000 });
    const connection = connectionTo(engine.port);
    expect(await claimStarterCredits(connection)).toBe(true);
    expect(await claimStarterCredits(connection)).toBe(true);
    const credits = await (await fetch(`http://127.0.0.1:${engine.port}/v1/credits`)).json() as { total: number };
    expect(credits.total).toBe(10000);
    expect(engine.requests.filter((r) => r.url === "/v1/credits/starter")).toHaveLength(2);
  });

  it("resolves false instead of throwing when the engine cannot be reached", async () => {
    expect(await claimStarterCredits(connectionTo(1))).toBe(false);
  });
});
