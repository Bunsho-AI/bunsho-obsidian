import { GOOGLE_G_SVG } from "@/assets/google";

/**
 * "Sign in with Google" in Google's own button style (branding guidelines): the standard G on a white button with a
 * grey border on light themes, Google's dark button on dark themes. Google does not allow its G on a custom-coloured
 * button, so this is not the amber fill.
 */
export interface GoogleSignInButtonProps { onClick: () => void }

export function GoogleSignInButton(parent: HTMLElement, { onClick }: GoogleSignInButtonProps): HTMLButtonElement {
  const button = parent.createEl("button", { cls: "bunsho-google" });
  const logo = button.createSpan({ cls: "bunsho-google-logo" });
  // Static markup from our own constant, never from data.
  logo.appendChild(new DOMParser().parseFromString(GOOGLE_G_SVG, "image/svg+xml").documentElement);
  button.createSpan({ text: "Sign in with Google" });
  button.onclick = onClick;
  return button;
}
