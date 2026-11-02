import { describe, expect, it } from "vitest";
import { missingSignInValues } from "@/lib/services/auth/authConfig";

const complete = { firebaseApiKey: "key", googleClientId: "cid", googleClientSecret: "secret" };

describe("missingSignInValues", () => {
  it("passes a build that can sign in", () => {
    expect(missingSignInValues(complete)).toEqual([]);
  });

  it("names every value a build cannot sign in without", () => {
    expect(missingSignInValues({ ...complete, googleClientId: "", googleClientSecret: "" }))
      .toEqual(["googleClientId", "googleClientSecret"]);
    expect(missingSignInValues({ ...complete, firebaseApiKey: "" })).toEqual(["firebaseApiKey"]);
  });
});
