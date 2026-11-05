import { Fact } from "@/atoms/Fact";
import { TextAction } from "@/atoms/TextAction";
import type { RecordEntity, RecordRow } from "@/helpers/canon/world";
import type { WorldChange, WorldEntityFilter, WorldEntityType, WorldFilter, WorldRow } from "@/helpers/world";
import { filterChanges, filterWorld } from "@/helpers/world";
import { CanonAddControl } from "@/molecules/CanonAddControl";
import { CanonAliasRow } from "@/molecules/CanonAliasRow";
import { CanonFactRow } from "@/molecules/CanonFactRow";
import { CanonReadOnlyCard } from "@/molecules/CanonReadOnlyCard";
import { CanonStartInvitation } from "@/molecules/CanonStartInvitation";
import { GroupHeader } from "@/molecules/GroupHeader";
import { PanelTabs } from "@/molecules/PanelTabs";
import { TimelineRow } from "@/molecules/TimelineRow";

/**
 * The story record, grouped as the desktop's World tab: main, supporting, and those mentioned once as pills, and what changed
 * between chapters. What a check found opens its passage. The writer's pen is in `pen`, and nowhere when a plan has ended.
 */
/** The pen, as this list needs it. The page holds its state: each slot draws what is open at that place, and says whether it drew. */
export interface WorldListPen {
  addLabel: (type: WorldEntityType) => string;
  countLabel: (type: WorldEntityType, count: number) => string;
  /** The composer, when it is open for this type. */
  composer: (parent: HTMLElement, type: WorldEntityType) => boolean;
  openComposer: (type: WorldEntityType) => void;
  makeCanon: (entity: RecordEntity, row: RecordRow) => void;
  revert: (row: RecordRow) => void;
  openEdit: (entity: RecordEntity, row: RecordRow) => void;
  /** The edit state of this row, when it is open. */
  edit: (parent: HTMLElement, entity: RecordEntity, row: RecordRow) => boolean;
  openAlias: (entity: RecordEntity) => void;
  /** The alias field and any question under it. */
  alias: (parent: HTMLElement, entity: RecordEntity) => void;
  /** The fact composer or the rename state, when one is open on this card. */
  foot: (parent: HTMLElement, entity: RecordEntity) => boolean;
  openFact: (entity: RecordEntity) => void;
  openRename: (entity: RecordEntity) => void;
  /** The one quiet line for a write that did not land. */
  failure: string | null;
}

export interface WorldListProps {
  entities: readonly RecordEntity[];
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
  /** Null while a plan has ended, or the record cannot be read: every row still shows, with no verb. */
  pen: WorldListPen | null;
  /** The plan that ended, as its sentence. */
  lapsedTitle: string | null;
  /** canon.json could not be read: what to do about it. */
  canonProblem: string | null;
  onRenew: () => void;
}

const FILTERS: { id: WorldFilter; label: string; none: string }[] = [
  { id: "people", label: "People", none: "No people yet" },
  { id: "places", label: "Places", none: "No places yet" },
  { id: "things", label: "Things", none: "No things yet" },
  { id: "groups", label: "Groups", none: "No groups yet" },
  { id: "events", label: "Events", none: "No changes tracked yet. A check notes what moves on between chapters, such as where someone is." },
];
const VISIBLE_PILLS = 12;

const FILTER_TYPE: Record<WorldEntityFilter, WorldEntityType> = { people: "character", places: "location", things: "object", groups: "organization" };

function renderRow(parent: HTMLElement, entity: RecordEntity, row: RecordRow, props: WorldListProps): void {
  const { pen } = props;
  if (pen?.edit(parent, entity, row)) return;
  const { found } = row;
  const onVerb = !pen ? undefined : row.verb === "Make canon" ? () => pen.makeCanon(entity, row) : row.verb === "Revert" ? () => pen.revert(row) : () => pen.openEdit(entity, row);
  CanonFactRow(parent, { id: row.id, origin: row.origin, label: row.label, value: row.value, earlier: row.earlier, mark: row.mark, quote: found?.quote ?? null,
    note: found ? props.factNote(found) : null, verb: pen ? row.verb : null, onVerb, onGo: found ? () => props.onGo(found) : undefined });
}

