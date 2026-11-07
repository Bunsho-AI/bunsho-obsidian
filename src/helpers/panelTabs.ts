/** The desktop panel's tabs that exist here, with its names, icons and order (Chat, second there, does not). */
export type PanelTabId = "director" | "world" | "continuity";

export const PANEL_TABS = [
  { id: "director", label: "Director", icon: "clapperboard" },
  { id: "world", label: "World", icon: "globe" },
  { id: "continuity", label: "Continuity", icon: "check-circle-2" },
] as const satisfies readonly { id: PanelTabId; label: string; icon: string }[];
