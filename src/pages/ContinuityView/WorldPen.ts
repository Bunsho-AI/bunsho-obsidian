/**
 * The pen's state in the World tab: what is open, what is typed, what was asked. A page-layer helper of the panel: it reads the
 * controller and hands the list plain slots. A draft lives here, so a redraw from a rescan or an account refresh cannot lose it.
 */
import { DIMENSION_GROUPS, dimensionEntry } from "@/helpers/canon/dimensions";
import type { IdentityMatch, IdentityResolution, PenResult } from "@/helpers/canon/pen";
import type { RecordEntity } from "@/helpers/canon/world";
import type { ContinuityController } from "@/controllers/ContinuityController";
import type { WorldEntityType } from "@/helpers/world";
import { IdentityPrompt } from "@/molecules/IdentityPrompt";
import { CanonEntityComposer } from "@/organisms/CanonEntityComposer";
import { CanonEntityRename } from "@/organisms/CanonEntityRename";
import { CanonFactComposer } from "@/organisms/CanonFactComposer";
import { CanonFactEdit } from "@/organisms/CanonFactEdit";
import type { WorldListPen } from "@/organisms/WorldList";
import { PenField } from "@/atoms/PenField";

/** The one quiet line for a write that did not land, here and on the Resolve screen. */
export const PEN_FAILURE_COPY = "That could not be saved. Nothing changed.";
const STALE_COPY = "That fact changed since it was shown — reloading";

const NOUN: Record<WorldEntityType, string> = { character: "character", location: "place", object: "object", organization: "group" };
const PLURAL: Record<WorldEntityType, string> = { character: "people", location: "places", object: "things", organization: "groups" };
const SINGULAR: Record<WorldEntityType, string> = { character: "person", location: "place", object: "thing", organization: "group" };
const NEW_ENTITY_DETAIL = "__new_entity__";
const NEW_ENTITY_DETAIL_LABEL = "Someone not in the record yet";
const DEFAULT_DIMENSION = DIMENSION_GROUPS[0].items[0].key;

const splitAliases = (raw: string): string[] => raw.split(/[,、،，]/u).map((text) => text.trim()).filter(Boolean);

interface EntityDraft { type: WorldEntityType; name: string; aliases: string; identity: IdentityMatch | null; busy: boolean }
interface FactDraft { entityId: string; dimension: string; detail: string | null; detailLabel: string | null; value: string; busy: boolean; inline: EntityDraft | null }
interface AliasDraft { entityId: string; draft: string; identity: IdentityMatch | null }
interface RenameDraft { entityId: string; name: string; identity: IdentityMatch | null; cited: number | null; busy: boolean }
interface EditDraft { rowId: string; value: string }

export interface WorldPenHost {
  redraw(focusKey?: string): void;
  composing(composing: boolean): void;
  expand(entityId: string): void;
}

export class WorldPen {
  private composerDraft: EntityDraft | null = null;
  private factDraft: FactDraft | null = null;
  private aliasDraft: AliasDraft | null = null;
  private renameDraft: RenameDraft | null = null;
  private editDraft: EditDraft | null = null;
  private failure: string | null = null;

  constructor(private readonly controller: ContinuityController, private readonly host: WorldPenHost) {}

  /** A writer who was typing keeps it through a change of tab. Another book's cards are another matter. */
  reset(): void { this.composerDraft = null; this.factDraft = null; this.aliasDraft = null; this.renameDraft = null; this.editDraft = null; this.failure = null; }

  private coordinate(pageId: string | undefined): string | null {
    return pageId ? this.controller.currentReview()?.pages.find((page) => page.pageId === pageId)?.label ?? null : null;
  }

  /** What a refusal means here. Nothing to show for a question or a stale row: both are answered in place. */
  private report(result: PenResult<unknown>): void {
    if (result.success || result.code === "IDENTITY_AMBIGUOUS" || result.code === "ENTITY_IN_USE") { this.failure = null; return; }
    this.failure = result.code === "STALE_TARGET" ? STALE_COPY : PEN_FAILURE_COPY;
  }

  private question(parent: HTMLElement, match: IdentityMatch, focusKey: string, onLink: () => void, onCreate: () => void): void {
    IdentityPrompt(parent, { name: match.canonicalName, type: match.type, quote: match.sample?.quote ?? null, coordinate: this.coordinate(match.sample?.pageId), focusKey, onLink, onCreate });
  }

