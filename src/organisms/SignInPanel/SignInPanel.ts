import { BunshoWordmark } from "@/atoms/BunshoWordmark";
import { GoogleSignInButton } from "@/atoms/GoogleSignInButton";

/** Signed out, this is the whole panel: nothing in the plugin works without a Bunsho sign-in. */
export interface SignInPanelProps { problem: string | null; onSignIn: () => void }

export function SignInPanel(parent: HTMLElement, { problem, onSignIn }: SignInPanelProps): HTMLElement {
  const box = parent.createDiv({ cls: "bunsho-empty bunsho-signin" });
  BunshoWordmark(box, 28);
  box.createDiv({ cls: "bunsho-empty-title", text: "Check your story for contradictions" });
  box.createEl("p", { cls: "bunsho-empty-body", text: "Sign in with the Google account you use for Bunsho. Your writing is only sent when you confirm a check." });
  if (problem) box.createEl("p", { cls: "bunsho-problem", text: problem });
  GoogleSignInButton(box, { onClick: onSignIn });
  return box;
}
