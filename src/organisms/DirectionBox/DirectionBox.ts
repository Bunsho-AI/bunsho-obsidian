import { setIcon } from "obsidian";
import { PenArea } from "@/atoms/PenArea";
import type { DirectorCastMember } from "@/helpers/director/cast";
import { activeMention, mentionMatches, price } from "@/helpers/director/sceneView";
import { SceneAnchorLine, type SceneAnchorLineProps } from "@/molecules/SceneAnchorLine";

/** The read-only well above a card, with Edit direction. */
export function DirectionWell(parent: HTMLElement, { value, onEdit }: { value: string; onEdit?: () => void }): void {
  const well = parent.createDiv({ cls: "bunsho-direction-well" });
  const head = well.createDiv({ cls: "bunsho-direction-well-head" });
  head.createSpan({ cls: "bunsho-earlier-label", text: "Direction" });
  if (onEdit) {
    const edit = head.createEl("button", { cls: "bunsho-pen", text: "Edit direction", attr: { "data-focus-key": "direction:edit" } });
    edit.onclick = onEdit;
  }
  well.createSpan({ cls: "bunsho-director-line", text: value });
}

export interface DirectionBoxProps {
  value: string;
  placeholder: string;
  planPrice: number | null;
  anchor: SceneAnchorLineProps;
  cast: readonly DirectorCastMember[];
  /** Another action is running: the box cannot plan. */
  busy: boolean;
  onChange: (value: string) => void;
  onComposing: (composing: boolean) => void;
  onPlan: () => void;
  onCancelEdit?: () => void;
}

/** The direction, at the head of the tab: a placeholder written with the book's own cast, the cast @ list under it. Plan scene is outlined, never filled: gold belongs to Write scene and Keep. */
export function DirectionBox(parent: HTMLElement, props: DirectionBoxProps): void {
  const root = parent.createDiv({ cls: "bunsho-direction" });
  const box = root.createDiv({ cls: "bunsho-direction-box" });
  let mention: { query: string; start: number } | null = null;
  let index = 0;
  let list: HTMLElement | null = null;
  let matches: DirectorCastMember[] = [];

  const closeList = (): void => { list?.remove(); list = null; mention = null; matches = []; };
  const drawList = (): void => {
    list?.remove();
    list = null;
    if (!mention || matches.length === 0) return;
    list = root.createDiv({ cls: "bunsho-mention-list" });
    list.createDiv({ cls: "bunsho-fact bunsho-mention-head", text: "cast in this scene" });
    matches.forEach((member, at) => {
      const row = (list as HTMLElement).createEl("button", { cls: `bunsho-mention-row${at === index ? " is-active" : ""}` });
      setIcon(row.createSpan({ cls: "bunsho-mention-icon", attr: { "aria-hidden": "true" } }), "user");
      row.createSpan({ cls: "bunsho-mention-name", text: member.name });
      row.createSpan({ cls: "bunsho-fact", text: String(member.appearances) });
      row.onmousedown = (event) => { event.preventDefault(); select(member); };
    });
  };
  const sync = (field: HTMLTextAreaElement): void => {
    mention = activeMention(field.value, field.selectionStart ?? 0);
    matches = mention ? mentionMatches(props.cast, mention.query) : [];
    index = 0;
    drawList();
  };
  const select = (member: DirectorCastMember): void => {
    if (!mention) return;
    const caret = field.selectionStart ?? field.value.length;
    const inserted = `@${member.name} `;
    const position = mention.start + inserted.length;
    field.value = field.value.slice(0, mention.start) + inserted + field.value.slice(caret);
    props.onChange(field.value);
    closeList();
    field.focus();
    field.setSelectionRange(position, position);
    refresh();
  };

  const field = PenArea(box, { value: props.value, label: "Direction", focusKey: "direction:field", placeholder: props.placeholder, rows: 3, maxLength: 4000, cls: "bunsho-direction-field", onComposing: props.onComposing,
    onInput: (value, element) => { props.onChange(value); sync(element); refresh(); },
    onKey: (event, element) => {
      if (mention && matches.length > 0) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); index = (index + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length; drawList(); return; }
        if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); select(matches[index]); return; }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeList(); return; }
      }
      if (event.key === "Escape" && props.onCancelEdit) { event.preventDefault(); event.stopPropagation(); props.onCancelEdit(); return; }
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (canPlan()) props.onPlan(); else void element; }
    } });
  field.onclick = () => sync(field);
  field.onblur = () => { window.setTimeout(closeList, 150); };

  const foot = box.createDiv({ cls: "bunsho-direction-foot" });
  SceneAnchorLine(foot, props.anchor);
  const actions = foot.createDiv({ cls: "bunsho-direction-actions" });
  if (props.onCancelEdit) {
    const cancel = actions.createEl("button", { cls: "bunsho-pen is-quiet", text: "Cancel", attr: { "data-focus-key": "direction:cancel" } });
    cancel.onclick = props.onCancelEdit;
  }
  const label = price(props.planPrice);
  const plan = actions.createEl("button", { cls: "bunsho-outlined is-plan", attr: { "data-focus-key": "direction:plan" } });
  plan.createSpan({ text: "Plan scene" });
  if (label) plan.createSpan({ cls: "bunsho-fact", text: label });
  plan.onclick = () => { if (canPlan()) props.onPlan(); };
  function canPlan(): boolean { return field.value.trim().length > 0 && !props.busy && label !== null; }
  function refresh(): void { plan.disabled = !canPlan(); }
  refresh();
}
