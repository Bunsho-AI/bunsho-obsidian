/** Inline, at the point of typing: is this someone new, or another name for someone Bunsho knows? (desktop IdentityPrompt). The buttons stack when narrow. */
const NOUNS: Readonly<Record<string, string>> = { character: "person", location: "place", object: "object", organization: "group" };
export const identityNoun = (type: string): string => NOUNS[type] ?? "person";
/** People are addressed by first name; everything else by its full name. */
export const identityShortName = (name: string, type: string): string => (type === "character" ? name.trim().split(/\s+/u)[0] || name : name.trim());

export interface IdentityPromptProps { name: string; type: string; quote: string | null; coordinate: string | null; focusKey: string; onLink: () => void; onCreate: () => void }

export function IdentityPrompt(parent: HTMLElement, props: IdentityPromptProps): void {
  const noun = identityNoun(props.type);
  const box = parent.createDiv({ cls: "bunsho-identity", attr: { role: "group", "aria-label": "Identity" } });
  const ask = box.createDiv({ cls: "bunsho-identity-ask", text: `A new ${noun}, or another name for ` });
  ask.createSpan({ cls: "bunsho-identity-name", text: props.name });
  ask.appendText("?");
  const actions = box.createDiv({ cls: "bunsho-identity-actions" });
  const link = actions.createEl("button", { cls: "bunsho-identity-link", text: `Another name for ${identityShortName(props.name, props.type)}`, attr: { "data-focus-key": props.focusKey } });
  link.onclick = props.onLink;
  actions.createEl("button", { cls: "bunsho-identity-new", text: `A new ${noun}`, attr: { "data-focus-key": `${props.focusKey}:new` } }).onclick = props.onCreate;
  if (props.quote) {
    const sample = box.createDiv({ cls: "bunsho-identity-sample" });
    if (props.coordinate) sample.createSpan({ cls: "bunsho-fact bunsho-identity-where", text: props.coordinate });
    sample.createSpan({ cls: "bunsho-identity-quote", text: `“${props.quote}”` });
  }
}
