/** The desktop panel's tabs that exist here, with its names, icons and order (Director and Chat come first there). */
export type PanelTabId = "world" | "continuity";

export const PANEL_TABS = [
  { id: "world", label: "World", icon: "globe" },
  { id: "continuity", label: "Continuity", icon: "check-circle-2" },
] as const satisfies readonly { id: PanelTabId; label: string; icon: string }[];
