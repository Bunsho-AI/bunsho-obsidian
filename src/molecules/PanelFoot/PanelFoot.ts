import { AiNotice } from "@/atoms/AiNotice";
import { TextAction } from "@/atoms/TextAction";

/** The panel's foot, always in view: the desktop's one quiet line about AI, and the way to reach a person. */
export interface PanelFootProps { onContactSupport: () => void }

export function PanelFoot(parent: HTMLElement, { onContactSupport }: PanelFootProps): HTMLElement {
  const foot = parent.createDiv({ cls: "bunsho-panel-foot" });
  AiNotice(foot);
  TextAction(foot, { label: "Contact support", quiet: true, focusKey: "foot:support", onClick: onContactSupport });
  return foot;
}
