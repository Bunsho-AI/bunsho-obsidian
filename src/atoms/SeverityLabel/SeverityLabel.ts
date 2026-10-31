/** A finding's severity label; filled for rank 1 (error) by the card's styles. */
export type Severity = "error" | "warning" | "info";

const WORD: Record<Severity, string> = { error: "error", warning: "warning", info: "note" };

export function SeverityLabel(parent: HTMLElement, severity: Severity): HTMLElement {
  return parent.createSpan({ cls: "bunsho-severity", text: WORD[severity] });
}