  private async submitEntity(draft: EntityDraft, resolution: IdentityResolution | undefined, matched: IdentityMatch | null, done: (entityId: string) => void): Promise<void> {
    const name = draft.name.trim();
    if (!name || draft.busy) return;
    draft.busy = true;
    const result = await this.controller.addEntity(name, draft.type, splitAliases(draft.aliases), resolution, matched?.ref);
    draft.busy = false;
    this.report(result);
    if (result.success) { done(result.data.entityId); return; }
    if (result.code === "IDENTITY_AMBIGUOUS" && result.match) draft.identity = result.match;
    this.host.redraw();
  }

  private entityComposer(parent: HTMLElement, draft: EntityDraft, focusKey: string, onCancel: () => void, done: (entityId: string) => void): void {
    const noun = NOUN[draft.type];
    CanonEntityComposer(parent, {
      heading: `New ${noun}`, addLabel: `Add ${noun}`, name: draft.name, aliases: draft.aliases, asking: draft.identity !== null, busy: draft.busy, focusKey,
      onName: (name) => { const was = draft.identity; draft.name = name; draft.identity = null; if (was) this.host.redraw(`${focusKey}:name`); },
      onAliases: (aliases) => { draft.aliases = aliases; },
      onComposing: (composing) => this.host.composing(composing),
      onSubmit: () => void this.submitEntity(draft, undefined, null, done),
      onCancel,
      slot: draft.identity ? (slot) => {
        const match = draft.identity as IdentityMatch;
        this.question(slot, match, `${focusKey}:link`, () => void this.submitEntity(draft, "alias_of_existing", match, done), () => void this.submitEntity(draft, "new_entity", null, done));
      } : undefined,
    });
  }

  private openFact(entity: RecordEntity): void {
    this.closeCardStates();
    this.factDraft = { entityId: entity.id, dimension: DEFAULT_DIMENSION, detail: null, detailLabel: null, value: "", busy: false, inline: null };
    this.host.redraw(`fact:${entity.id}:value`);
  }

  private closeCardStates(): void { this.factDraft = null; this.renameDraft = null; this.aliasDraft = null; this.editDraft = null; this.failure = null; }

  private async submitFact(draft: FactDraft): Promise<void> {
    if (draft.busy) return;
    draft.busy = true;
    const result = await this.controller.addFact(draft.entityId, draft.dimension, draft.detail, draft.value);
    draft.busy = false;
    this.report(result);
    // Stays open and clears, with the dimension kept: a writer adding facts adds several.
    if (result.success) { this.factDraft = { ...draft, value: "", detail: null, detailLabel: null, inline: null }; }
    this.host.redraw(`fact:${draft.entityId}:value`);
  }

  private factComposer(parent: HTMLElement, entity: RecordEntity, draft: FactDraft): void {
    const focusKey = `fact:${entity.id}`;
    const entry = dimensionEntry(draft.dimension);
    const others = this.controller.worldRecord().filter((other) => other.id !== entity.id);
    const options = entry?.detail === "object" ? others.filter((o) => o.type === "object") : others;
    const detailOptions = entry?.detail && entry.detail !== "topic" ? [...options.map((o) => ({ value: o.id, label: o.name })), ...(entry.detail === "entity" ? [{ value: NEW_ENTITY_DETAIL, label: NEW_ENTITY_DETAIL_LABEL }] : [])] : [];
    CanonFactComposer(parent, {
      dimension: draft.dimension, detail: draft.detail, detailLabel: draft.detailLabel, detailOptions, value: draft.value, busy: draft.busy, focusKey,
      mark: `canon · you · ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" }).toLocaleLowerCase()}`,
      onDimension: (dimension) => { draft.dimension = dimension; draft.detail = null; draft.detailLabel = null; draft.inline = null; this.host.redraw(`${focusKey}:dimension`); },
      onDetail: (detail, label) => {
        if (detail === NEW_ENTITY_DETAIL) { draft.inline = { type: "character", name: "", aliases: "", identity: null, busy: false }; draft.detail = null; draft.detailLabel = null; this.host.redraw(`${focusKey}:inline:name`); return; }
        draft.detail = detail || null; draft.detailLabel = label || null; draft.inline = null; this.host.redraw(`${focusKey}:value`);
      },
      onTopic: (topic) => { draft.detail = topic; },
      onValue: (value) => { draft.value = value; },
      onComposing: (composing) => this.host.composing(composing),
      onSubmit: () => void this.submitFact(draft),
      onCancel: () => { this.factDraft = null; this.host.redraw(`addfact:${entity.id}`); },
      slot: draft.inline ? (slot) => {
        const inline = draft.inline as EntityDraft;
        this.entityComposer(slot, inline, `${focusKey}:inline`, () => { draft.inline = null; this.host.redraw(`${focusKey}:detail`); }, (entityId) => {
          // Returns with the new person selected. Their card's id is the record's until a check finds them.
          const made = this.controller.worldRecord().find((e) => e.canonId === entityId);
          draft.detail = made?.id ?? entityId; draft.detailLabel = made?.name ?? inline.name.trim(); draft.inline = null;
          this.host.redraw(`${focusKey}:value`);
        });
      } : undefined,
    });
  }

