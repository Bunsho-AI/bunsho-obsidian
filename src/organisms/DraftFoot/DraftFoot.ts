import { FillButton } from "@/atoms/FillButton";
import { SceneAnchorLine, type SceneAnchorLineProps } from "@/molecules/SceneAnchorLine";

/** Pinned under the draft, always reachable. Keep is the only gold; Discard is never louder. */
export interface DraftFootProps {
  anchor: SceneAnchorLineProps;
  keeping: boolean;
  locked: boolean;
  message: string | null;
  onKeep: () => void;
  onDiscard: () => void;
}

export function DraftFoot(parent: HTMLElement, { anchor, keeping, locked, message, onKeep, onDiscard }: DraftFootProps): void {
  const foot = parent.createDiv({ cls: "bunsho-draft-foot" });
  if (message) foot.createDiv({ cls: "bunsho-director-line", text: message, attr: { role: "status" } });
  SceneAnchorLine(foot, anchor);
  const actions = foot.createDiv({ cls: "bunsho-draft-actions" });
  const keep = FillButton(actions, { label: "Keep", focusKey: "draft:keep", onClick: onKeep });
  keep.disabled = locked;
  if (keeping) keep.addClass("is-reading");
  const discard = actions.createEl("button", { cls: "bunsho-pen is-quiet", text: "Discard", attr: { "data-focus-key": "draft:discard" } });
  discard.disabled = locked;
  discard.onclick = onDiscard;
}
