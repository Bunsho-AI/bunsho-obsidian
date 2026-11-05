import { Fact } from "@/atoms/Fact";
import { TextAction } from "@/atoms/TextAction";
import type { WorldChange, WorldEntity, WorldEntityFilter, WorldFilter, WorldRow } from "@/helpers/world";
import { filterChanges, filterWorld } from "@/helpers/world";
import { GroupHeader } from "@/molecules/GroupHeader";
import { PanelTabs } from "@/molecules/PanelTabs";
import { TimelineRow } from "@/molecules/TimelineRow";

/**
 * The story as the last check read it, grouped as the desktop's World tab: main, supporting, and those mentioned once as
 * pills, and what changed between chapters. Read-only. A fact's quote opens the passage it came from.
 */
export interface WorldListProps {
  entities: readonly WorldEntity[];
  /** What changed between chapters, in story order. */
  changes: readonly WorldChange[];
  /** Where a page is, in the writer's terms. */
  coordinate: (pageId: string) => string;
  filter: WorldFilter;
  search: string;
  expanded: ReadonlySet<string>;
  /** Entities whose earlier values are showing. */
  history: ReadonlySet<string>;
  /** What the check could not read, so the writer is not misled by a gap. */
  gaps: readonly string[];
  /** Why a fact may no longer match the story, or null. */
  factNote: (row: WorldRow) => string | null;
  onFilter: (filter: WorldFilter) => void;
  /** Records the text only: this list redraws its own results, so the field keeps the writer's cursor and any IME composition. */
  onSearch: (search: string) => void;
  onComposing: (composing: boolean) => void;
  onToggle: (entityId: string) => void;
  onToggleHistory: (entityId: string) => void;
  onGo: (row: WorldRow) => void;
}

const FILTERS: { id: WorldFilter; label: string; none: string }[] = [
  { id: "people", label: "People", none: "No people yet" },
  { id: "places", label: "Places", none: "No places yet" },
  { id: "things", label: "Things", none: "No things yet" },
  { id: "groups", label: "Groups", none: "No groups yet" },
  { id: "events", label: "Events", none: "No changes tracked yet \u2014 Bunsho notes them as traits shift across chapters" },
];
const VISIBLE_PILLS = 12;

function renderRow(parent: HTMLElement, row: WorldRow, props: WorldListProps): void {
  const box = parent.createDiv({ cls: `bunsho-world-row${row.earlier ? " is-earlier" : ""}` });
  const line = box.createDiv({ cls: "bunsho-world-fact" });
  line.createSpan({ cls: "bunsho-world-label", text: row.label });
  line.createSpan({ cls: "bunsho-world-value", text: row.value });
  const quote = box.createDiv({ cls: "bunsho-passage bunsho-quote", text: row.quote, attr: { role: "button", tabindex: "0", "aria-label": `Go to the passage: ${row.quote}` } });
  quote.onclick = () => props.onGo(row);
  quote.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); props.onGo(row); } };
  const note = props.factNote(row);
  if (note) Fact(box, note);
}

function renderCard(parent: HTMLElement, entity: WorldEntity, props: WorldListProps): void {
  const open = props.expanded.has(entity.id);
  const card = parent.createDiv({ cls: "bunsho-card bunsho-world-card" });
  const head = card.createEl("button", { cls: "bunsho-world-head", attr: { "aria-expanded": String(open), "data-focus-key": `card:${entity.id}` } });
  head.onclick = () => props.onToggle(entity.id);
  head.createSpan({ cls: "bunsho-world-name", text: entity.name });
  if (entity.rows.length > 0) head.createSpan({ cls: "bunsho-fact", text: String(entity.rows.filter((r) => !r.earlier).length) });
  if (entity.aliases.length > 0) card.createDiv({ cls: "bunsho-fact bunsho-world-aliases", text: entity.aliases.slice(0, open ? undefined : 3).join(" · ") });
  if (!open) return;
  if (entity.rows.length === 0) { Fact(card, "Named in the story, with no facts filed yet"); return; }
  const earlier = entity.rows.filter((r) => r.earlier);
  const showHistory = props.history.has(entity.id);
  for (const row of entity.rows) if (!row.earlier || showHistory) renderRow(card, row, props);
  if (earlier.length > 0) TextAction(card.createDiv({ cls: "bunsho-world-more" }), { label: showHistory ? "Hide earlier" : `Show ${earlier.length} earlier`, quiet: true, onClick: () => props.onToggleHistory(entity.id) }).setAttr("data-focus-key", `more:${entity.id}`);
}

