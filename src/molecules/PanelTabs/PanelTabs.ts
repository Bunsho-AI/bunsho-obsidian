import { setIcon } from "obsidian";

/** The panel's quiet tabs: an optional icon and text, with the active one underlined in the accent. */
export interface PanelTab<T extends string> { id: T; label: string; icon?: string }
export interface PanelTabsProps<T extends string> { tabs: readonly PanelTab<T>[]; active: T; onSelect: (id: T) => void; cls?: string }

export function PanelTabs<T extends string>(parent: HTMLElement, { tabs, active, onSelect, cls = "" }: PanelTabsProps<T>): HTMLElement {
  const row = parent.createDiv({ cls: `bunsho-tabs ${cls}`.trim(), attr: { role: "tablist" } });
  for (const tab of tabs) {
    const selected = tab.id === active;
    const button = row.createEl("button", { cls: `bunsho-tab${selected ? " is-active" : ""}`, attr: { role: "tab", "aria-selected": String(selected), "data-focus-key": `tab:${tab.id}` } });
    if (tab.icon) setIcon(button.createSpan({ cls: "bunsho-tab-icon", attr: { "aria-hidden": "true" } }), tab.icon);
    button.createSpan({ text: tab.label });
    button.onclick = () => onSelect(tab.id);
  }
  return row;
}
