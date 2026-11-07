import { price, STATUS_WORDS, type SceneRowStatus } from "@/helpers/director/sceneView";

/** A folded scene. Framed: the just-kept scene with its one-time check offer. */
export interface SceneRowProps {
  title: string;
  status: SceneRowStatus;
  chapterOrdinal?: number;
  chapterTitle?: string;
  framed?: boolean;
  focusKey: string;
  checkOffer?: boolean;
  checkPrice?: number | null;
  checking?: boolean;
  /** Why this chapter cannot be checked yet, in place of the priced button. */
  checkHint?: string | null;
  onOpen?: () => void;
  onCheck?: () => void;
  onDismissCheck?: () => void;
}

export function SceneRow(parent: HTMLElement, props: SceneRowProps): void {
  const { title, status, chapterOrdinal, framed } = props;
  const meta = `${STATUS_WORDS[status]}${chapterOrdinal !== undefined ? ` · ch${chapterOrdinal}` : ""}`;
  const holder = framed ? parent.createDiv({ cls: "bunsho-scene-frame" }) : parent;
  const head = holder.createEl("button", { cls: `bunsho-scene-row${framed ? " is-framed" : ""}`, attr: { "data-focus-key": props.focusKey } });
  head.createSpan({ cls: "bunsho-scene-row-title", text: title });
  head.createSpan({ cls: "bunsho-fact bunsho-scene-row-meta", text: meta });
  head.disabled = !props.onOpen;
  if (props.onOpen) head.onclick = props.onOpen;
  if (!framed) return;
  const label = price(props.checkPrice);
  if (props.checking) {
    const row = holder.createDiv({ cls: "bunsho-scene-check is-checking" });
    row.createSpan({ cls: "bunsho-fact is-reading", text: `checking ch${chapterOrdinal ?? ""}${label ? ` · ${label}` : ""}` });
    row.createSpan({ cls: "bunsho-small", text: "Results in Continuity" });
    return;
  }
  if (!props.checkOffer) return;
  const offer = holder.createDiv({ cls: "bunsho-scene-check" });
  offer.createSpan({ cls: "bunsho-director-line", text: `${props.chapterTitle ?? "The chapter"} changed. Check it against the record?` });
  if (props.checkHint) offer.createSpan({ cls: "bunsho-director-line", text: props.checkHint });
  const actions = offer.createDiv({ cls: "bunsho-note-slot-actions" });
  if (label) {
    const check = actions.createEl("button", { cls: "bunsho-outlined", attr: { "data-focus-key": "check:offer" } });
    check.createSpan({ text: "Check this chapter" });
    check.createSpan({ cls: "bunsho-fact", text: label });
    if (props.onCheck) check.onclick = props.onCheck;
  }
  const not = actions.createEl("button", { cls: "bunsho-pen is-quiet", text: "Not now", attr: { "data-focus-key": "check:dismiss" } });
  if (props.onDismissCheck) not.onclick = props.onDismissCheck;
}

export function EarlierScenesHead(parent: HTMLElement, count: number): void {
  const head = parent.createDiv({ cls: "bunsho-earlier-head" });
  head.createSpan({ cls: "bunsho-earlier-label", text: "Earlier scenes" });
  head.createSpan({ cls: "bunsho-earlier-rule" });
  head.createSpan({ cls: "bunsho-fact", text: String(count) });
}
