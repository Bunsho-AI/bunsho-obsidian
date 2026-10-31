import { BunshoWordmark } from "@/atoms/BunshoWordmark";
import { FillButton } from "@/atoms/FillButton";

/** Signed out, this is the whole panel: nothing in the plugin works without a Bunsho sign-in. */
export interface SignInPanelProps { problem: string | null; onSignIn: () => void }

export function SignInPanel(parent: HTMLElement, { problem, onSignIn }: SignInPanelProps): HTMLElement {
  const box = parent.createDiv({ cls: "bunsho-empty bunsho-signin" });
  BunshoWordmark(box, 28);
  box.createDiv({ cls: "bunsho-empty-title", text: "Check your story for contradictions" });
  box.createEl("p", { cls: "bunsho-empty-body", text: "Sign in with the Google account you use for Bunsho. Your chapters are only sent when you start a check." });
  if (problem) box.createEl("p", { cls: "bunsho-problem", text: problem });
  FillButton(box, { label: "Sign in with Google", onClick: onSignIn });
  return box;
}
