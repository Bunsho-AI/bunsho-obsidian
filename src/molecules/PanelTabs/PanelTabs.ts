/** The panel's quiet tabs: text, with the active one underlined in the accent. */
export interface PanelTabsProps<T extends string> { tabs: { id: T; label: string }[]; active: T; onSelect: (id: T) => void; cls?: string }

export function PanelTabs<T extends string>(parent: HTMLElement, { tabs, active, onSelect, cls = "" }: PanelTabsProps<T>): HTMLElement {
  const row = parent.createDiv({ cls: `bunsho-tabs ${cls}`.trim(), attr: { role: "tablist" } });
  for (const tab of tabs) {
    const selected = tab.id === active;
    const button = row.createEl("button", { cls: `bunsho-tab${selected ? " is-active" : ""}`, text: tab.label, attr: { role: "tab", "aria-selected": String(selected), "data-focus-key": `tab:${tab.id}` } });
    button.onclick = () => onSelect(tab.id);
  }
  return row;
}
