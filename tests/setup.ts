// The plugin uses window timers (Obsidian guideline for pop-out windows); under Node, window is the global object.
(globalThis as { window?: unknown }).window ??= globalThis;