  private async submitRename(draft: RenameDraft, entity: RecordEntity, resolution?: IdentityResolution): Promise<void> {
    if (draft.busy) return;
    draft.busy = true;
    const result = await this.controller.renameEntity(entity.id, draft.name, resolution);
    draft.busy = false;
    this.report(result);
    if (result.success) { this.renameDraft = null; this.host.expand(this.controller.worldRecord().find((e) => e.canonId === result.data.entityId)?.id ?? entity.id); this.host.redraw(`rename:${entity.id}`); return; }
    if (result.code === "IDENTITY_AMBIGUOUS" && result.match) draft.identity = result.match;
    this.host.redraw(`rename-state:${entity.id}:name`);
  }

  private async removeEntity(draft: RenameDraft, entity: RecordEntity): Promise<void> {
    if (!entity.canonId) { draft.cited = entity.pages; this.host.redraw(`rename-state:${entity.id}:remove`); return; }
    const result = await this.controller.removeEntity(entity.canonId);
    this.report(result);
    if (result.success) { this.renameDraft = null; this.host.redraw(`add:${entity.type}`); return; }
    // An answer, not an error: the caveat shows what cites them, and the state stays open.
    if (result.code === "ENTITY_IN_USE") draft.cited = (result.data as { pages?: number } | undefined)?.pages ?? 0;
    this.host.redraw(`rename-state:${entity.id}:remove`);
  }

  private async submitAlias(draft: AliasDraft, resolution?: IdentityResolution, matched?: IdentityMatch): Promise<void> {
    const text = draft.draft.trim();
    if (!text) { this.aliasDraft = null; this.host.redraw(`alias:${draft.entityId}`); return; }
    const result = await this.controller.addAlias(draft.entityId, text, resolution, matched?.ref);
    this.report(result);
    if (!result.success && result.code === "IDENTITY_AMBIGUOUS" && result.match) { draft.identity = result.match; this.host.redraw(`alias-field:${draft.entityId}`); return; }
    this.aliasDraft = null;
    this.host.redraw(`alias:${draft.entityId}`);
  }