function renderChange(parent: HTMLElement, change: WorldChange, props: WorldListProps): void {
  const place = (row: WorldRow, end: string) => ({ coordinate: props.coordinate(row.pageId), focusKey: `event:${end}:${change.key}`, onGo: () => props.onGo(row) });
  TimelineRow(parent, { name: change.entityName, label: change.label, oldValue: change.from.value, newValue: change.to.value,
    from: place(change.from, "from"), to: place(change.to, "to"), note: props.factNote(change.from) ?? props.factNote(change.to) });
}

function renderPills(parent: HTMLElement, entities: WorldEntity[], props: WorldListProps): void {
  const open = entities.filter((e) => props.expanded.has(e.id));
  const closed = entities.filter((e) => !props.expanded.has(e.id));
  for (const entity of open) renderCard(parent, entity, props);
  const pills = parent.createDiv({ cls: "bunsho-world-pills" });
  const showAll = props.expanded.has("__mentioned__") || props.search.trim().length > 0;
  for (const entity of showAll ? closed : closed.slice(0, VISIBLE_PILLS)) {
    pills.createEl("button", { cls: "bunsho-world-pill", text: entity.name, attr: { "data-focus-key": `pill:${entity.id}` } }).onclick = () => props.onToggle(entity.id);
  }
  if (!showAll && closed.length > VISIBLE_PILLS) {
    pills.createEl("button", { cls: "bunsho-world-pill is-more", text: `+${closed.length - VISIBLE_PILLS}`, attr: { "data-focus-key": "pill:more" } }).onclick = () => props.onToggle("__mentioned__");
  }
}

export function WorldList(parent: HTMLElement, props: WorldListProps): void {
  const count = (filter: WorldFilter) => (filter === "events" ? props.changes.length : filterWorld(props.entities, filter, "").length);
  PanelTabs(parent, { cls: "is-filter", active: props.filter, onSelect: props.onFilter, tabs: FILTERS.map((f) => ({ id: f.id, label: `${f.label} ${count(f.id)}` })) });
  if (props.gaps.length > 0) {
    const named = props.gaps.slice(0, 3).join(", ");
    const more = props.gaps.length > 3 ? ` and ${props.gaps.length - 3} more` : "";
    parent.createDiv({ cls: "bunsho-problem bunsho-note", text: `Not in this list, because the check could not read it: ${named}${more}` });
  }
  const search = parent.createEl("input", { cls: "bunsho-world-search", type: "search", value: props.search, placeholder: "Search this list", attr: { "aria-label": "Search this list" } });
  const results = parent.createDiv();
  const draw = () => {
    results.empty();
    renderResults(results, { ...props, search: search.value });
  };
  search.oninput = (event) => {
    if ((event as InputEvent).isComposing) return; // the text is not final until the IME commits it
    props.onSearch(search.value);
    draw();
  };
  search.addEventListener("compositionstart", () => props.onComposing(true));
  search.addEventListener("compositionend", () => {
    props.onSearch(search.value);
    draw();
    props.onComposing(false);
  });
  draw();
}

function renderResults(parent: HTMLElement, props: WorldListProps): void {
  const none = () => Fact(parent, props.search.trim() ? "Nothing matches" : FILTERS.find((f) => f.id === props.filter)?.none ?? "", "bunsho-note");
  if (props.filter === "events") {
    const changes = filterChanges(props.changes, props.search);
    if (changes.length === 0) { none(); return; }
    const list = parent.createDiv({ cls: "bunsho-list" });
    for (const change of changes) renderChange(list, change, props);
    return;
  }
  renderEntities(parent, props, props.filter, none);
}

function renderEntities(parent: HTMLElement, props: WorldListProps, filter: WorldEntityFilter, none: () => void): void {
  const shown = filterWorld(props.entities, filter, props.search);
  if (shown.length === 0) { none(); return; }
  const section = (label: string, items: WorldEntity[], render: (box: HTMLElement) => void) => {
    if (items.length === 0) return;
    GroupHeader(parent, label, items.length, false);
    render(parent.createDiv({ cls: "bunsho-list" }));
  };
  const main = shown.filter((e) => e.tier === "main");
  const supporting = shown.filter((e) => e.tier === "supporting");
  const mentioned = shown.filter((e) => e.tier === "mentioned");
  section("Main", main, (box) => { for (const entity of main) renderCard(box, entity, props); });
  section("Supporting", supporting, (box) => { for (const entity of supporting) renderCard(box, entity, props); });
  section("Mentioned once", mentioned, (box) => renderPills(box, mentioned, props));
}
