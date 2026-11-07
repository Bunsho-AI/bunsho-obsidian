import { FillButton } from "@/atoms/FillButton";
import { EmptyState } from "@/molecules/EmptyState";
import type { Scan } from "@/types";

/** Shown until there is something to read: Bunsho never guesses a folder and imposes no layout. */
export interface SourcePromptProps { scan: Exclude<Scan, { status: "ready" }>; onChoose: () => void }

const name = (path: string) => (path === "/" ? "Your vault" : `“${path}”`);

export function SourcePrompt(parent: HTMLElement, { scan, onChoose }: SourcePromptProps): HTMLElement {
  const box = scan.status === "no_source"
    ? EmptyState(parent, { title: "Choose what Bunsho reads", body: "Pick the folder or note that holds your book, in whatever layout you keep it. You confirm the order and the price before anything is spent." })
    : scan.status === "missing"
      ? EmptyState(parent, { title: "Bunsho can't find your book", body: `${name(scan.source.path)} is no longer in this vault. Choose where it is now.` })
      : EmptyState(parent, { title: "Nothing to read yet", body: `${name(scan.source.path)} has no text in it yet. Write something, or choose somewhere else.` });
  FillButton(box, { label: "Choose folder or note", onClick: onChoose });
  return box;
}
