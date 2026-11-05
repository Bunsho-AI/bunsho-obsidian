import { FillButton } from "@/atoms/FillButton";
import { QUILL_AI_UPSELL } from "@/helpers/director/sceneView";

/** Quill, the non-AI tier: the demonstration and the Storyteller upsell where the composer would be. The affordance, not the enforcement: the engine refuses the spend. */
export function DirectorUpsell(parent: HTMLElement, { onUpgrade }: { onUpgrade: () => void }): void {
  const root = parent.createDiv({ cls: "bunsho-director-upsell" });
  const sheet = root.createDiv({ cls: "bunsho-director-upsell-sheet" });
  sheet.createDiv({ cls: "bunsho-fact", text: "beat 1 · unwritten" });
  sheet.createDiv({ cls: "bunsho-director-upsell-line", text: "the scene’s opening line, once you approve the plan" });
  root.createEl("p", { cls: "bunsho-director-line", text: "Direct a scene in plain words — Bunsho plans it as beats you approve. Nothing is written or charged until the plan is right." });
  root.createEl("p", { cls: "bunsho-director-line", text: QUILL_AI_UPSELL.body });
  FillButton(root, { label: QUILL_AI_UPSELL.action, focusKey: "director:upgrade", onClick: onUpgrade });
}
