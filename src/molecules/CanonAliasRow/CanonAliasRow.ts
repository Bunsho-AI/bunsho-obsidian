import { TextAction } from "@/atoms/TextAction";

/** The alias line (desktop CanonAliasRow): `also` and the names, then the pen. The field and any identity question go beneath it, in the owner's hands. */
export interface CanonAliasRowProps { aliases: readonly string[]; focusKey: string; onAddAlias: (() => void) | null }

export function CanonAliasRow(parent: HTMLElement, { aliases, focusKey, onAddAlias }: CanonAliasRowProps): void {
  if (aliases.length === 0 && !onAddAlias) return;
  const row = parent.createDiv({ cls: "bunsho-canon-row bunsho-alias-row" });
  const text = row.createDiv({ cls: "bunsho-canon-text bunsho-world-fact" });
  if (aliases.length > 0) {
    text.createSpan({ cls: "bunsho-world-label", text: "also" });
    text.createSpan({ cls: "bunsho-world-value", text: aliases.join(", ") });
  }
  if (onAddAlias) TextAction(row.createDiv({ cls: "bunsho-canon-pen" }), { label: "Add alias", quiet: true, focusKey, onClick: onAddAlias });
}
