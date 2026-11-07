import { GOOGLE_G_SVG } from "@/assets/google";

/** Firebase's own browser SDK, pinned. It runs only in the writer's browser, never inside Obsidian. */
const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/13.0.0";

export interface SignInPageConfig { firebaseApiKey: string; firebaseAuthDomain: string; firebaseAppId: string }

/** Values go into a script tag: "<" is escaped so no value can close it. */
const scriptJson = (value: unknown): string => JSON.stringify(value).replace(/</gu, "\\u003c");

/** The page the browser opens: one Google button, then the Firebase session goes back to the plugin's local server. */
export function signInPageHtml(config: SignInPageConfig, state: string): string {
  const firebase = { apiKey: config.firebaseApiKey, authDomain: config.firebaseAuthDomain, appId: config.firebaseAppId };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in to Bunsho</title></head>
<body style="margin:0;background:#efe9dc;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">
<main style="background:#fffdf8;border:1px solid #e8e1d2;border-radius:12px;padding:40px;max-width:420px;margin:24px;text-align:center;border-top:3px solid #dfa803">
<div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#2f2a20;margin-bottom:20px">Bunsho</div>
<h1 id="heading" style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:400;color:#2f2a20;margin:0 0 12px">Sign in to the Obsidian plugin</h1>
<p id="message" style="font-size:15px;line-height:1.5;color:#55493a;margin:0 0 24px">Use the Google account you use for Bunsho.</p>
<button id="google" disabled style="display:inline-flex;align-items:center;gap:10px;padding:10px 16px;background:#fff;color:#1f1f1f;border:1px solid #747775;border-radius:4px;font:500 14px Roboto,system-ui,sans-serif;cursor:pointer"><span style="display:flex;width:18px;height:18px">${GOOGLE_G_SVG}</span>Sign in with Google</button>
</main>
<script type="module">
import { initializeApp } from "${FIREBASE_SDK}/firebase-app.js";
import { getAuth, setPersistence, inMemoryPersistence, GoogleAuthProvider, signInWithPopup } from "${FIREBASE_SDK}/firebase-auth.js";
const state = ${scriptJson(state)};
const button = document.getElementById("google");
const say = (heading, message) => {
  document.getElementById("heading").textContent = heading;
  document.getElementById("message").textContent = message;
};
const auth = getAuth(initializeApp(${scriptJson(firebase)}));
await setPersistence(auth, inMemoryPersistence); // nothing stays in this browser
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
button.disabled = false;
button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    const { user } = await signInWithPopup(auth, provider);
    const response = await fetch("/complete", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, refreshToken: user.refreshToken }) });
    if (!response.ok) throw new Error("not accepted");
    button.hidden = true;
    say("You're signed in.", "You can close this tab and return to Obsidian.");
  } catch (error) {
    const cancelled = error?.code === "auth/popup-closed-by-user" || error?.code === "auth/cancelled-popup-request";
    if (!cancelled) say("Sign-in didn't complete.", "Try again, or return to Obsidian and start over.");
    button.disabled = false;
  }
});
</script></body></html>`;
}
