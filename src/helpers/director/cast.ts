/** Who is in this book, for the direction box's @ list (the desktop's rankCast): characters by the pages they appear on. Pure. */
import { isDesktopMintedId } from "@/helpers/canon/ids";
import { isPageSource } from "@/helpers/canon/record";
import type { EngineEntity } from "@/helpers/director/world";

export interface DirectorCastMember {
  entityId: string;
  name: string;
  aliases: string[];
  /** Pages it appears on. A pin has no page and is no appearance. */
  appearances: number;
  handCreated: boolean;
  tier: "main" | "extra";
}

/** Page presence decides the tier: anyone on 3+ pages is main; in a book where nobody is yet, the first three are. Main cast, then hand-created, then the rest. */
export function rankCast(entities: readonly EngineEntity[]): DirectorCastMember[] {
  const characters = entities.filter((e) => e.type === "character" && e.status === "active").map((e) => ({
    entityId: e.entityId,
    name: e.canonicalName,
    aliases: [...new Set(e.aliases.filter((a) => a.grep && a.kind !== "pronoun").map((a) => a.text).filter((t) => t.toLowerCase() !== e.canonicalName.toLowerCase()))],
    appearances: new Set(e.provenance.flatMap((s) => (isPageSource(s) ? [s.pageId] : []))).size,
    handCreated: isDesktopMintedId(e.entityId),
  })).sort((a, b) => b.appearances - a.appearances || a.name.localeCompare(b.name));
  const anyoneEstablished = characters.some((c) => c.appearances >= 3);
  const ranked = characters.map((c, index): DirectorCastMember => ({ ...c, tier: c.appearances >= 3 || (!anyoneEstablished && index < 3) ? "main" : "extra" }));
  const block = (c: DirectorCastMember): number => (c.tier === "main" ? 0 : c.handCreated ? 1 : 2);
  return ranked.sort((a, b) => block(a) - block(b) || b.appearances - a.appearances || a.name.localeCompare(b.name));
}