function renderCard(parent: HTMLElement, entity: RecordEntity, props: WorldListProps): void {
  const open = props.expanded.has(entity.id);
  const { pen } = props;
  const card = parent.createDiv({ cls: "bunsho-card bunsho-world-card" });
  const head = card.createEl("button", { cls: "bunsho-world-head", attr: { "aria-expanded": String(open), "data-focus-key": `card:${entity.id}` } });
  head.onclick = () => props.onToggle(entity.id);
  head.createSpan({ cls: "bunsho-world-name", text: entity.name });
  if (entity.rows.length > 0) head.createSpan({ cls: "bunsho-fact", text: String(entity.rows.filter((r) => !r.earlier).length) });
  if (!open) {
    if (entity.aliases.length > 0) card.createDiv({ cls: "bunsho-fact bunsho-world-aliases", text: entity.aliases.slice(0, 3).join(" · ") });
    return;
  }
  CanonAliasRow(card, { aliases: entity.aliases, focusKey: `alias:${entity.id}`, onAddAlias: pen ? () => pen.openAlias(entity) : null });
  pen?.alias(card, entity);
  if (entity.rows.length === 0 && !pen) Fact(card, "Named in the story, with no facts filed yet");
  const earlier = entity.rows.filter((r) => r.earlier);
  const showHistory = props.history.has(entity.id);
  for (const row of entity.rows) if (!row.earlier || showHistory) renderRow(card, entity, row, props);
  if (earlier.length > 0) TextAction(card.createDiv({ cls: "bunsho-world-more" }), { label: showHistory ? "Hide earlier" : `Show ${earlier.length} earlier`, quiet: true, onClick: () => props.onToggleHistory(entity.id) }).setAttr("data-focus-key", `more:${entity.id}`);
  if (!pen || pen.foot(card, entity)) return;
  const foot = card.createDiv({ cls: "bunsho-card-foot bunsho-canon-foot" });
  TextAction(foot, { label: "Add a fact", plain: true, focusKey: `addfact:${entity.id}`, onClick: () => pen.openFact(entity) });
  TextAction(foot, { label: "Rename", quiet: true, focusKey: `rename:${entity.id}`, onClick: () => pen.openRename(entity) });
}

function renderChange(parent: HTMLElement, change: WorldChange, props: WorldListProps): void {
  const place = (row: WorldRow, end: string) => ({ coordinate: props.coordinate(row.pageId), focusKey: `event:${end}:${encodeURIComponent(change.key)}`, onGo: () => props.onGo(row) });
  TimelineRow(parent, { name: change.entityName, label: change.label, oldValue: change.from.value, newValue: change.to.value,
    from: place(change.from, "from"), to: place(change.to, "to"), note: props.factNote(change.from) ?? props.factNote(change.to) });
}

function renderPills(parent: HTMLElement, entities: RecordEntity[], props: WorldListProps): void {
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
  if (props.lapsedTitle) CanonReadOnlyCard(parent, { title: props.lapsedTitle, onRenew: props.onRenew });
  if (props.canonProblem) parent.createDiv({ cls: "bunsho-problem bunsho-note", text: props.canonProblem });
  if (props.pen?.failure) parent.createDiv({ cls: "bunsho-problem bunsho-note", text: props.pen.failure, attr: { role: "status" } });
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
  const { pen } = props;
  const type = FILTER_TYPE[filter];
  const all = filterWorld(props.entities, filter, "");
  const shown = filterWorld(props.entities, filter, props.search);
  if (shown.length === 0) {
    if (props.search.trim()) { none(); return; }
    if (pen?.composer(parent, type)) return;
    if (props.entities.length === 0 || pen) {
      const box = props.entities.length === 0 ? CanonStartInvitation(parent, { penOpen: Boolean(pen) }) : parent.createDiv();
      if (props.entities.length > 0) none();
      if (pen) CanonAddControl(box, { label: pen.addLabel(type), count: null, focusKey: `add:${type}`, onOpen: () => pen.openComposer(type) });
      return;
    }
    none();
    return;
  }
  if (pen && !pen.composer(parent, type)) CanonAddControl(parent, { label: pen.addLabel(type), count: pen.countLabel(type, all.length), focusKey: `add:${type}`, onOpen: () => pen.openComposer(type) });
  const section = (label: string, items: RecordEntity[], render: (box: HTMLElement) => void) => {
    if (items.length === 0) return;
    GroupHeader(parent, label, items.length, false);
    render(parent.createDiv({ cls: "bunsho-list" }));
  };
  const main = shown.filter((e) => e.tier === "main");
  const supporting = shown.filter((e) => e.tier === "supporting" || (e.tier === "mentioned" && e.writerTouched));
  const mentioned = shown.filter((e) => e.tier === "mentioned" && !e.writerTouched);
  section("Main", main, (box) => { for (const entity of main) renderCard(box, entity, props); });
  section("Supporting", supporting, (box) => { for (const entity of supporting) renderCard(box, entity, props); });
  section("Mentioned once", mentioned, (box) => renderPills(box, mentioned, props));
}
