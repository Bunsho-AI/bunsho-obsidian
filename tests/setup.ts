// The plugin uses window timers (Obsidian guideline for pop-out windows). Under Node, give it a `window` of its own that
// delegates to Node's timers, so a test can swap the window's timers without touching Node internals.
(globalThis as { window?: unknown }).window ??= {
  setTimeout: (handler: () => void, ms?: number) => globalThis.setTimeout(handler, ms),
  clearTimeout: (id: unknown) => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>),
  open: () => null,
};