  /** The list's slots. Null while the pen rests. */
  slots(): WorldListPen | null {
    if (!this.controller.penOpen) return null;
    const c = this.controller;
    return {
      failure: this.failure,
      addLabel: (type) => `Add ${NOUN[type]}`,
      countLabel: (type, count) => `${count} ${count === 1 ? SINGULAR[type] : PLURAL[type]}`,
      composer: (parent, type) => {
        const draft = this.composerDraft;
        if (draft?.type !== type) return false;
        this.entityComposer(parent, draft, `compose:${type}`, () => { this.composerDraft = null; this.host.redraw(`add:${type}`); }, (entityId) => {
          // The composer closes and the new card takes its place, open.
          this.composerDraft = null;
          const made = c.worldRecord().find((e) => e.canonId === entityId);
          if (made) this.host.expand(made.id);
          this.host.redraw(made ? `card:${made.id}` : `add:${type}`);
        });
        return true;
      },
      openComposer: (type) => { this.composerDraft = { type, name: "", aliases: "", identity: null, busy: false }; this.failure = null; this.host.redraw(`compose:${type}:name`); },
      makeCanon: (entity, row) => void c.makeCanon(entity.id, row.id).then((result) => { this.report(result); this.host.redraw(result.success && result.data.id ? `pen:Revert:${result.data.id}` : undefined); }),
      revert: (row) => { if (row.target) void c.revertFact(row.target).then((result) => { this.report(result); this.host.redraw(); }); },
      openEdit: (entity, row) => { this.closeCardStates(); this.editDraft = { rowId: row.id, value: row.value }; this.host.redraw(`edit:${row.id}:value`); },
      edit: (parent, entity, row) => {
        const draft = this.editDraft;
        if (draft?.rowId !== row.id || !row.target) return false;
        const { target } = row;
        const close = (focus: string): void => { this.editDraft = null; this.host.redraw(focus); };
        CanonFactEdit(parent, { label: row.label, value: draft.value, focusKey: `edit:${row.id}`, onComposing: (composing) => this.host.composing(composing),
          onValue: (value) => { draft.value = value; },
          onCancel: () => close(`pen:Edit:${row.id}`),
          onSave: () => {
            const value = draft.value.trim();
            if (!value || value === row.value) { close(`pen:Edit:${row.id}`); return; }
            void c.editFact(target, target.kind === "state" ? { value } : { proposition: value }).then((result) => { this.report(result); close(`pen:Edit:${row.id}`); });
          },
          onRemove: () => void c.removeFact(target).then((result) => { this.report(result); close(`addfact:${entity.id}`); }) });
        return true;
      },
      openAlias: (entity) => { this.closeCardStates(); this.aliasDraft = { entityId: entity.id, draft: "", identity: null }; this.host.redraw(`alias-field:${entity.id}`); },
      alias: (parent, entity) => {
        const draft = this.aliasDraft;
        if (draft?.entityId !== entity.id) return;
        PenField(parent, { value: draft.draft, label: "Add alias", focusKey: `alias-field:${entity.id}`, onComposing: (composing) => this.host.composing(composing),
          onInput: (text) => { const was = draft.identity; draft.draft = text; draft.identity = null; if (was) this.host.redraw(`alias-field:${entity.id}`); },
          onEnter: () => void this.submitAlias(draft),
          onEscape: () => { this.aliasDraft = null; this.host.redraw(`alias:${entity.id}`); } });
        if (draft.identity) {
          const match = draft.identity;
          this.question(parent, match, `alias-link:${entity.id}`, () => void this.submitAlias(draft, "alias_of_existing", match), () => void this.submitAlias(draft, "new_entity"));
        }
      },
      openFact: (entity) => this.openFact(entity),
      openRename: (entity) => { this.closeCardStates(); this.renameDraft = { entityId: entity.id, name: entity.name, identity: null, cited: null, busy: false }; this.host.redraw(`rename-state:${entity.id}:name`); },
      foot: (parent, entity) => {
        if (this.factDraft?.entityId === entity.id) { this.factComposer(parent.createDiv({ cls: "bunsho-canon-foot" }), entity, this.factDraft); return true; }
        const draft = this.renameDraft;
        if (draft?.entityId !== entity.id) return false;
        CanonEntityRename(parent.createDiv({ cls: "bunsho-canon-foot" }), { name: draft.name, cited: draft.cited ?? entity.scenes, removeLabel: `Remove ${NOUN[entity.type]}`, busy: draft.busy, focusKey: `rename-state:${entity.id}`,
          onName: (name) => { const was = draft.identity; draft.name = name; draft.identity = null; if (was) this.host.redraw(`rename-state:${entity.id}:name`); },
          onComposing: (composing) => this.host.composing(composing),
          onSave: () => void this.submitRename(draft, entity),
          onCancel: () => { this.renameDraft = null; this.host.redraw(`rename:${entity.id}`); },
          onRemove: () => void this.removeEntity(draft, entity),
          // A rename never merges: "another name for" leaves the name as it was.
          slot: draft.identity ? (slot) => this.question(slot, draft.identity as IdentityMatch, `rename-state:${entity.id}:link`, () => { this.renameDraft = null; this.host.redraw(`rename:${entity.id}`); }, () => void this.submitRename(draft, entity, "new_entity")) : undefined });
        return true;
      },
    };
  }
}
