import { describe, expect, it } from "vitest";
import { missingSignInValues } from "@/lib/services/auth/authConfig";

const complete = { firebaseApiKey: "key", firebaseAuthDomain: "x.firebaseapp.com", firebaseAppId: "app" };

describe("missingSignInValues", () => {
  it("passes a build that can sign in", () => {
    expect(missingSignInValues(complete)).toEqual([]);
  });

  it("names every value a build cannot sign in without", () => {
    expect(missingSignInValues({ ...complete, firebaseAuthDomain: "", firebaseAppId: "" }))
      .toEqual(["firebaseAuthDomain", "firebaseAppId"]);
    expect(missingSignInValues({ ...complete, firebaseApiKey: "" })).toEqual(["firebaseApiKey"]);
  });
});
