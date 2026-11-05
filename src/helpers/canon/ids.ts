/**
 * Ids for what the writer declares, the desktop's scheme (canon/ids.ts): a family prefix and a lowercase hyphenated UUID v4.
 * Hyphens are outside the engine's slug alphabet, so the engine can never mint one. Nothing is derived from a name: a name in
 * any script makes the same kind of id, and a cast id, which moves from check to check, is never used.
 */
export const ENGINE_ID_PATTERN = /^(ent|st|kn)_[a-z0-9_]+$/u;
export const DESKTOP_ID_PATTERN = /^(ent|st|kn)_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const mint = (prefix: "ent" | "st" | "kn"): string => `${prefix}_${crypto.randomUUID().toLowerCase()}`;

export const mintEntityId = (): string => mint("ent");
export const mintStateId = (): string => mint("st");
export const mintKnowledgeId = (): string => mint("kn");
export const isDesktopMintedId = (id: string): boolean => DESKTOP_ID_PATTERN.test(id);
